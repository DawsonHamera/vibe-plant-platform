import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlantRecord, TelemetryPoint } from "@vibe/shared";
import { io } from "socket.io-client";
import ReactFlow, {
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

const apiBase = (import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

type DailyDecision = {
  date: string;
  duePlantIds: string[];
  overduePlantIds: string[];
  alerts: string[];
};

type TelemetryView = {
  moisture: number;
  light: number;
  temperature: number;
  capturedAt: string;
};

type TelemetryStats = {
  ingestCount: number;
  cachedPlantCount: number;
  latestLookup: {
    hits: number;
    misses: number;
    hitRate: number | null;
  };
};

type DeviceDiscovery = {
  connectionType: "serial" | "network" | "bluetooth";
  options: string[];
};

type DeviceProfile = {
  id: string;
  name: string;
  connectionType: "serial" | "network" | "bluetooth";
  transportTarget: string;
  channelMap: Record<string, string>;
  calibration: Record<string, number>;
  isLive: boolean;
};

type DeviceProfileValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

type DeviceProfileValidationResult = {
  ok: boolean;
  issues: DeviceProfileValidationIssue[];
};

type ConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  message: string;
};

type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
};

type AutomationTimelineEvent = {
  id: string;
  ruleId: string;
  source: string;
  reason: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type TimelineFilters = {
  ruleId: string;
  plantId: string;
  source: string;
  limit: string;
};

type AutomationRuntimeStatus = {
  lastRunTime: string | null;
  lastExecutionCount: number;
  totalExecutions: number;
  blockedCooldownCount: number;
  blockedDailyLimitCount: number;
};

type AutomationRuntimeHistoryEntry = {
  id: string;
  capturedAt: string;
  executedCount: number;
  blockedCooldownCount: number;
  blockedDailyLimitCount: number;
};

type DeviceProfileEditDraft = {
  id: string;
  name: string;
  moistureDry: string;
  moistureWet: string;
  moistureChannel: string;
  lightChannel: string;
  temperatureChannel: string;
};

type PlantEditDraft = {
  id: string;
  nickname: string;
  species: string;
  zone: string;
  notes: string;
  healthState: PlantRecord["healthState"];
  wateringEveryDays: string;
  fertilizingEveryDays: string;
  pruningEveryDays: string;
};

type DiagramNodeKind = "trigger" | "condition" | "action";

type DiagramMetric = "moisture" | "light" | "temperature";

type DiagramOperator = "<" | "<=" | ">" | ">=";

type DiagramActionTarget = "pump" | "mister" | "relay";

type DiagramNodeData = {
  label: string;
  kind?: DiagramNodeKind;
  plantId?: string;
  plantOptions?: Array<{ id: string; label: string; imageUrl?: string }>;
  plantImageUrl?: string;
  metric?: DiagramMetric;
  operator?: DiagramOperator;
  value?: number;
  target?: DiagramActionTarget;
  seconds?: number;
  cooldownMinutes?: number;
  maxDailyRuntimeSeconds?: number;
  onPatch?: (partial: Partial<DiagramNodeData>) => void;
  onLabelChange?: (label: string) => void;
};

type DiagramSnapshot = {
  nodes: Node<DiagramNodeData>[];
  edges: Edge[];
};

type FlowValidationIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
  nodeId?: string;
};

type DiagramPreviewResponse = {
  scope: string;
  compiledRuleCount: number;
  compiledRules: Array<Record<string, unknown>>;
  issues: FlowValidationIssue[];
};

type DiagramApplyResponse = {
  scope: string;
  compiledRuleCount: number;
  rules: Array<Record<string, unknown>>;
  issues: FlowValidationIssue[];
};

type PlatformHealthDetails = {
  status: "ok" | "degraded";
  startedAt: string;
  uptimeSeconds: number;
  database: {
    ok: boolean;
    plantsCount: number;
    deviceProfilesCount: number;
    automationRulesCount: number;
    automationEventsCount: number;
    error?: string;
  };
};
type DiagramApiSnapshot = DiagramSnapshot & {
  scope: string;
  updatedAt: string;
};

const diagramScope = "dashboard";

const defaultDiagramNodes: Node<DiagramNodeData>[] = [
  {
    id: "start",
    position: { x: 140, y: 80 },
    data: { label: "Any Plant", kind: "trigger", plantId: "" },
    type: "flowNode",
  },
  {
    id: "condition",
    position: { x: 380, y: 90 },
    data: { label: "Moisture Low", kind: "condition", metric: "moisture", operator: "<", value: 35 },
    type: "flowNode",
  },
  {
    id: "action",
    position: { x: 660, y: 210 },
    data: {
      label: "Water Pump",
      kind: "action",
      target: "pump",
      seconds: 8,
      cooldownMinutes: 60,
      maxDailyRuntimeSeconds: 90,
    },
    type: "flowNode",
  },
];

const defaultDiagramEdges: Edge[] = [
  {
    id: "edge-start-condition",
    source: "start",
    target: "condition",
    animated: true,
    label: "scope",
  },
  {
    id: "edge-condition-action",
    source: "condition",
    target: "action",
    animated: true,
    label: "when moisture < 35%",
  },
];

function FlowNodeCard({ data, selected }: NodeProps<DiagramNodeData>): JSX.Element {
  const kind = data.kind ?? "trigger";
  const canTarget = kind !== "trigger";
  const canSource = kind !== "action";

  return (
    <div className={`flow-node-card ${selected ? "selected" : ""}`}>
      {canTarget ? <Handle type="target" position={Position.Left} className="flow-handle flow-handle-target" /> : null}
      {canSource ? <Handle type="source" position={Position.Right} className="flow-handle flow-handle-source" /> : null}
      <div className="flow-node-head">
        <input
          className="flow-node-input flow-node-label-input nodrag nopan"
          value={data.label ?? ""}
          onChange={(event) => data.onLabelChange?.(event.target.value)}
          aria-label={`${kind} label`}
        />
        <span className="flow-node-kind">{kind}</span>
      </div>

      {kind === "trigger" ? (
        <div className="trigger-config-row">
          {data.plantImageUrl ? <img className="trigger-plant-icon" src={data.plantImageUrl} alt="Selected plant" /> : null}
          <select
            className="flow-node-input nodrag nopan"
            value={data.plantId ?? ""}
            onChange={(event) => data.onPatch?.({ plantId: event.target.value })}
            aria-label="Trigger plant"
          >
            <option value="">Any plant</option>
            {(data.plantOptions ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {kind === "condition" ? (
        <div className="flow-node-grid condition-grid">
          <select
            className="flow-node-input nodrag nopan"
            value={data.metric ?? "moisture"}
            onChange={(event) => data.onPatch?.({ metric: event.target.value as DiagramMetric })}
            aria-label="Condition metric"
          >
            <option value="moisture">moisture</option>
            <option value="light">light</option>
            <option value="temperature">temperature</option>
          </select>
          <select
            className="flow-node-input nodrag nopan"
            value={data.operator ?? "<"}
            onChange={(event) => data.onPatch?.({ operator: event.target.value as DiagramOperator })}
            aria-label="Condition operator"
          >
            <option value="<">&lt;</option>
            <option value="<=">&lt;=</option>
            <option value=">">&gt;</option>
            <option value=">=">&gt;=</option>
          </select>
          <input
            type="number"
            className="flow-node-input nodrag nopan"
            value={data.value ?? 35}
            onChange={(event) => data.onPatch?.({ value: Number(event.target.value) })}
            placeholder="threshold"
            aria-label="Condition threshold"
          />
        </div>
      ) : null}

      {kind === "action" ? (
        <div className="flow-node-grid action-grid">
          <select
            className="flow-node-input nodrag nopan"
            value={data.target ?? "pump"}
            onChange={(event) => data.onPatch?.({ target: event.target.value as DiagramActionTarget })}
            aria-label="Action target"
          >
            <option value="pump">pump</option>
            <option value="mister">mister</option>
            <option value="relay">relay</option>
          </select>
          <input
            type="number"
            min={1}
            className="flow-node-input nodrag nopan"
            value={data.seconds ?? 8}
            onChange={(event) => data.onPatch?.({ seconds: Number(event.target.value) })}
            placeholder="seconds"
            aria-label="Action seconds"
          />
          <input
            type="number"
            min={1}
            className="flow-node-input nodrag nopan"
            value={data.cooldownMinutes ?? 60}
            onChange={(event) => data.onPatch?.({ cooldownMinutes: Number(event.target.value) })}
            placeholder="cooldown min"
            aria-label="Action cooldown"
          />
          <input
            type="number"
            min={1}
            className="flow-node-input nodrag nopan"
            value={data.maxDailyRuntimeSeconds ?? 90}
            onChange={(event) => data.onPatch?.({ maxDailyRuntimeSeconds: Number(event.target.value) })}
            placeholder="max daily sec"
            aria-label="Action max daily runtime"
          />
        </div>
      ) : null}
    </div>
  );
}

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeRuntimeStatus = (payload: unknown): AutomationRuntimeStatus => {
  const data = (payload ?? {}) as Record<string, unknown>;

  return {
    lastRunTime:
      (typeof data.lastRunTime === "string" && data.lastRunTime) ||
      (typeof data.lastRunAt === "string" && data.lastRunAt) ||
      null,
    lastExecutionCount: toNumber(data.lastExecutionCount),
    totalExecutions: toNumber(data.totalExecutions),
    blockedCooldownCount: toNumber(data.blockedCooldownCount),
    blockedDailyLimitCount: toNumber(data.blockedDailyLimitCount),
  };
};

const normalizeRuntimeHistoryEntry = (payload: unknown, index: number): AutomationRuntimeHistoryEntry => {
  const data = (payload ?? {}) as Record<string, unknown>;
  const capturedAt =
    (typeof data.ranAt === "string" && data.ranAt) ||
    (typeof data.capturedAt === "string" && data.capturedAt) ||
    (typeof data.createdAt === "string" && data.createdAt) ||
    (typeof data.lastRunAt === "string" && data.lastRunAt) ||
    new Date().toISOString();

  return {
    id: (typeof data.id === "string" && data.id) || `${capturedAt}-${index}`,
    capturedAt,
    executedCount: toNumber(data.executedCount ?? data.executionCount ?? data.lastExecutionCount),
    blockedCooldownCount: toNumber(data.blockedCooldownCount ?? data.blockedCooldownCountDelta),
    blockedDailyLimitCount: toNumber(data.blockedDailyLimitCount ?? data.blockedDailyLimitCountDelta),
  };
};

const normalizeTelemetryStats = (payload: unknown): TelemetryStats => {
  const data = (payload ?? {}) as Record<string, unknown>;
  const latestLookup = (data.latestLookup ?? {}) as Record<string, unknown>;
  const hitRateValue = latestLookup.hitRate;

  return {
    ingestCount: toNumber(data.ingestCount),
    cachedPlantCount: toNumber(data.cachedPlantCount),
    latestLookup: {
      hits: toNumber(latestLookup.hits),
      misses: toNumber(latestLookup.misses),
      hitRate: typeof hitRateValue === "number" && Number.isFinite(hitRateValue) ? hitRateValue : null,
    },
  };
};

const resolvePlantImageUrl = (imageUrl: string | undefined): string | null => {
  if (!imageUrl) {
    return null;
  }

  if (/^data:image\//i.test(imageUrl)) {
    return imageUrl;
  }

  try {
    const absoluteUrl = new URL(imageUrl);
    if (absoluteUrl.protocol === "http:" || absoluteUrl.protocol === "https:") {
      return absoluteUrl.toString();
    }
    return null;
  } catch {
    // Fall through and resolve as a relative backend path.
  }

  try {
    return new URL(imageUrl, apiBase).toString();
  } catch {
    return null;
  }
};

export function App(): JSX.Element {
  const [plants, setPlants] = useState<PlantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<DailyDecision | null>(null);
  const [latestTelemetrySnapshot, setLatestTelemetrySnapshot] = useState<TelemetryPoint[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotPlantIdFilter, setSnapshotPlantIdFilter] = useState("");
  const [telemetryStats, setTelemetryStats] = useState<TelemetryStats | null>(null);
  const [telemetryStatsLoading, setTelemetryStatsLoading] = useState(false);
  const [telemetryStatsError, setTelemetryStatsError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<Record<string, TelemetryView>>({});
  const [discovery, setDiscovery] = useState<DeviceDiscovery[]>([]);
  const [deviceProfiles, setDeviceProfiles] = useState<DeviceProfile[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [ruleToggleInFlightId, setRuleToggleInFlightId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<AutomationTimelineEvent[]>([]);
  const [timelineFilters, setTimelineFilters] = useState<TimelineFilters>({
    ruleId: "",
    plantId: "",
    source: "",
    limit: "50",
  });
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [expandedTimelineEvents, setExpandedTimelineEvents] = useState<Record<string, boolean>>({});
  const [runtimeStatus, setRuntimeStatus] = useState<AutomationRuntimeStatus | null>(null);
  const [runtimeStatusLoading, setRuntimeStatusLoading] = useState(false);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const [runtimeHistory, setRuntimeHistory] = useState<AutomationRuntimeHistoryEntry[]>([]);
  const [runtimeHistoryLoading, setRuntimeHistoryLoading] = useState(false);
  const [runtimeHistoryError, setRuntimeHistoryError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSpecies, setDraftSpecies] = useState("");
  const [draftZone, setDraftZone] = useState("Living Room");
  const [deviceName, setDeviceName] = useState("Living Room Kit");
  const [deviceType, setDeviceType] = useState<"serial" | "network" | "bluetooth">("serial");
  const [deviceTarget, setDeviceTarget] = useState("COM3");
  const [deviceMoistureChannel, setDeviceMoistureChannel] = useState("ch0");
  const [deviceLightChannel, setDeviceLightChannel] = useState("ch1");
  const [deviceTemperatureChannel, setDeviceTemperatureChannel] = useState("ch2");
  const [deviceMoistureDry, setDeviceMoistureDry] = useState("900");
  const [deviceMoistureWet, setDeviceMoistureWet] = useState("300");
  const [ruleName, setRuleName] = useState("Auto Water When Dry");
  const [connectionTest, setConnectionTest] = useState<ConnectionTestResult | null>(null);
  const [lastEvaluationExecutions, setLastEvaluationExecutions] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<"overview" | "plants" | "devices" | "automation" | "diagrams">(
    "overview",
  );
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [isPlantModalOpen, setIsPlantModalOpen] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [plantEditDraft, setPlantEditDraft] = useState<PlantEditDraft | null>(null);
  const [plantEditSaving, setPlantEditSaving] = useState(false);
  const [plantEditError, setPlantEditError] = useState<string | null>(null);
  const [profileEditDraft, setProfileEditDraft] = useState<DeviceProfileEditDraft | null>(null);
  const [profileEditSaving, setProfileEditSaving] = useState(false);
  const [profileValidation, setProfileValidation] = useState<Record<string, DeviceProfileValidationResult>>({});
  const [profileValidationInFlightId, setProfileValidationInFlightId] = useState<string | null>(null);
  const [profileValidationError, setProfileValidationError] = useState<string | null>(null);
  const [imageUploadInFlightId, setImageUploadInFlightId] = useState<string | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [diagramReady, setDiagramReady] = useState(false);
  const [diagramNodes, setDiagramNodes, onDiagramNodesChange] = useNodesState<DiagramNodeData>([]);
  const [diagramEdges, setDiagramEdges, onDiagramEdgesChange] = useEdgesState([]);
  const [selectedDiagramNodeId, setSelectedDiagramNodeId] = useState<string | null>(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramSaving, setDiagramSaving] = useState(false);
  const [diagramSyncError, setDiagramSyncError] = useState<string | null>(null);
  const [diagramLastSavedAt, setDiagramLastSavedAt] = useState<string | null>(null);
  const [diagramNodeKindDraft, setDiagramNodeKindDraft] = useState<DiagramNodeKind>("condition");
  const [diagramApplyInFlight, setDiagramApplyInFlight] = useState(false);
  const [diagramApplyError, setDiagramApplyError] = useState<string | null>(null);
  const [diagramApplyResult, setDiagramApplyResult] = useState<string | null>(null);
  const [diagramPreviewInFlight, setDiagramPreviewInFlight] = useState(false);
  const [diagramPreviewResult, setDiagramPreviewResult] = useState<string | null>(null);
  const [diagramPreviewIssues, setDiagramPreviewIssues] = useState<FlowValidationIssue[]>([]);
  const [diagramConnectionError, setDiagramConnectionError] = useState<string | null>(null);
  const [healthDetails, setHealthDetails] = useState<PlatformHealthDetails | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const diagramHydratedRef = useRef(false);

  const plantLookup = useMemo(
    () => new Map(plants.map((plant) => [plant.id, plant.nickname])),
    [plants],
  );

  const sortedTimeline = useMemo(
    () => [...timeline].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [timeline],
  );

  const diagramPlantOptions = useMemo(
    () =>
      plants.map((plant) => ({
        id: plant.id,
        label: plant.nickname,
        imageUrl: resolvePlantImageUrl(plant.imageUrl) ?? undefined,
      })),
    [plants],
  );

  const updateDiagramNodeDataById = useCallback(
    (nodeId: string, partial: Partial<DiagramNodeData>) => {
      setDiagramNodes((prev: Node<DiagramNodeData>[]) =>
        prev.map((node: Node<DiagramNodeData>) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...partial,
                },
              }
            : node,
        ),
      );
    },
    [setDiagramNodes],
  );

  const flowNodeTypes = useMemo(
    () => ({
      flowNode: FlowNodeCard,
    }),
    [],
  );

  const diagramNodesForCanvas = useMemo(
    () =>
      diagramNodes.map((node: Node<DiagramNodeData>) => ({
        ...node,
        data: {
          ...node.data,
          plantOptions: diagramPlantOptions,
          plantImageUrl: diagramPlantOptions.find((option) => option.id === node.data.plantId)?.imageUrl,
          onPatch: (partial: Partial<DiagramNodeData>) => updateDiagramNodeDataById(node.id, partial),
          onLabelChange: (label: string) => updateDiagramNodeDataById(node.id, { label }),
        },
      })),
    [diagramNodes, diagramPlantOptions, updateDiagramNodeDataById],
  );

  const buildTimelineQueryParams = (filters: TimelineFilters): URLSearchParams => {
    const params = new URLSearchParams();
    const ruleId = filters.ruleId.trim();
    const plantId = filters.plantId.trim();
    const source = filters.source.trim();
    const limit = filters.limit.trim();

    if (ruleId.length > 0) {
      params.set("ruleId", ruleId);
    }

    if (plantId.length > 0) {
      params.set("plantId", plantId);
    }

    if (source.length > 0) {
      params.set("source", source);
    }

    if (limit.length > 0) {
      params.set("limit", limit);
    }

    return params;
  };

  const fetchTimeline = async (filters: TimelineFilters): Promise<void> => {
    setTimelineLoading(true);
    setTimelineError(null);

    try {
      const params = buildTimelineQueryParams(filters);
      const query = params.toString();
      const response = await fetch(`${apiBase}/automation/timeline${query.length > 0 ? `?${query}` : ""}`);

      if (!response.ok) {
        throw new Error(`Timeline request failed with status ${response.status}`);
      }

      setTimeline((await response.json()) as AutomationTimelineEvent[]);
      setExpandedTimelineEvents({});
    } catch (error) {
      setTimelineError(error instanceof Error ? error.message : "Unable to load timeline.");
    } finally {
      setTimelineLoading(false);
    }
  };

  const fetchRuntimeStatus = async (): Promise<void> => {
    setRuntimeStatusLoading(true);
    setRuntimeStatusError(null);

    try {
      const response = await fetch(`${apiBase}/automation/runtime-status`);
      if (!response.ok) {
        throw new Error(`Runtime status request failed with status ${response.status}`);
      }

      setRuntimeStatus(normalizeRuntimeStatus(await response.json()));
    } catch (error) {
      setRuntimeStatusError(error instanceof Error ? error.message : "Unable to load runtime status.");
    } finally {
      setRuntimeStatusLoading(false);
    }
  };

  const fetchRuntimeHistory = async (): Promise<void> => {
    setRuntimeHistoryLoading(true);
    setRuntimeHistoryError(null);

    try {
      const response = await fetch(`${apiBase}/automation/runtime-history`);
      if (!response.ok) {
        throw new Error(`Runtime history request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const list = Array.isArray(payload) ? payload : [];
      const normalized = list
        .map((entry, index) => normalizeRuntimeHistoryEntry(entry, index))
        .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
      setRuntimeHistory(normalized.slice(-14));
    } catch (error) {
      setRuntimeHistoryError(error instanceof Error ? error.message : "Unable to load runtime history.");
      setRuntimeHistory([]);
    } finally {
      setRuntimeHistoryLoading(false);
    }
  };

  const fetchLatestTelemetrySnapshot = async (plantIdFilter?: string): Promise<void> => {
    setSnapshotLoading(true);
    setSnapshotError(null);

    try {
      const plantId = (plantIdFilter ?? "").trim();
      const query = plantId.length > 0 ? `?plantId=${encodeURIComponent(plantId)}` : "";
      const response = await fetch(`${apiBase}/telemetry/latest${query}`);

      if (!response.ok) {
        throw new Error(`Snapshot request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as TelemetryPoint[] | TelemetryPoint | null;
      if (!payload) {
        setLatestTelemetrySnapshot([]);
        return;
      }

      const list = Array.isArray(payload) ? payload : [payload];
      setLatestTelemetrySnapshot(list.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)));
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : "Unable to load telemetry snapshot.");
    } finally {
      setSnapshotLoading(false);
    }
  };

  const fetchTelemetryStats = async (): Promise<void> => {
    setTelemetryStatsLoading(true);
    setTelemetryStatsError(null);

    try {
      const response = await fetch(`${apiBase}/telemetry/stats`);
      if (!response.ok) {
        throw new Error(`Telemetry stats request failed with status ${response.status}`);
      }

      setTelemetryStats(normalizeTelemetryStats(await response.json()));
    } catch (error) {
      setTelemetryStatsError(error instanceof Error ? error.message : "Unable to load telemetry stats.");
    } finally {
      setTelemetryStatsLoading(false);
    }
  };

  const fetchHealthDetails = async (): Promise<void> => {
    setHealthLoading(true);
    setHealthError(null);

    try {
      const response = await fetch(`${apiBase}/health/details`);
      if (!response.ok) {
        throw new Error(`Health request failed with status ${response.status}`);
      }

      setHealthDetails((await response.json()) as PlatformHealthDetails);
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : "Unable to load platform health.");
    } finally {
      setHealthLoading(false);
    }
  };

  const loadDiagramSnapshotFromApi = async (): Promise<void> => {
    setDiagramLoading(true);
    setDiagramSyncError(null);

    try {
      const response = await fetch(`${apiBase}/diagrams/${diagramScope}`);
      if (!response.ok) {
        throw new Error(`Diagram request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as Partial<DiagramApiSnapshot>;
      const nextNodes =
        Array.isArray(payload.nodes) && payload.nodes.length > 0
          ? (payload.nodes as Node<DiagramNodeData>[])
          : defaultDiagramNodes;
      const nextEdges = Array.isArray(payload.edges) ? (payload.edges as Edge[]) : defaultDiagramEdges;

      setDiagramNodes(nextNodes);
      setDiagramEdges(nextEdges);
      if (typeof payload.updatedAt === "string" && payload.updatedAt.length > 0) {
        setDiagramLastSavedAt(payload.updatedAt);
      }
    } catch (error) {
      setDiagramSyncError(error instanceof Error ? error.message : "Unable to load diagram from backend.");
      setDiagramNodes(defaultDiagramNodes);
      setDiagramEdges(defaultDiagramEdges);
    } finally {
      setDiagramReady(true);
      setDiagramLoading(false);
    }
  };

  const saveDiagramSnapshotToApi = async (snapshot: DiagramSnapshot): Promise<void> => {
    setDiagramSaving(true);
    setDiagramSyncError(null);

    try {
      const response = await fetch(`${apiBase}/diagrams/${diagramScope}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });

      if (!response.ok) {
        throw new Error(`Diagram save failed with status ${response.status}`);
      }

      const payload = (await response.json()) as Partial<DiagramApiSnapshot>;
      if (typeof payload.updatedAt === "string" && payload.updatedAt.length > 0) {
        setDiagramLastSavedAt(payload.updatedAt);
      } else {
        setDiagramLastSavedAt(new Date().toISOString());
      }
    } catch (error) {
      setDiagramSyncError(error instanceof Error ? error.message : "Unable to save diagram.");
    } finally {
      setDiagramSaving(false);
    }
  };

  useEffect(() => {
    const loadAll = async (): Promise<void> => {
      const [
        plantResponse,
        dailyResponse,
        discoverResponse,
        profileResponse,
        ruleResponse,
        timelineResponse,
        runtimeStatusResponse,
        runtimeHistoryResponse,
        healthResponse,
        telemetryStatsResponse,
      ] =
        await Promise.all([
          fetch(`${apiBase}/plants`),
          fetch(`${apiBase}/dashboard/daily`),
          fetch(`${apiBase}/devices/discover`),
          fetch(`${apiBase}/devices/profiles`),
          fetch(`${apiBase}/automation/rules`),
          fetch(`${apiBase}/automation/timeline?limit=50`),
          fetch(`${apiBase}/automation/runtime-status`),
          fetch(`${apiBase}/automation/runtime-history`),
          fetch(`${apiBase}/health/details`),
          fetch(`${apiBase}/telemetry/stats`),
        ]);

      setPlants((await plantResponse.json()) as PlantRecord[]);
      setDecision((await dailyResponse.json()) as DailyDecision);
      setDiscovery((await discoverResponse.json()) as DeviceDiscovery[]);
      setDeviceProfiles((await profileResponse.json()) as DeviceProfile[]);
      setRules((await ruleResponse.json()) as AutomationRule[]);
      setTimeline((await timelineResponse.json()) as AutomationTimelineEvent[]);
      setExpandedTimelineEvents({});
      if (runtimeStatusResponse.ok) {
        setRuntimeStatus(normalizeRuntimeStatus(await runtimeStatusResponse.json()));
      } else {
        setRuntimeStatusError(`Runtime status request failed with status ${runtimeStatusResponse.status}`);
      }
      if (runtimeHistoryResponse.ok) {
        const payload = (await runtimeHistoryResponse.json()) as unknown;
        const list = Array.isArray(payload) ? payload : [];
        const normalized = list
          .map((entry, index) => normalizeRuntimeHistoryEntry(entry, index))
          .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
        setRuntimeHistory(normalized.slice(-14));
      } else {
        setRuntimeHistoryError(`Runtime history request failed with status ${runtimeHistoryResponse.status}`);
      }
      if (healthResponse.ok) {
        setHealthDetails((await healthResponse.json()) as PlatformHealthDetails);
      } else {
        setHealthError(`Health request failed with status ${healthResponse.status}`);
      }
      if (telemetryStatsResponse.ok) {
        setTelemetryStats(normalizeTelemetryStats(await telemetryStatsResponse.json()));
      } else {
        setTelemetryStatsError(`Telemetry stats request failed with status ${telemetryStatsResponse.status}`);
      }
      setLoading(false);
    };

    void loadAll();
  }, []);

  useEffect(() => {
    void loadDiagramSnapshotFromApi();
  }, [setDiagramEdges, setDiagramNodes]);

  useEffect(() => {
    if (!diagramReady) {
      return;
    }

    if (!diagramHydratedRef.current) {
      diagramHydratedRef.current = true;
      return;
    }

    const timer = window.setTimeout(() => {
      void saveDiagramSnapshotToApi({
        nodes: diagramNodes,
        edges: diagramEdges,
      });
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [diagramEdges, diagramNodes, diagramReady]);

  useEffect(() => {
    void fetchLatestTelemetrySnapshot();
  }, []);

  const refreshTelemetryPanel = async (): Promise<void> => {
    await Promise.all([fetchLatestTelemetrySnapshot(snapshotPlantIdFilter), fetchTelemetryStats()]);
  };

  useEffect(() => {
    const socket = io(apiBase, { path: "/ws/telemetry" });
    socket.on("telemetry:update", (point: TelemetryView & { plantId: string }) => {
      setTelemetry((prev) => ({
        ...prev,
        [point.plantId]: {
          moisture: point.moisture,
          light: point.light,
          temperature: point.temperature,
          capturedAt: point.capturedAt,
        },
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const refreshPlantsAndDecision = async (): Promise<void> => {
    const [plantResponse, dailyResponse] = await Promise.all([
      fetch(`${apiBase}/plants`),
      fetch(`${apiBase}/dashboard/daily`),
    ]);

    setPlants((await plantResponse.json()) as PlantRecord[]);
    setDecision((await dailyResponse.json()) as DailyDecision);
  };

  const submitPlant = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await fetch(`${apiBase}/plants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: draftName,
        species: draftSpecies,
        zone: draftZone,
        growthStage: "vegetative",
        healthState: "good",
        schedule: {
          wateringEveryDays: 3,
        },
      }),
    });

    setDraftName("");
    setDraftSpecies("");
    await refreshPlantsAndDecision();
    setIsPlantModalOpen(false);
  };

  const openPlantEditModal = (plant: PlantRecord): void => {
    setPlantEditError(null);
    setPlantEditDraft({
      id: plant.id,
      nickname: plant.nickname,
      species: plant.species,
      zone: plant.zone,
      notes: plant.notes ?? "",
      healthState: plant.healthState,
      wateringEveryDays: String(plant.schedule.wateringEveryDays),
      fertilizingEveryDays:
        plant.schedule.fertilizingEveryDays !== undefined ? String(plant.schedule.fertilizingEveryDays) : "",
      pruningEveryDays: plant.schedule.pruningEveryDays !== undefined ? String(plant.schedule.pruningEveryDays) : "",
    });
  };

  const savePlantEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!plantEditDraft) {
      return;
    }

    const wateringEveryDays = Number(plantEditDraft.wateringEveryDays);
    const fertilizingEveryDays = Number(plantEditDraft.fertilizingEveryDays);
    const pruningEveryDays = Number(plantEditDraft.pruningEveryDays);

    if (!Number.isInteger(wateringEveryDays) || wateringEveryDays < 1) {
      setPlantEditError("Watering days must be a whole number greater than 0.");
      return;
    }

    if (plantEditDraft.fertilizingEveryDays.trim().length > 0 && (!Number.isInteger(fertilizingEveryDays) || fertilizingEveryDays < 1)) {
      setPlantEditError("Fertilizing days must be empty or a whole number greater than 0.");
      return;
    }

    if (plantEditDraft.pruningEveryDays.trim().length > 0 && (!Number.isInteger(pruningEveryDays) || pruningEveryDays < 1)) {
      setPlantEditError("Pruning days must be empty or a whole number greater than 0.");
      return;
    }

    setPlantEditSaving(true);
    setPlantEditError(null);

    try {
      const response = await fetch(`${apiBase}/plants/${plantEditDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: plantEditDraft.nickname,
          species: plantEditDraft.species,
          zone: plantEditDraft.zone,
          notes: plantEditDraft.notes,
          healthState: plantEditDraft.healthState,
          schedule: {
            wateringEveryDays,
            ...(plantEditDraft.fertilizingEveryDays.trim().length > 0 ? { fertilizingEveryDays } : {}),
            ...(plantEditDraft.pruningEveryDays.trim().length > 0 ? { pruningEveryDays } : {}),
          },
        }),
      });

      if (!response.ok) {
        let reason = `Plant update failed with status ${response.status}`;
        try {
          const payload = (await response.json()) as { message?: string | string[] };
          if (Array.isArray(payload.message) && payload.message.length > 0) {
            reason = payload.message.join(", ");
          } else if (typeof payload.message === "string" && payload.message.trim().length > 0) {
            reason = payload.message;
          }
        } catch {
          // Ignore JSON parse errors and use status fallback.
        }
        throw new Error(reason);
      }

      await refreshPlantsAndDecision();
      setPlantEditDraft(null);
    } catch (error) {
      setPlantEditError(error instanceof Error ? error.message : "Unable to save plant changes.");
    } finally {
      setPlantEditSaving(false);
    }
  };

  const deletePlant = async (id: string): Promise<void> => {
    await fetch(`${apiBase}/plants/${id}`, { method: "DELETE" });
    await refreshPlantsAndDecision();
  };

  const markWatered = async (id: string): Promise<void> => {
    await fetch(`${apiBase}/plants/${id}/water`, { method: "POST" });
    await refreshPlantsAndDecision();
  };

  const uploadPlantImage = async (plantId: string, file: File): Promise<void> => {
    setImageUploadInFlightId(plantId);
    setImageUploadError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch(`${apiBase}/plants/${plantId}/image`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let reason = `Image upload failed with status ${response.status}`;
        if (response.status === 404) {
          reason = "Image upload endpoint is unavailable. Restart the backend to load latest routes.";
        }
        try {
          const payload = (await response.json()) as { message?: string | string[] };
          if (Array.isArray(payload.message) && payload.message.length > 0) {
            reason = payload.message.join(", ");
          } else if (typeof payload.message === "string" && payload.message.trim().length > 0) {
            reason = payload.message;
          }
        } catch {
          // Ignore JSON parse failures and keep status-based fallback reason.
        }
        throw new Error(reason);
      }

      await refreshPlantsAndDecision();
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "Unable to upload image.");
    } finally {
      setImageUploadInFlightId(null);
    }
  };

  const runSimulation = async (ruleId: string): Promise<void> => {
    await fetch(`${apiBase}/automation/rules/${ruleId}/simulate`, { method: "POST" });
  };

  const refreshRules = async (): Promise<void> => {
    const response = await fetch(`${apiBase}/automation/rules`);
    setRules((await response.json()) as AutomationRule[]);
  };

  const toggleRuleEnabled = async (ruleId: string, enabled: boolean): Promise<void> => {
    setRuleToggleInFlightId(ruleId);

    try {
      await fetch(`${apiBase}/automation/rules/${ruleId}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await refreshRules();
    } finally {
      setRuleToggleInFlightId(null);
    }
  };

  const evaluateAutomation = async (): Promise<void> => {
    const response = await fetch(`${apiBase}/automation/evaluate`, { method: "POST" });
    const payload = (await response.json()) as { executed: number };
    setLastEvaluationExecutions(payload.executed);
    await Promise.all([fetchRuntimeStatus(), fetchRuntimeHistory()]);
  };

  const createDeviceProfile = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await fetch(`${apiBase}/devices/profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: deviceName,
        connectionType: deviceType,
        transportTarget: deviceTarget,
        channelMap: {
          moisture: deviceMoistureChannel,
          light: deviceLightChannel,
          temperature: deviceTemperatureChannel,
        },
        calibration: {
          moistureDry: Number(deviceMoistureDry),
          moistureWet: Number(deviceMoistureWet),
        },
        isLive: false,
      }),
    });

    const profileResponse = await fetch(`${apiBase}/devices/profiles`);
    setDeviceProfiles((await profileResponse.json()) as DeviceProfile[]);
  };

  const updateProfileCalibration = async (
    id: string,
    calibration: Record<string, number>,
    channelMap: Record<string, string>,
  ): Promise<void> => {
    await fetch(`${apiBase}/devices/profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calibration, channelMap }),
    });

    const profileResponse = await fetch(`${apiBase}/devices/profiles`);
    setDeviceProfiles((await profileResponse.json()) as DeviceProfile[]);
  };

  const openProfileEditModal = (profile: DeviceProfile): void => {
    setProfileEditDraft({
      id: profile.id,
      name: profile.name,
      moistureDry: String(profile.calibration.moistureDry ?? 900),
      moistureWet: String(profile.calibration.moistureWet ?? 300),
      moistureChannel: profile.channelMap.moisture ?? "ch0",
      lightChannel: profile.channelMap.light ?? "ch1",
      temperatureChannel: profile.channelMap.temperature ?? "ch2",
    });
  };

  const saveProfileEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!profileEditDraft) {
      return;
    }

    setProfileEditSaving(true);
    try {
      await updateProfileCalibration(
        profileEditDraft.id,
        {
          moistureDry: Number(profileEditDraft.moistureDry),
          moistureWet: Number(profileEditDraft.moistureWet),
        },
        {
          moisture: profileEditDraft.moistureChannel,
          light: profileEditDraft.lightChannel,
          temperature: profileEditDraft.temperatureChannel,
        },
      );
      setProfileEditDraft(null);
    } finally {
      setProfileEditSaving(false);
    }
  };

  const testDeviceConnection = async (): Promise<void> => {
    const response = await fetch(
      `${apiBase}/devices/test?connectionType=${deviceType}&target=${encodeURIComponent(deviceTarget)}`,
    );
    setConnectionTest((await response.json()) as ConnectionTestResult);
  };

  const simulateProfile = async (id: string): Promise<void> => {
    await fetch(`${apiBase}/devices/profiles/${id}/simulate`, { method: "POST" });
  };

  const validateProfile = async (id: string): Promise<void> => {
    setProfileValidationInFlightId(id);
    setProfileValidationError(null);
    try {
      const response = await fetch(`${apiBase}/devices/profiles/${id}/validate`, { method: "POST" });
      if (!response.ok) {
        throw new Error(`Validation failed with status ${response.status}`);
      }

      const payload = (await response.json()) as DeviceProfileValidationResult;
      setProfileValidation((prev) => ({
        ...prev,
        [id]: payload,
      }));
    } catch (error) {
      setProfileValidationError(error instanceof Error ? error.message : "Unable to validate profile.");
    } finally {
      setProfileValidationInFlightId(null);
    }
  };

  const toggleLiveMode = async (id: string, isLive: boolean): Promise<void> => {
    const response = await fetch(`${apiBase}/devices/profiles/${id}/live`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isLive }),
    });

    if (!response.ok) {
      let message = `Live mode update failed with status ${response.status}`;
      try {
        const payload = (await response.json()) as { message?: string | string[] };
        if (Array.isArray(payload.message) && payload.message.length > 0) {
          message = payload.message.join(", ");
        } else if (typeof payload.message === "string" && payload.message.trim().length > 0) {
          message = payload.message;
        }
      } catch {
        // Keep fallback message.
      }
      setProfileValidationError(message);
      return;
    }

    const profileResponse = await fetch(`${apiBase}/devices/profiles`);
    setDeviceProfiles((await profileResponse.json()) as DeviceProfile[]);
  };

  const createRule = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await fetch(`${apiBase}/automation/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ruleName,
        enabled: true,
        condition: { metric: "moisture", operator: "<", value: 35 },
        action: { target: "pump", seconds: 8 },
        safety: { cooldownMinutes: 60, maxDailyRuntimeSeconds: 90 },
      }),
    });

    await refreshRules();
    setIsRuleModalOpen(false);
  };

  const applyTimelineFilters = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await fetchTimeline(timelineFilters);
  };

  const extractTimelinePlantId = (entry: AutomationTimelineEvent): string | null => {
    const payloadPlantId = entry.payload.plantId;
    if (payloadPlantId === undefined || payloadPlantId === null) {
      return null;
    }

    return String(payloadPlantId);
  };

  const renderPayloadPreview = (entry: AutomationTimelineEvent): string => {
    const payloadText = JSON.stringify(entry.payload);
    if (payloadText.length <= 120) {
      return payloadText;
    }

    return `${payloadText.slice(0, 120)}...`;
  };

  const updateTimelineSourceQuickFilter = (source: "" | "runtime" | "simulation"): void => {
    const nextFilters = { ...timelineFilters, source };
    setTimelineFilters(nextFilters);
    void fetchTimeline(nextFilters);
  };

  const jumpToPanel = (panel: "plants" | "devices" | "automation" | "diagrams"): void => {
    setActivePanel(panel);
    setQuickActionsOpen(false);
  };

  const onDiagramConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = diagramNodes.find((node: Node<DiagramNodeData>) => node.id === connection.source);
      const targetNode = diagramNodes.find((node: Node<DiagramNodeData>) => node.id === connection.target);
      const sourceKind = sourceNode?.data.kind ?? "trigger";
      const targetKind = targetNode?.data.kind ?? "trigger";

      if (!sourceNode || !targetNode || !connection.source || !connection.target) {
        setDiagramConnectionError("Connection failed: missing source or target node.");
        return;
      }

      if (connection.source === connection.target) {
        setDiagramConnectionError("Connection failed: self-connections are not allowed.");
        return;
      }

      const allowed =
        (sourceKind === "trigger" && (targetKind === "condition" || targetKind === "action")) ||
        (sourceKind === "condition" && (targetKind === "condition" || targetKind === "action"));

      if (!allowed) {
        setDiagramConnectionError(
          `Connection failed: ${sourceKind} -> ${targetKind} is not supported.`,
        );
        return;
      }

      const exists = diagramEdges.some(
        (edge: Edge) => edge.source === connection.source && edge.target === connection.target,
      );
      if (exists) {
        setDiagramConnectionError("Connection skipped: duplicate edge already exists.");
        return;
      }

      setDiagramConnectionError(null);
      setDiagramEdges((prev: Edge[]) =>
        addEdge(
          {
            ...connection,
            animated: true,
            type: "smoothstep",
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#5abde2",
            },
          },
          prev,
        ),
      );
    },
    [diagramEdges, diagramNodes, setDiagramEdges],
  );

  const addDiagramNode = (): void => {
    const id = `node-${Date.now()}`;
    const defaultsByKind: Record<DiagramNodeKind, DiagramNodeData> = {
      trigger: { label: "Plant Trigger", kind: "trigger", plantId: "" },
      condition: { label: "Condition", kind: "condition", metric: "moisture", operator: "<", value: 35 },
      action: {
        label: "Action",
        kind: "action",
        target: "pump",
        seconds: 8,
        cooldownMinutes: 60,
        maxDailyRuntimeSeconds: 90,
      },
    };

    const nextData = defaultsByKind[diagramNodeKindDraft];
    const nextNode: Node<DiagramNodeData> = {
      id,
      type: "flowNode",
      position: {
        x: 120 + Math.round(Math.random() * 260),
        y: 80 + Math.round(Math.random() * 220),
      },
      data: {
        ...nextData,
        label: `${nextData.label} ${diagramNodes.length + 1}`,
      },
    };

    setDiagramNodes((prev: Node<DiagramNodeData>[]) => [...prev, nextNode]);
    setSelectedDiagramNodeId(id);
  };

  const insertStarterAutomationFlow = (): void => {
    setDiagramNodes(defaultDiagramNodes);
    setDiagramEdges(defaultDiagramEdges);
    setSelectedDiagramNodeId("condition");
  };

  const applyDiagramToAutomation = async (): Promise<void> => {
    setDiagramApplyInFlight(true);
    setDiagramApplyError(null);
    setDiagramApplyResult(null);

    try {
      const response = await fetch(`${apiBase}/automation/diagram-scopes/dashboard/apply`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Apply flow failed with status ${response.status}`);
      }

      const payload = (await response.json()) as DiagramApplyResponse;
      const compiledCount = Number(payload.compiledRuleCount ?? 0);
      setDiagramPreviewIssues(Array.isArray(payload.issues) ? payload.issues : []);
      setDiagramApplyResult(`Applied flow successfully. ${compiledCount} rule(s) compiled.`);
      await Promise.all([
        refreshRules(),
        fetchTimeline(timelineFilters),
        fetchRuntimeStatus(),
        fetchRuntimeHistory(),
      ]);
    } catch (error) {
      setDiagramApplyError(error instanceof Error ? error.message : "Unable to apply flow.");
    } finally {
      setDiagramApplyInFlight(false);
    }
  };

  const previewDiagramFlow = async (): Promise<void> => {
    setDiagramPreviewInFlight(true);
    setDiagramApplyError(null);
    setDiagramPreviewResult(null);

    try {
      const response = await fetch(`${apiBase}/automation/diagram-scopes/dashboard/preview`);
      if (!response.ok) {
        throw new Error(`Preview flow failed with status ${response.status}`);
      }

      const payload = (await response.json()) as DiagramPreviewResponse;
      const compiledCount = Number(payload.compiledRuleCount ?? 0);
      setDiagramPreviewIssues(Array.isArray(payload.issues) ? payload.issues : []);
      setDiagramPreviewResult(`Preview complete. ${compiledCount} rule(s) ready to apply.`);
    } catch (error) {
      setDiagramApplyError(error instanceof Error ? error.message : "Unable to preview flow.");
    } finally {
      setDiagramPreviewInFlight(false);
    }
  };

  const removeSelectedDiagramNode = (): void => {
    if (!selectedDiagramNodeId) {
      return;
    }

    setDiagramNodes((prev: Node<DiagramNodeData>[]) => prev.filter((node: Node<DiagramNodeData>) => node.id !== selectedDiagramNodeId));
    setDiagramEdges((prev: Edge[]) => prev.filter((edge: Edge) => edge.source !== selectedDiagramNodeId && edge.target !== selectedDiagramNodeId));
    setSelectedDiagramNodeId(null);
  };

  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
  const liveProfileCount = deviceProfiles.filter((profile) => profile.isLive).length;
  const heroPlants = useMemo(() => {
    const dueIds = new Set(decision?.duePlantIds ?? []);
    const overdueIds = new Set(decision?.overduePlantIds ?? []);

    const scored = plants.map((plant) => {
      const overdue = overdueIds.has(plant.id);
      const due = dueIds.has(plant.id);
      const score = overdue ? 3 : due ? 2 : 1;

      return { plant, score };
    });

    return scored
      .sort((a, b) => b.score - a.score || a.plant.nickname.localeCompare(b.plant.nickname))
      .slice(0, 4)
      .map((entry) => entry.plant);
  }, [decision, plants]);

  return (
    <main className="app-shell dashboard-shell">
      <header className="app-header panel">
        <div>
          <p className="eyebrow">Control Center</p>
          <h1>Vibe Plant Platform</h1>
          <p className="muted">Daily care, telemetry, hardware, and automation in one dashboard.</p>
        </div>
        <div className="header-actions">
          <button type="button" className="ghost-button" onClick={() => setIsPlantModalOpen(true)}>
            Add Plant
          </button>
          <button type="button" className="accent-button" onClick={() => setIsRuleModalOpen(true)}>
            Create Rule
          </button>
        </div>
      </header>

      <section className="summary-row">
        <article className="summary-card">
          <p>Total Plants</p>
          <strong>{plants.length}</strong>
        </article>
        <article className="summary-card">
          <p>Due Today</p>
          <strong>{decision?.duePlantIds.length ?? 0}</strong>
        </article>
        <article className="summary-card">
          <p>Live Profiles</p>
          <strong>{liveProfileCount}</strong>
        </article>
        <article className="summary-card">
          <p>Enabled Rules</p>
          <strong>{enabledRuleCount}</strong>
        </article>
      </section>

      <section className="panel hero-plants-panel" aria-label="Featured plants">
        <div className="panel-header">
          <h2>Plant Focus</h2>
          <p className="muted">Daily priorities with quick care actions.</p>
        </div>
        {heroPlants.length === 0 ? <p className="muted">Add plants to unlock the hero garden view.</p> : null}
        <ul className="hero-plants-grid">
          {heroPlants.map((plant) => {
            const imageUrl = resolvePlantImageUrl(plant.imageUrl);
            const isOverdue = Boolean(decision?.overduePlantIds.includes(plant.id));
            const isDue = Boolean(decision?.duePlantIds.includes(plant.id));
            const statusLabel = isOverdue ? "Overdue" : isDue ? "Due Today" : "On Track";

            return (
              <li key={plant.id} className="hero-plant-card">
                {imageUrl ? (
                  <img className="hero-plant-image" src={imageUrl} alt={`${plant.nickname} hero view`} />
                ) : (
                  <div className="hero-plant-fallback" aria-hidden="true">
                    {plant.nickname.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="hero-plant-body">
                  <div className="hero-plant-head">
                    <strong>{plant.nickname}</strong>
                    <span className="state-pill">{statusLabel}</span>
                  </div>
                  <p className="muted">
                    {plant.species} in {plant.zone}
                  </p>
                  <div className="actions">
                    <button type="button" onClick={() => void markWatered(plant.id)}>
                      Mark Watered
                    </button>
                    <button type="button" className="ghost-button" onClick={() => openPlantEditModal(plant)}>
                      Open Details
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel quick-actions-panel">
        <div className="panel-header">
          <h2>Quick Actions</h2>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setQuickActionsOpen((prev) => !prev)}
            aria-expanded={quickActionsOpen}
            aria-controls="quick-actions-drawer"
          >
            {quickActionsOpen ? "Hide" : "Open"}
          </button>
        </div>
        <div id="quick-actions-drawer" className={`quick-actions-drawer ${quickActionsOpen ? "open" : ""}`}>
          <div className="quick-action-group">
            <button type="button" onClick={() => void evaluateAutomation()}>
              Evaluate Now
            </button>
            <button type="button" onClick={() => void fetchRuntimeStatus()} disabled={runtimeStatusLoading}>
              {runtimeStatusLoading ? "Refreshing..." : "Refresh Runtime Status"}
            </button>
            <button
              type="button"
              onClick={() => void fetchLatestTelemetrySnapshot(snapshotPlantIdFilter)}
              disabled={snapshotLoading}
            >
              {snapshotLoading ? "Refreshing..." : "Refresh Telemetry Snapshot"}
            </button>
          </div>
          <div className="quick-action-group">
            <button type="button" className="ghost-button" onClick={() => jumpToPanel("plants")}>
              Jump to Plants
            </button>
            <button type="button" className="ghost-button" onClick={() => jumpToPanel("devices")}>
              Jump to Devices
            </button>
            <button type="button" className="ghost-button" onClick={() => jumpToPanel("automation")}>
              Jump to Automation
            </button>
            <button type="button" className="ghost-button" onClick={() => jumpToPanel("diagrams")}>
              Jump to Diagrams
            </button>
          </div>
        </div>
      </section>

      <section className="panel automation-spotlight">
        <div className="panel-header">
          <h2>Automation Operations</h2>
          <div className="panel-actions">
            <button onClick={() => void evaluateAutomation()}>Evaluate Now</button>
            <button onClick={() => void fetchRuntimeStatus()} disabled={runtimeStatusLoading}>
              {runtimeStatusLoading ? "Refreshing..." : "Refresh Status"}
            </button>
          </div>
        </div>
        {lastEvaluationExecutions !== null ? (
          <p className="muted">Last runtime cycle executed {lastEvaluationExecutions} action(s)</p>
        ) : null}
        {runtimeStatusError ? <p className="muted">Runtime status error: {runtimeStatusError}</p> : null}
        <div className="runtime-status-grid">
          <article>
            <h4>Last Run</h4>
            <p>
              {runtimeStatus?.lastRunTime
                ? new Date(runtimeStatus.lastRunTime).toLocaleString()
                : runtimeStatusLoading
                  ? "Loading..."
                  : "Not yet"}
            </p>
          </article>
          <article>
            <h4>Last Execution Count</h4>
            <p>{runtimeStatus?.lastExecutionCount ?? 0}</p>
          </article>
          <article>
            <h4>Total Executions</h4>
            <p>{runtimeStatus?.totalExecutions ?? 0}</p>
          </article>
          <article>
            <h4>Blocked Cooldown</h4>
            <p>{runtimeStatus?.blockedCooldownCount ?? 0}</p>
          </article>
          <article>
            <h4>Blocked Daily Limit</h4>
            <p>{runtimeStatus?.blockedDailyLimitCount ?? 0}</p>
          </article>
        </div>
      </section>

      <section className="panel-tabs" role="tablist" aria-label="Dashboard sections">
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === "overview"}
          className={`tab-chip ${activePanel === "overview" ? "active" : ""}`}
          onClick={() => setActivePanel("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === "plants"}
          className={`tab-chip ${activePanel === "plants" ? "active" : ""}`}
          onClick={() => setActivePanel("plants")}
        >
          Plants
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === "devices"}
          className={`tab-chip ${activePanel === "devices" ? "active" : ""}`}
          onClick={() => setActivePanel("devices")}
        >
          Devices
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === "automation"}
          className={`tab-chip ${activePanel === "automation" ? "active" : ""}`}
          onClick={() => setActivePanel("automation")}
        >
          Timeline + Rules
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === "diagrams"}
          className={`tab-chip ${activePanel === "diagrams" ? "active" : ""}`}
          onClick={() => setActivePanel("diagrams")}
        >
          Diagrams
        </button>
      </section>

      {activePanel === "overview" ? (
        <section className="split">
          <section className="panel">
            <div className="panel-header">
              <h2>Daily Dashboard</h2>
            </div>
            {decision ? (
              <div className="dashboard-grid">
                <article>
                  <h3>Due Today</h3>
                  <p>{decision.duePlantIds.length}</p>
                </article>
                <article>
                  <h3>Overdue</h3>
                  <p>{decision.overduePlantIds.length}</p>
                </article>
                <article>
                  <h3>Alerts</h3>
                  <p>{decision.alerts.length === 0 ? "None" : decision.alerts.join(", ")}</p>
                </article>
              </div>
            ) : null}
            {decision ? (
              <p className="muted">
                Overdue plants: {decision.overduePlantIds.map((id) => plantLookup.get(id) ?? id).join(", ") || "none"}
              </p>
            ) : null}

            <details className="advanced-panel">
              <summary>Advanced platform health</summary>
              <div className="panel-header">
                <h3>Platform Health</h3>
                <button type="button" className="ghost-button" onClick={() => void fetchHealthDetails()} disabled={healthLoading}>
                  {healthLoading ? "Refreshing..." : "Refresh Health"}
                </button>
              </div>
              {healthError ? <p className="muted">Health error: {healthError}</p> : null}
              {healthDetails ? (
                <div className="dashboard-grid">
                  <article>
                    <h3>Service</h3>
                    <p>{healthDetails.status}</p>
                  </article>
                  <article>
                    <h3>DB</h3>
                    <p>{healthDetails.database?.ok ? "ok" : "degraded"}</p>
                  </article>
                  <article>
                    <h3>Uptime</h3>
                    <p>{Math.max(0, Math.floor(healthDetails.uptimeSeconds / 60))} min</p>
                  </article>
                  <article>
                    <h3>Plant Rows</h3>
                    <p>{healthDetails.database?.plantsCount ?? 0}</p>
                  </article>
                  <article>
                    <h3>Rules Rows</h3>
                    <p>{healthDetails.database?.automationRulesCount ?? 0}</p>
                  </article>
                  <article>
                    <h3>Events Rows</h3>
                    <p>{healthDetails.database?.automationEventsCount ?? 0}</p>
                  </article>
                </div>
              ) : null}
            </details>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Latest Telemetry Snapshot</h2>
              <div className="panel-actions">
                <input
                  value={snapshotPlantIdFilter}
                  onChange={(event) => setSnapshotPlantIdFilter(event.target.value)}
                  placeholder="plantId (optional)"
                  aria-label="Filter latest snapshot by plantId"
                />
                <button
                  onClick={() => void refreshTelemetryPanel()}
                  disabled={snapshotLoading || telemetryStatsLoading}
                >
                  {snapshotLoading || telemetryStatsLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            {snapshotError ? <p className="muted">Snapshot error: {snapshotError}</p> : null}
            {telemetryStatsError ? <p className="muted">Telemetry stats error: {telemetryStatsError}</p> : null}
            {telemetryStats ? (
              <div className="dashboard-grid" style={{ marginBottom: "0.7rem" }}>
                <article>
                  <h3>Ingest Events</h3>
                  <p>{telemetryStats.ingestCount}</p>
                </article>
                <article>
                  <h3>Cached Plants</h3>
                  <p>{telemetryStats.cachedPlantCount}</p>
                </article>
                <article>
                  <h3>Latest Hit Rate</h3>
                  <p>
                    {telemetryStats.latestLookup.hitRate === null
                      ? "n/a"
                      : `${Math.round(telemetryStats.latestLookup.hitRate * 100)}%`}
                  </p>
                </article>
                <article>
                  <h3>Latest Misses</h3>
                  <p>{telemetryStats.latestLookup.misses}</p>
                </article>
              </div>
            ) : null}
            {!snapshotLoading && latestTelemetrySnapshot.length === 0 ? <p className="muted">No telemetry yet.</p> : null}
            <ul className="snapshot-list">
              {latestTelemetrySnapshot.map((point) => (
                <li key={point.plantId} className="snapshot-item">
                  <strong>{plantLookup.get(point.plantId) ?? point.plantId}</strong>
                  <span>
                    Moisture {point.moisture}% | Light {point.light} lx | Temp {point.temperature}C |{" "}
                    {new Date(point.capturedAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </section>
      ) : null}

      {activePanel === "plants" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Plant Management</h2>
            <button className="accent-button" type="button" onClick={() => setIsPlantModalOpen(true)}>
              Add Plant
            </button>
          </div>
          {loading ? <p>Loading plants...</p> : null}
          {!loading && plants.length === 0 ? <p>No plants yet. Add your first plant from API.</p> : null}
          {imageUploadError ? <p className="muted">Image upload error: {imageUploadError}</p> : null}
          <ul className="plant-list">
            {plants.map((plant) => (
              <li key={plant.id} className="plant-item plant-hero-card compact-card">
                {resolvePlantImageUrl(plant.imageUrl) ? (
                  <img className="plant-hero-thumbnail" src={resolvePlantImageUrl(plant.imageUrl) ?? undefined} alt={`${plant.nickname} thumbnail`} />
                ) : (
                  <div className="plant-hero-fallback" aria-hidden="true">
                    {plant.nickname.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="plant-hero-content">
                  <div className="hero-plant-head">
                    <strong>{plant.nickname}</strong>
                    <span className="state-pill">{plant.healthState}</span>
                  </div>
                  <p>
                    {plant.species} - {plant.zone}
                  </p>
                  <p className="muted">Water every {plant.schedule.wateringEveryDays} day(s)</p>
                  <div className="actions">
                    <button type="button" onClick={() => void markWatered(plant.id)}>
                      Mark Watered
                    </button>
                    <button type="button" className="ghost-button" onClick={() => openPlantEditModal(plant)}>
                      Edit Plant
                    </button>
                  </div>
                  <details className="advanced-panel">
                    <summary>Advanced plant settings</summary>
                    {(() => {
                      const latestTelemetry = telemetry[plant.id];
                      return latestTelemetry ? (
                        <p className="muted">
                          Latest telemetry: Moisture {latestTelemetry.moisture}% | Temp {latestTelemetry.temperature}C
                        </p>
                      ) : (
                        <p className="muted">No telemetry yet</p>
                      );
                    })()}
                    <p className="muted">
                      Full schedule: water every {plant.schedule.wateringEveryDays}d
                      {plant.schedule.fertilizingEveryDays ? ` | fertilize every ${plant.schedule.fertilizingEveryDays}d` : ""}
                      {plant.schedule.pruningEveryDays ? ` | prune every ${plant.schedule.pruningEveryDays}d` : ""}
                    </p>
                    <div className="actions">
                      <label className="upload-button">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) {
                              void uploadPlantImage(plant.id, file);
                            }
                          }}
                          disabled={imageUploadInFlightId === plant.id}
                        />
                        {imageUploadInFlightId === plant.id ? "Uploading..." : "Upload Image"}
                      </label>
                      <button className="danger-button" onClick={() => void deletePlant(plant.id)}>
                        Delete Plant
                      </button>
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {activePanel === "diagrams" ? (
        <section className="panel diagram-panel">
          <div className="panel-header">
            <h2>Editable Diagrams</h2>
          </div>
          <p className="muted">Drag nodes, connect handles, and edit fields directly in the nodes. Changes sync automatically.</p>
          <p className="muted">
            {diagramSaving ? "Saving diagram..." : "Diagram sync idle."}
            {diagramLastSavedAt ? ` Last saved ${new Date(diagramLastSavedAt).toLocaleString()}.` : ""}
            {diagramSyncError ? ` Sync error: ${diagramSyncError}` : ""}
          </p>
          {diagramPreviewResult ? <p className="muted">{diagramPreviewResult}</p> : null}
          {diagramApplyResult ? <p className="muted">{diagramApplyResult}</p> : null}
          {diagramApplyError ? <p className="muted">Flow apply error: {diagramApplyError}</p> : null}
          {diagramConnectionError ? <p className="muted">Flow editor warning: {diagramConnectionError}</p> : null}
          {diagramPreviewIssues.length > 0 ? (
            <ul className="diagram-issues-list">
              {diagramPreviewIssues.map((issue, index) => (
                <li key={`${issue.code}-${index}`} className={`diagram-issue ${issue.severity}`}>
                  <strong>{issue.severity.toUpperCase()}</strong> {issue.code}: {issue.message}
                  {issue.nodeId ? ` (node ${issue.nodeId})` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="diagram-canvas" role="region" aria-label="Editable workflow diagram">
            <div className="diagram-canvas-toolbar" role="toolbar" aria-label="Diagram canvas actions">
              <button type="button" className="icon-button" title="Reload" onClick={() => void loadDiagramSnapshotFromApi()} disabled={diagramLoading}>
                {diagramLoading ? "..." : "↻"}
              </button>
              <select
                value={diagramNodeKindDraft}
                onChange={(event) => setDiagramNodeKindDraft(event.target.value as DiagramNodeKind)}
                aria-label="New node type"
              >
                <option value="trigger">Trigger</option>
                <option value="condition">Condition</option>
                <option value="action">Action</option>
              </select>
              <button type="button" className="icon-button" title="Add node" onClick={addDiagramNode}>
                +
              </button>
              <button type="button" className="icon-button" title="Starter flow" onClick={insertStarterAutomationFlow}>
                ⚡
              </button>
              <button
                type="button"
                className="icon-button"
                title="Preview flow"
                onClick={() => void previewDiagramFlow()}
                disabled={diagramPreviewInFlight}
              >
                {diagramPreviewInFlight ? "..." : "👁"}
              </button>
              <button
                type="button"
                className="icon-button apply"
                title="Apply flow"
                onClick={() => void applyDiagramToAutomation()}
                disabled={diagramApplyInFlight}
              >
                {diagramApplyInFlight ? "..." : "▶"}
              </button>
              <button
                type="button"
                className="icon-button danger"
                title="Delete selected"
                onClick={removeSelectedDiagramNode}
                disabled={!selectedDiagramNodeId}
              >
                ⌫
              </button>
            </div>
            {diagramReady ? (
              <ReactFlow
                nodes={diagramNodesForCanvas}
                edges={diagramEdges}
                nodeTypes={flowNodeTypes}
                defaultEdgeOptions={{
                  type: "smoothstep",
                  animated: true,
                  markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: "#5abde2",
                  },
                }}
                connectionLineType={ConnectionLineType.SmoothStep}
                onNodesChange={onDiagramNodesChange}
                onEdgesChange={onDiagramEdgesChange}
                onConnect={onDiagramConnect}
                onNodeClick={(_event: unknown, node: Node<DiagramNodeData>) => {
                  setSelectedDiagramNodeId(node.id);
                }}
                onPaneClick={() => {
                  setSelectedDiagramNodeId(null);
                }}
                fitView
              >
                <Controls />
                <Background gap={18} color="#2f4f6e" />
              </ReactFlow>
            ) : null}
          </div>
        </section>
      ) : null}

      {activePanel === "devices" ? (
        <section className="split">
          <section className="panel">
            <div className="panel-header">
              <h2>Hardware Setup</h2>
            </div>
            <p className="muted">Manage saved profiles first, then open advanced setup to add or calibrate hardware.</p>
            <details className="advanced-panel">
              <summary>Advanced device setup</summary>
              <form className="inline-form" onSubmit={(event) => void createDeviceProfile(event)}>
                <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} aria-label="Device name" />
                <select
                  value={deviceType}
                  onChange={(event) => setDeviceType(event.target.value as "serial" | "network" | "bluetooth")}
                  aria-label="Device connection type"
                >
                  <option value="serial">serial</option>
                  <option value="network">network</option>
                  <option value="bluetooth">bluetooth</option>
                </select>
                <input value={deviceTarget} onChange={(event) => setDeviceTarget(event.target.value)} aria-label="Device target" />
                <input
                  value={deviceMoistureChannel}
                  onChange={(event) => setDeviceMoistureChannel(event.target.value)}
                  placeholder="moisture channel"
                />
                <input
                  value={deviceLightChannel}
                  onChange={(event) => setDeviceLightChannel(event.target.value)}
                  placeholder="light channel"
                />
                <input
                  value={deviceTemperatureChannel}
                  onChange={(event) => setDeviceTemperatureChannel(event.target.value)}
                  placeholder="temperature channel"
                />
                <input
                  value={deviceMoistureDry}
                  onChange={(event) => setDeviceMoistureDry(event.target.value)}
                  placeholder="moisture dry"
                />
                <input
                  value={deviceMoistureWet}
                  onChange={(event) => setDeviceMoistureWet(event.target.value)}
                  placeholder="moisture wet"
                />
                <button type="submit">Save Profile</button>
              </form>
              <div className="inline-actions">
                <button onClick={() => void testDeviceConnection()}>Test Connection</button>
                {connectionTest ? (
                  <small>
                    {connectionTest.ok ? "ok" : "failed"} {connectionTest.latencyMs}ms - {connectionTest.message}
                  </small>
                ) : null}
              </div>
              <ul className="simple-list">
                {discovery.map((entry) => (
                  <li key={entry.connectionType} className="compact-card">
                    <strong>{entry.connectionType}</strong>: {entry.options.join(", ")}
                  </li>
                ))}
              </ul>
            </details>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Saved Profiles</h2>
            </div>
            {profileValidationError ? <p className="muted">Profile validation error: {profileValidationError}</p> : null}
            <ul className="simple-list">
              {deviceProfiles.map((profile) => (
                <li key={profile.id} className="compact-card">
                  <div className="profile-head">
                    <strong>{profile.name}</strong>
                    <span className="state-pill">{profile.isLive ? "live" : "sim"}</span>
                  </div>
                  <p className="muted">{profile.connectionType}</p>
                  <p className="muted">
                    Calibration dry/wet: {profile.calibration.moistureDry ?? 900}/{profile.calibration.moistureWet ?? 300}
                  </p>
                  <p className="muted">
                    Channels: M {profile.channelMap.moisture ?? "ch0"} | L {profile.channelMap.light ?? "ch1"} | T{" "}
                    {profile.channelMap.temperature ?? "ch2"}
                  </p>
                  <div className="actions">
                    <button type="button" className="ghost-button" onClick={() => openProfileEditModal(profile)}>
                      Edit Profile
                    </button>
                    <button onClick={() => void simulateProfile(profile.id)}>Run Sim</button>
                    <button onClick={() => void validateProfile(profile.id)} disabled={profileValidationInFlightId === profile.id}>
                      {profileValidationInFlightId === profile.id ? "Validating..." : "Validate"}
                    </button>
                    <button onClick={() => void toggleLiveMode(profile.id, !profile.isLive)}>
                      {profile.isLive ? "Disable Live" : "Enable Live"}
                    </button>
                  </div>
                  {profileValidation[profile.id] ? (
                    <div className="profile-validation-block">
                      <small>
                        Validation: {profileValidation[profile.id]?.ok ? "ready" : "issues found"}
                      </small>
                      {profileValidation[profile.id]?.issues.length ? (
                        <ul className="profile-validation-list">
                          {profileValidation[profile.id]?.issues.map((issue, index) => (
                            <li key={`${profile.id}-${issue.code}-${index}`} className={`issue-${issue.severity}`}>
                              [{issue.severity}] {issue.message}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <small>No issues reported.</small>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </section>
      ) : null}

      {activePanel === "automation" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Rules and Timeline</h2>
            <button className="accent-button" type="button" onClick={() => setIsRuleModalOpen(true)}>
              Create Rule
            </button>
          </div>

          {rules.length === 0 ? <p>No rules yet.</p> : null}
          <ul className="simple-list">
            {rules.map((rule) => (
              <li key={rule.id} className="compact-card">
                <div className="profile-head">
                  <strong>{rule.name}</strong>
                  <span className="state-pill">{rule.enabled ? "enabled" : "disabled"}</span>
                </div>
                <div className="actions">
                  <button onClick={() => void runSimulation(rule.id)}>Simulate</button>
                  <button
                    onClick={() => void toggleRuleEnabled(rule.id, !rule.enabled)}
                    disabled={ruleToggleInFlightId === rule.id}
                  >
                    {ruleToggleInFlightId === rule.id ? "Saving..." : rule.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <details className="advanced-panel">
            <summary>Advanced runtime and timeline</summary>

            <h3>Runtime Trend (Recent)</h3>
            <div className="inline-actions">
              <button type="button" className="ghost-button" onClick={() => void fetchRuntimeHistory()} disabled={runtimeHistoryLoading}>
                {runtimeHistoryLoading ? "Refreshing..." : "Refresh Runtime History"}
              </button>
              {runtimeHistoryError ? <small>History error: {runtimeHistoryError}</small> : null}
            </div>
            {runtimeHistory.length === 0 && !runtimeHistoryLoading ? <p className="muted">No runtime history yet.</p> : null}
            <div className="runtime-history-bars" aria-label="Automation runtime trend">
              {runtimeHistory.map((entry) => {
                const barHeight = Math.max(14, Math.min(100, entry.executedCount * 12));
                return (
                  <article key={entry.id} className="runtime-history-bar" title={new Date(entry.capturedAt).toLocaleString()}>
                    <span className="runtime-bar-fill" style={{ height: `${barHeight}%` }} />
                    <strong>{entry.executedCount}</strong>
                    <small>{new Date(entry.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                  </article>
                );
              })}
            </div>

            <h3>Automation Timeline</h3>
            <div className="source-filter-row" role="group" aria-label="Quick source filters">
              <button
                type="button"
                className={`source-chip ${timelineFilters.source === "" ? "active" : ""}`}
                onClick={() => updateTimelineSourceQuickFilter("")}
              >
                All
              </button>
              <button
                type="button"
                className={`source-chip ${timelineFilters.source === "runtime" ? "active" : ""}`}
                onClick={() => updateTimelineSourceQuickFilter("runtime")}
              >
                Runtime
              </button>
              <button
                type="button"
                className={`source-chip ${timelineFilters.source === "simulation" ? "active" : ""}`}
                onClick={() => updateTimelineSourceQuickFilter("simulation")}
              >
                Simulation
              </button>
            </div>
            <form className="timeline-form" onSubmit={(event) => void applyTimelineFilters(event)}>
              <input
                value={timelineFilters.ruleId}
                onChange={(event) =>
                  setTimelineFilters((prev) => ({
                    ...prev,
                    ruleId: event.target.value,
                  }))
                }
                placeholder="ruleId (optional)"
              />
              <input
                value={timelineFilters.plantId}
                onChange={(event) =>
                  setTimelineFilters((prev) => ({
                    ...prev,
                    plantId: event.target.value,
                  }))
                }
                placeholder="plantId (optional)"
              />
              <input
                value={timelineFilters.source}
                onChange={(event) =>
                  setTimelineFilters((prev) => ({
                    ...prev,
                    source: event.target.value,
                  }))
                }
                placeholder="source (optional)"
              />
              <input
                type="number"
                min={1}
                max={200}
                value={timelineFilters.limit}
                onChange={(event) =>
                  setTimelineFilters((prev) => ({
                    ...prev,
                    limit: event.target.value,
                  }))
                }
                placeholder="limit"
              />
              <button type="submit" disabled={timelineLoading}>
                Apply Filters
              </button>
              <button type="button" onClick={() => void fetchTimeline(timelineFilters)} disabled={timelineLoading}>
                Refresh
              </button>
            </form>

            {timelineError ? <p className="muted">Timeline error: {timelineError}</p> : null}
            {timelineLoading ? <p>Loading timeline...</p> : null}
            {!timelineLoading && sortedTimeline.length === 0 ? <p>No timeline events for current filters.</p> : null}
            <ul className="timeline-list">
              {sortedTimeline.map((entry) => {
                const plantId = extractTimelinePlantId(entry);
                const isExpanded = Boolean(expandedTimelineEvents[entry.id]);
                return (
                  <li key={entry.id} className="timeline-item">
                    <div className="timeline-meta">
                      <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                      <span>ruleId: {entry.ruleId}</span>
                      <span>source: {entry.source}</span>
                    </div>
                    <p>reason: {entry.reason}</p>
                    {plantId ? <p>plantId: {plantId}</p> : null}
                    <p className="muted payload-preview">payload: {renderPayloadPreview(entry)}</p>
                    <button
                      type="button"
                      className="payload-toggle"
                      onClick={() =>
                        setExpandedTimelineEvents((prev) => ({
                          ...prev,
                          [entry.id]: !prev[entry.id],
                        }))
                      }
                    >
                      {isExpanded ? "Hide payload" : "View payload"}
                    </button>
                    {isExpanded ? <pre className="payload-details">{JSON.stringify(entry.payload, null, 2)}</pre> : null}
                  </li>
                );
              })}
            </ul>
          </details>
        </section>
      ) : null}

      {isPlantModalOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => setIsPlantModalOpen(false)}>
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Add plant"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Add Plant</h2>
              <button type="button" className="ghost-button" onClick={() => setIsPlantModalOpen(false)}>
                Close
              </button>
            </div>
            <form className="plant-form" onSubmit={(event) => void submitPlant(event)}>
              <input
                required
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Nickname"
              />
              <input
                required
                value={draftSpecies}
                onChange={(event) => setDraftSpecies(event.target.value)}
                placeholder="Species"
              />
              <input value={draftZone} onChange={(event) => setDraftZone(event.target.value)} placeholder="Zone" />
              <button type="submit">Save Plant</button>
            </form>
          </section>
        </div>
      ) : null}

      {profileEditDraft ? (
        <div className="modal-overlay" role="presentation" onClick={() => setProfileEditDraft(null)}>
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Edit device profile"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Edit {profileEditDraft.name}</h2>
              <button type="button" className="ghost-button" onClick={() => setProfileEditDraft(null)}>
                Close
              </button>
            </div>
            <form className="inline-form" onSubmit={(event) => void saveProfileEdit(event)}>
              <input
                type="number"
                value={profileEditDraft.moistureDry}
                onChange={(event) =>
                  setProfileEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          moistureDry: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="moisture dry"
              />
              <input
                type="number"
                value={profileEditDraft.moistureWet}
                onChange={(event) =>
                  setProfileEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          moistureWet: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="moisture wet"
              />
              <input
                value={profileEditDraft.moistureChannel}
                onChange={(event) =>
                  setProfileEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          moistureChannel: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="moisture channel"
              />
              <input
                value={profileEditDraft.lightChannel}
                onChange={(event) =>
                  setProfileEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          lightChannel: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="light channel"
              />
              <input
                value={profileEditDraft.temperatureChannel}
                onChange={(event) =>
                  setProfileEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          temperatureChannel: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="temperature channel"
              />
              <button type="submit" disabled={profileEditSaving}>
                {profileEditSaving ? "Saving..." : "Save Profile"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {plantEditDraft ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            if (!plantEditSaving) {
              setPlantEditDraft(null);
              setPlantEditError(null);
            }
          }}
        >
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Edit plant"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Edit {plantEditDraft.nickname}</h2>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setPlantEditDraft(null);
                  setPlantEditError(null);
                }}
                disabled={plantEditSaving}
              >
                Close
              </button>
            </div>
            {plantEditError ? <p className="muted">Save error: {plantEditError}</p> : null}
            <form className="plant-form" onSubmit={(event) => void savePlantEdit(event)}>
              <input
                required
                value={plantEditDraft.nickname}
                onChange={(event) =>
                  setPlantEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          nickname: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="Nickname"
              />
              <input
                required
                value={plantEditDraft.species}
                onChange={(event) =>
                  setPlantEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          species: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="Species"
              />
              <input
                required
                value={plantEditDraft.zone}
                onChange={(event) =>
                  setPlantEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          zone: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="Zone"
              />
              <select
                value={plantEditDraft.healthState}
                onChange={(event) =>
                  setPlantEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          healthState: event.target.value as PlantRecord["healthState"],
                        }
                      : prev,
                  )
                }
                aria-label="Health state"
              >
                <option value="excellent">excellent</option>
                <option value="good">good</option>
                <option value="watch">watch</option>
                <option value="critical">critical</option>
              </select>
              <textarea
                value={plantEditDraft.notes}
                onChange={(event) =>
                  setPlantEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          notes: event.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="Notes"
                className="notes-input"
              />
              <div className="schedule-grid">
                <input
                  required
                  type="number"
                  min={1}
                  value={plantEditDraft.wateringEveryDays}
                  onChange={(event) =>
                    setPlantEditDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            wateringEveryDays: event.target.value,
                          }
                        : prev,
                    )
                  }
                  placeholder="Water every (days)"
                />
                <input
                  type="number"
                  min={1}
                  value={plantEditDraft.fertilizingEveryDays}
                  onChange={(event) =>
                    setPlantEditDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            fertilizingEveryDays: event.target.value,
                          }
                        : prev,
                    )
                  }
                  placeholder="Fertilize every (days)"
                />
                <input
                  type="number"
                  min={1}
                  value={plantEditDraft.pruningEveryDays}
                  onChange={(event) =>
                    setPlantEditDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            pruningEveryDays: event.target.value,
                          }
                        : prev,
                    )
                  }
                  placeholder="Prune every (days)"
                />
              </div>
              <button type="submit" disabled={plantEditSaving}>
                {plantEditSaving ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {isRuleModalOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => setIsRuleModalOpen(false)}>
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Create automation rule"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Create Rule</h2>
              <button type="button" className="ghost-button" onClick={() => setIsRuleModalOpen(false)}>
                Close
              </button>
            </div>
            <form className="inline-form modal-rule-form" onSubmit={(event) => void createRule(event)}>
              <input value={ruleName} onChange={(event) => setRuleName(event.target.value)} />
              <button type="submit">Save Rule</button>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
