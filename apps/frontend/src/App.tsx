import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlantRecord, TelemetryPoint } from "@vibe/shared";
import { io } from "socket.io-client";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

const apiBase = (import.meta.env.VITE_API_BASE_URL?.trim() || "/api").replace(/\/$/, "");
const authDeviceKey = "vibe_auth_device";
const unauthorizedEvent = "vibe:auth-unauthorized";

const getBrowserOrigin = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.location.origin;
};

type DailyDecision = {
  date: string;
  duePlantIds: string[];
  overduePlantIds: string[];
  alerts: string[];
};

type PanelId = "overview" | "plants" | "devices" | "graphs" | "logs" | "flows";

type TelemetryView = {
  moisture?: number;
  light?: number;
  temperature?: number;
  humidity?: number;
  reservoirLevel?: number;
  capturedAt: string;
  sourceProfileId?: string;
  sourceProfileName?: string;
};

type DeviceMeasurementType = "moisture" | "temperature" | "light" | "humidity" | "reservoirLevel";

type GraphMetric = DeviceMeasurementType;

type GraphRange = "minute" | "hour" | "day" | "week" | "month" | "year";

type GraphViewMode = "allPlantsSingleMetric" | "singlePlantOverlay";

type DeviceTemperatureUnit = "celsius" | "fahrenheit";

type DeviceAssignmentIoType = "input" | "output";

type DeviceChannelAssignment = {
  channel: string;
  plantId?: string;
  measurementType?: DeviceMeasurementType;
  ioType?: DeviceAssignmentIoType;
  outputLabel?: string;
  calibration?: {
    inputMin?: number;
    inputMax?: number;
    clamp?: boolean;
    inputUnit?: DeviceTemperatureUnit;
    outputUnit?: DeviceTemperatureUnit;
  };
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
  channelMap?: Record<string, string>;
  calibration?: Record<string, number>;
  plantIds?: string[];
  channelAssignments: DeviceChannelAssignment[];
  isLive: boolean;
};

type ChannelProbeResult = {
  ok: boolean;
  channels: string[];
  message: string;
  sample?: string;
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

type SessionStatus = {
  authenticated: boolean;
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

type DeviceChannelAssignmentDraft = {
  channel: string;
  discovered: boolean;
  plantId: string;
  measurementType: DeviceMeasurementType;
  ioType: DeviceAssignmentIoType;
  outputLabel: string;
  inputMin: string;
  inputMax: string;
  clamp: boolean;
  temperatureInputUnit: DeviceTemperatureUnit;
  temperatureOutputUnit: DeviceTemperatureUnit;
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

type DiagramActionType = "deviceOutput" | "updatePlantStatus";

type DiagramNodeData = {
  label: string;
  kind?: DiagramNodeKind;
  plantId?: string;
  plantOptions?: Array<{ id: string; label: string; imageUrl?: string }>;
  plantImageUrl?: string;
  metric?: DiagramMetric;
  operator?: DiagramOperator;
  value?: number;
  actionType?: DiagramActionType;
  target?: string;
  status?: PlantRecord["healthState"];
  outputOptions?: Array<{ value: string; label: string }>;
  seconds?: number;
  cooldownMinutes?: number;
  maxDailyRuntimeSeconds?: number;
  readOnly?: boolean;
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

type PlantGraphPoint = {
  plantId: string;
  nickname: string;
  imageUrl?: string;
  capturedAt: string;
  moisture?: number;
  light?: number;
  temperature?: number;
  humidity?: number;
  reservoirLevel?: number;
};

type GraphChartRow = {
  timestamp: string;
  ts: number;
  [key: string]: string | number | undefined;
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
    data: { label: "Trigger", kind: "trigger", plantId: "", metric: "moisture", operator: "<", value: 35 },
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
      label: "Device Output",
      kind: "action",
      actionType: "deviceOutput",
      target: "",
      status: "watch",
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

const defaultTargetByConnectionType: Record<DeviceProfile["connectionType"], string> = {
  serial: "COM3",
  network: "192.168.1.25:4000",
  bluetooth: "BT-SOIL-01",
};

const connectionTargetHint: Record<DeviceProfile["connectionType"], string> = {
  serial: "Use COM format like COM3.",
  network: "Use IPv4:port like 192.168.1.25:4000.",
  bluetooth: "Use BT-NAME-N format like BT-SOIL-01.",
};

const measurementTypeOptions: DeviceMeasurementType[] = [
  "moisture",
  "temperature",
  "light",
  "humidity",
  "reservoirLevel",
];

const graphMetricOptions: Array<{ value: GraphMetric; label: string; unit: string }> = [
  { value: "moisture", label: "Moisture", unit: "%" },
  { value: "humidity", label: "Humidity", unit: "%" },
  { value: "temperature", label: "Temperature", unit: "" },
  { value: "light", label: "Light", unit: "" },
  { value: "reservoirLevel", label: "Reservoir", unit: "%" },
];

const graphRangeOptions: Array<{ value: GraphRange; label: string }> = [
  { value: "minute", label: "Minute" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const graphLinePalette = ["#53d2a8", "#58b2f4", "#f1c15e", "#ff7e95", "#9f9df3", "#4fdad3", "#f5946d"];

const graphRangeWindowMs: Record<GraphRange, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 31 * 24 * 60 * 60 * 1000,
  year: 366 * 24 * 60 * 60 * 1000,
};

const graphHistoryFetchRangeByRange: Record<GraphRange, "day" | "week" | "month" | "year"> = {
  minute: "day",
  hour: "day",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

const graphSmoothingBucketMsByRange: Record<GraphRange, number> = {
  minute: 1000,
  hour: 60 * 1000,
  day: 5 * 60 * 1000,
  week: 30 * 60 * 1000,
  month: 2 * 60 * 60 * 1000,
  year: 24 * 60 * 60 * 1000,
};

const maxGraphHistoryPoints = 50_000;
const graphDomainFutureToleranceMs = 5_000;

const formatGraphTick = (timestamp: number, range: GraphRange): string => {
  const date = new Date(timestamp);
  if (range === "minute") {
    return date
      .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .toLowerCase();
  }

  if (range === "hour") {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (range === "day") {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (range === "week") {
    return date.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }

  if (range === "month") {
    return date.toLocaleDateString([], { month: "short", day: "2-digit" });
  }

  return date.toLocaleDateString([], { month: "short", year: "2-digit" });
};

const formatGraphTooltipLabel = (timestamp: number, range: GraphRange): string => {
  if (range === "minute") {
    return new Date(timestamp)
      .toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      .toLowerCase();
  }

  return new Date(timestamp)
    .toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })
    .toLowerCase();
};

const getRangeStartTimestamp = (range: GraphRange, now: Date): number => {
  if (range === "minute") {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      0,
      0,
    ).getTime();
  }

  if (range === "hour") {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0,
    ).getTime();
  }

  if (range === "day") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  }

  if (range === "week") {
    const dayIndex = now.getDay();
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - dayIndex,
      0,
      0,
      0,
      0,
    ).getTime();
  }

  if (range === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
  }

  return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
};

const createAssignmentDraft = (channel: string, discovered = true): DeviceChannelAssignmentDraft => ({
  channel,
  discovered,
  plantId: "",
  measurementType: "moisture",
  ioType: "input",
  outputLabel: "",
  inputMin: "",
  inputMax: "",
  clamp: true,
  temperatureInputUnit: "celsius",
  temperatureOutputUnit: "celsius",
});

const toAssignmentDraft = (assignment: DeviceChannelAssignment): DeviceChannelAssignmentDraft => ({
  channel: assignment.channel,
  discovered: false,
  plantId: assignment.plantId ?? "",
  measurementType: assignment.measurementType ?? "moisture",
  ioType: assignment.ioType === "output" ? "output" : "input",
  outputLabel: assignment.outputLabel ?? "",
  inputMin: assignment.calibration?.inputMin === undefined ? "" : String(assignment.calibration.inputMin),
  inputMax: assignment.calibration?.inputMax === undefined ? "" : String(assignment.calibration.inputMax),
  clamp: assignment.calibration?.clamp !== false,
  temperatureInputUnit: assignment.calibration?.inputUnit === "fahrenheit" ? "fahrenheit" : "celsius",
  temperatureOutputUnit: assignment.calibration?.outputUnit === "fahrenheit" ? "fahrenheit" : "celsius",
});

const toChannelAssignmentsPayload = (
  drafts: DeviceChannelAssignmentDraft[],
): DeviceChannelAssignment[] => {
  return drafts
    .filter((draft) => draft.channel.trim().length > 0)
    .map((draft) => {
      const inputMin = Number(draft.inputMin);
      const inputMax = Number(draft.inputMax);

      const calibration =
        draft.ioType === "input" && draft.measurementType === "moisture"
          ? {
              ...(Number.isFinite(inputMin) ? { inputMin } : {}),
              ...(Number.isFinite(inputMax) ? { inputMax } : {}),
              clamp: draft.clamp,
            }
          : draft.ioType === "input" && draft.measurementType === "temperature"
            ? {
                inputUnit: draft.temperatureInputUnit,
                outputUnit: draft.temperatureOutputUnit,
              }
          : undefined;

      return {
        channel: draft.channel.trim(),
        ioType: draft.ioType,
        ...(draft.ioType === "input"
          ? {
              plantId: draft.plantId,
              measurementType: draft.measurementType,
            }
          : {
              outputLabel: draft.outputLabel.trim().length > 0 ? draft.outputLabel.trim() : draft.channel.trim(),
            }),
        ...(calibration ? { calibration } : {}),
      };
    })
    .filter(
      (assignment) =>
        assignment.channel.length > 0 &&
        ((assignment.ioType ?? "input") === "output" ||
          (("plantId" in assignment && Boolean(assignment.plantId)) &&
            ("measurementType" in assignment && Boolean(assignment.measurementType)))),
    );
};

const nextManualOutputChannel = (drafts: DeviceChannelAssignmentDraft[]): string => {
  const used = new Set(drafts.map((entry) => entry.channel.trim().toLowerCase()));
  let index = 1;
  while (used.has(`output-${index}`)) {
    index += 1;
  }
  return `output-${index}`;
};

function FlowNodeCard({ data, selected }: NodeProps<DiagramNodeData>): JSX.Element {
  const kind = data.kind ?? "trigger";
  const canTarget = kind !== "trigger";
  const canSource = kind !== "action";
  const readOnly = data.readOnly === true;

  return (
    <div className={`flow-node-card ${selected ? "selected" : ""}`}>
      {canTarget ? <Handle type="target" position={Position.Left} className="flow-handle flow-handle-target" /> : null}
      {canSource ? <Handle type="source" position={Position.Right} className="flow-handle flow-handle-source" /> : null}
      {kind === "action" ? (
        <div className="flow-node-head">
          <input
            className="flow-node-input flow-node-label-input nodrag nopan"
            value={data.label ?? ""}
            onChange={(event) => data.onLabelChange?.(event.target.value)}
            aria-label={`${kind} label`}
            disabled={readOnly}
          />
          <span className="flow-node-kind">{kind}</span>
        </div>
      ) : (
        <div className="flow-node-head flow-node-head-minimal">
          <span className="flow-node-kind">{kind}</span>
        </div>
      )}

      {kind === "trigger" ? (
        <div className="flow-node-grid condition-grid flow-node-plant-first">
          <div className="trigger-config-row">
            {data.plantImageUrl ? <img className="trigger-plant-icon" src={data.plantImageUrl} alt="Selected plant" /> : null}
            <select
              className="flow-node-input nodrag nopan"
              value={data.plantId ?? ""}
              onChange={(event) => data.onPatch?.({ plantId: event.target.value })}
              aria-label="Trigger plant"
              disabled={readOnly}
            >
              <option value="">Any plant</option>
              {(data.plantOptions ?? []).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <select
            className="flow-node-input nodrag nopan"
            value={data.metric ?? "moisture"}
            onChange={(event) => data.onPatch?.({ metric: event.target.value as DiagramMetric })}
            aria-label="Trigger metric"
            disabled={readOnly}
          >
            <option value="moisture">moisture</option>
            <option value="light">light</option>
            <option value="temperature">temperature</option>
          </select>
          <select
            className="flow-node-input nodrag nopan"
            value={data.operator ?? "<"}
            onChange={(event) => data.onPatch?.({ operator: event.target.value as DiagramOperator })}
            aria-label="Trigger operator"
            disabled={readOnly}
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
            placeholder="trigger threshold"
            aria-label="Trigger threshold"
            disabled={readOnly}
          />
        </div>
      ) : null}

      {kind === "condition" ? (
        <div className="flow-node-grid condition-grid flow-node-plant-first">
          <select
            className="flow-node-input nodrag nopan"
            value={data.plantId ?? ""}
            onChange={(event) => data.onPatch?.({ plantId: event.target.value })}
            aria-label="Condition plant"
            disabled={readOnly}
          >
            <option value="">Any plant</option>
            {(data.plantOptions ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="flow-node-input nodrag nopan"
            value={data.metric ?? "moisture"}
            onChange={(event) => data.onPatch?.({ metric: event.target.value as DiagramMetric })}
            aria-label="Condition metric"
            disabled={readOnly}
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
            disabled={readOnly}
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
            disabled={readOnly}
          />
        </div>
      ) : null}

      {kind === "action" ? (
        <div className="flow-node-grid action-grid">
          <select
            className="flow-node-input nodrag nopan"
            value={data.actionType ?? "deviceOutput"}
            onChange={(event) => data.onPatch?.({ actionType: event.target.value as DiagramActionType })}
            aria-label="Action type"
            disabled={readOnly}
          >
            <option value="deviceOutput">device output</option>
            <option value="updatePlantStatus">update plant status</option>
          </select>

          {data.actionType === "updatePlantStatus" ? (
            <select
              className="flow-node-input nodrag nopan"
              value={data.status ?? "watch"}
              onChange={(event) => data.onPatch?.({ status: event.target.value as PlantRecord["healthState"] })}
              aria-label="Plant status"
              disabled={readOnly}
            >
              <option value="excellent">excellent</option>
              <option value="good">good</option>
              <option value="watch">watch</option>
              <option value="critical">critical</option>
            </select>
          ) : (
          <select
            className="flow-node-input nodrag nopan"
            value={data.target ?? ""}
            onChange={(event) => data.onPatch?.({ target: event.target.value })}
            aria-label="Action target"
            disabled={readOnly}
          >
            <option value="">Select hardware output</option>
            {(data.outputOptions ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          )}
          <label className="flow-node-field-label">Seconds</label>
          <input
            type="number"
            min={1}
            className="flow-node-input nodrag nopan"
            value={data.seconds ?? 8}
            onChange={(event) => data.onPatch?.({ seconds: Number(event.target.value) })}
            placeholder="seconds"
            aria-label="Action seconds"
            disabled={readOnly}
          />
          <label className="flow-node-field-label">Cooldown Min</label>
          <input
            type="number"
            min={1}
            className="flow-node-input nodrag nopan"
            value={data.cooldownMinutes ?? 60}
            onChange={(event) => data.onPatch?.({ cooldownMinutes: Number(event.target.value) })}
            placeholder="cooldown min"
            aria-label="Action cooldown"
            disabled={readOnly}
          />
          <label className="flow-node-field-label">Max Daily Sec</label>
          <input
            type="number"
            min={1}
            className="flow-node-input nodrag nopan"
            value={data.maxDailyRuntimeSeconds ?? 90}
            onChange={(event) => data.onPatch?.({ maxDailyRuntimeSeconds: Number(event.target.value) })}
            placeholder="max daily sec"
            aria-label="Action max daily runtime"
            disabled={readOnly}
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

const formatMeasurement = (value: number | undefined, unit = ""): string => {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return `${value}${unit}`;
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

  const browserOrigin = getBrowserOrigin();
  if (imageUrl.startsWith("/") && browserOrigin) {
    try {
      return new URL(imageUrl, browserOrigin).toString();
    } catch {
      return null;
    }
  }

  try {
    const resolutionBase = browserOrigin ? new URL(apiBase, browserOrigin).toString() : apiBase;
    return new URL(imageUrl, resolutionBase).toString();
  } catch {
    return null;
  }
};

export function App(): JSX.Element {
  const [authChecking, setAuthChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authPassphrase, setAuthPassphrase] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [currentPassphraseDraft, setCurrentPassphraseDraft] = useState("");
  const [newPassphraseDraft, setNewPassphraseDraft] = useState("");
  const [confirmPassphraseDraft, setConfirmPassphraseDraft] = useState("");
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);
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
  const [detectedChannels, setDetectedChannels] = useState<string[]>([]);
  const [channelProbeResult, setChannelProbeResult] = useState<ChannelProbeResult | null>(null);
  const [channelProbeLoading, setChannelProbeLoading] = useState(false);
  const [channelProbeError, setChannelProbeError] = useState<string | null>(null);
  const [deviceChannelAssignments, setDeviceChannelAssignments] = useState<DeviceChannelAssignmentDraft[]>([]);
  const [deviceEditorOpen, setDeviceEditorOpen] = useState(false);
  const [deviceEditorProfileId, setDeviceEditorProfileId] = useState<string | null>(null);
  const [deviceEditorSaving, setDeviceEditorSaving] = useState(false);
  const [connectionSectionOpen, setConnectionSectionOpen] = useState(true);
  const [assignmentSectionOpen, setAssignmentSectionOpen] = useState(true);
  const [connectionTest, setConnectionTest] = useState<ConnectionTestResult | null>(null);
  const [profileTestInFlightId, setProfileTestInFlightId] = useState<string | null>(null);
  const [profileConnectionTests, setProfileConnectionTests] = useState<Record<string, ConnectionTestResult>>({});
  const [hardwareDiscoveryLoading, setHardwareDiscoveryLoading] = useState(false);
  const [hardwareDiscoveryError, setHardwareDiscoveryError] = useState<string | null>(null);
  const [profileDeleteInFlightId, setProfileDeleteInFlightId] = useState<string | null>(null);
  const [deletingAllProfiles, setDeletingAllProfiles] = useState(false);
  const [lastTelemetryEventAt, setLastTelemetryEventAt] = useState<string | null>(null);
  const [lastEvaluationExecutions, setLastEvaluationExecutions] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId>("overview");
  const [graphHistory, setGraphHistory] = useState<PlantGraphPoint[]>([]);
  const [graphHistoryLoading, setGraphHistoryLoading] = useState(false);
  const [graphHistoryError, setGraphHistoryError] = useState<string | null>(null);
  const [graphRange, setGraphRange] = useState<GraphRange>("week");
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>("allPlantsSingleMetric");
  const [graphMetric, setGraphMetric] = useState<GraphMetric>("moisture");
  const [graphSelectedPlantId, setGraphSelectedPlantId] = useState<string>("");
  const [graphNowMs, setGraphNowMs] = useState<number>(() => Date.now());
  const [minuteWindowStartMs, setMinuteWindowStartMs] = useState<number>(() => {
    const now = Date.now();
    return Math.floor(now / 60_000) * 60_000;
  });
  const [mobileDeviceMode, setMobileDeviceMode] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [isPlantModalOpen, setIsPlantModalOpen] = useState(false);
  const [plantEditDraft, setPlantEditDraft] = useState<PlantEditDraft | null>(null);
  const [plantEditSaving, setPlantEditSaving] = useState(false);
  const [plantEditError, setPlantEditError] = useState<string | null>(null);
  const [profileValidation, setProfileValidation] = useState<Record<string, DeviceProfileValidationResult>>({});
  const [profileValidationInFlightId, setProfileValidationInFlightId] = useState<string | null>(null);
  const [profileValidationError, setProfileValidationError] = useState<string | null>(null);
  const [imageUploadInFlightId, setImageUploadInFlightId] = useState<string | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const anyModalOpen = securityModalOpen || isPlantModalOpen || plantEditDraft !== null;
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
  const [diagramPreviewIssues, setDiagramPreviewIssues] = useState<FlowValidationIssue[]>([]);
  const [flowLiveMode, setFlowLiveMode] = useState(false);
  const [diagramConnectionError, setDiagramConnectionError] = useState<string | null>(null);
  const [healthDetails, setHealthDetails] = useState<PlatformHealthDetails | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const diagramHydratedRef = useRef(false);
  const graphHistoryRequestSeqRef = useRef(0);

  const plantLookup = useMemo(
    () => new Map(plants.map((plant) => [plant.id, plant.nickname])),
    [plants],
  );
  const profileLookup = useMemo(
    () => new Map(deviceProfiles.map((profile) => [profile.id, profile])),
    [deviceProfiles],
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

  const diagramOutputOptions = useMemo(() => {
    return deviceProfiles.flatMap((profile) =>
      (profile.channelAssignments ?? [])
        .filter((assignment) => (assignment.ioType ?? "input") === "output")
        .map((assignment) => {
          const channel = assignment.channel.trim();
          const outputLabel =
            typeof assignment.outputLabel === "string" && assignment.outputLabel.trim().length > 0
              ? assignment.outputLabel.trim()
              : channel;

          return {
            value: `${profile.id}:${channel}`,
            label: `${profile.name} / ${outputLabel}`,
          };
        }),
    );
  }, [deviceProfiles]);

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
          readOnly: flowLiveMode,
          plantOptions: diagramPlantOptions,
          outputOptions: diagramOutputOptions,
          plantImageUrl: diagramPlantOptions.find((option) => option.id === node.data.plantId)?.imageUrl,
          onPatch: (partial: Partial<DiagramNodeData>) => updateDiagramNodeDataById(node.id, partial),
          onLabelChange: (label: string) => updateDiagramNodeDataById(node.id, { label }),
        },
      })),
    [diagramNodes, diagramPlantOptions, diagramOutputOptions, flowLiveMode, updateDiagramNodeDataById],
  );

  const diagramEdgesForCanvas = useMemo(
    () =>
      diagramEdges.map((edge) => ({
        ...edge,
        animated: flowLiveMode,
      })),
    [diagramEdges, flowLiveMode],
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

  const fetchGraphHistory = useCallback(async (): Promise<void> => {
    const requestSeq = ++graphHistoryRequestSeqRef.current;
    const requestStartedAt = Date.now();
    setGraphHistoryLoading(true);
    setGraphHistoryError(null);

    try {
      const params = new URLSearchParams({ range: graphHistoryFetchRangeByRange[graphRange] });
      const response = await fetch(`${apiBase}/telemetry/history?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Telemetry history request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as TelemetryPoint[];
      const next = (Array.isArray(payload) ? payload : [])
        .map((point) => {
          const plant = plants.find((entry) => entry.id === point.plantId);
          return {
            plantId: point.plantId,
            nickname: plant?.nickname ?? point.plantId,
            imageUrl: resolvePlantImageUrl(plant?.imageUrl ?? undefined) ?? undefined,
            capturedAt: point.capturedAt,
            ...(point.moisture !== undefined ? { moisture: point.moisture } : {}),
            ...(point.light !== undefined ? { light: point.light } : {}),
            ...(point.temperature !== undefined ? { temperature: point.temperature } : {}),
            ...(point.humidity !== undefined ? { humidity: point.humidity } : {}),
            ...(point.reservoirLevel !== undefined ? { reservoirLevel: point.reservoirLevel } : {}),
          } satisfies PlantGraphPoint;
        })
        .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

      if (requestSeq !== graphHistoryRequestSeqRef.current) {
        return;
      }

      setGraphHistory((prev) => {
        const recentLivePoints = prev.filter((point) => Date.parse(point.capturedAt) > requestStartedAt);
        const mergedByKey = new Map<string, PlantGraphPoint>();

        for (const point of [...next, ...recentLivePoints]) {
          mergedByKey.set(`${point.plantId}|${point.capturedAt}`, point);
        }

        const merged = Array.from(mergedByKey.values()).sort(
          (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt),
        );
        return merged.length > maxGraphHistoryPoints
          ? merged.slice(merged.length - maxGraphHistoryPoints)
          : merged;
      });
    } catch (error) {
      if (requestSeq !== graphHistoryRequestSeqRef.current) {
        return;
      }

      setGraphHistoryError(error instanceof Error ? error.message : "Unable to load graph telemetry history.");
      setGraphHistory([]);
    } finally {
      if (requestSeq === graphHistoryRequestSeqRef.current) {
        setGraphHistoryLoading(false);
      }
    }
  }, [graphRange, plants]);

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
      setFlowLiveMode(false);
      if (typeof payload.updatedAt === "string" && payload.updatedAt.length > 0) {
        setDiagramLastSavedAt(payload.updatedAt);
      }
    } catch (error) {
      setDiagramSyncError(error instanceof Error ? error.message : "Unable to load diagram from backend.");
      setDiagramNodes(defaultDiagramNodes);
      setDiagramEdges(defaultDiagramEdges);
      setFlowLiveMode(false);
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
    const checkSession = async (): Promise<void> => {
      setAuthChecking(true);
      setAuthError(null);
      try {
        const response = await fetch(`${apiBase}/auth/session`);
        if (!response.ok) {
          throw new Error(`Session check failed with status ${response.status}`);
        }

        const payload = (await response.json()) as SessionStatus;
        const nextAuthenticated = Boolean(payload.authenticated);
        setAuthenticated(nextAuthenticated);
        if (nextAuthenticated) {
          window.localStorage.setItem(authDeviceKey, "1");
        } else {
          const hadDeviceSession = window.localStorage.getItem(authDeviceKey) === "1";
          window.localStorage.removeItem(authDeviceKey);
          if (hadDeviceSession) {
            setAuthError("Session expired. Please sign in again.");
          }
        }
      } catch (error) {
        setAuthenticated(false);
        window.localStorage.removeItem(authDeviceKey);
        setAuthError(error instanceof Error ? error.message : "Unable to verify session.");
      } finally {
        setAuthChecking(false);
      }
    };

    void checkSession();
  }, []);

  useEffect(() => {
    const handleUnauthorized = (): void => {
      window.localStorage.removeItem(authDeviceKey);
      setAuthenticated(false);
      setLoading(false);
      setSecurityModalOpen(false);
      setAuthError("Session expired or invalid. Please sign in again.");
    };

    window.addEventListener(unauthorizedEvent, handleUnauthorized);
    return () => {
      window.removeEventListener(unauthorizedEvent, handleUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

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

      if (plantResponse.ok) {
        const payload = (await plantResponse.json()) as unknown;
        setPlants(Array.isArray(payload) ? (payload as PlantRecord[]) : []);
      } else {
        setPlants([]);
      }

      if (dailyResponse.ok) {
        setDecision((await dailyResponse.json()) as DailyDecision);
      }

      if (discoverResponse.ok) {
        const payload = (await discoverResponse.json()) as unknown;
        setDiscovery(Array.isArray(payload) ? (payload as DeviceDiscovery[]) : []);
      } else {
        setDiscovery([]);
      }

      if (profileResponse.ok) {
        const payload = (await profileResponse.json()) as unknown;
        setDeviceProfiles(Array.isArray(payload) ? (payload as DeviceProfile[]) : []);
      } else {
        setDeviceProfiles([]);
      }

      if (ruleResponse.ok) {
        const payload = (await ruleResponse.json()) as unknown;
        setRules(Array.isArray(payload) ? (payload as AutomationRule[]) : []);
      } else {
        setRules([]);
      }

      if (timelineResponse.ok) {
        const payload = (await timelineResponse.json()) as unknown;
        setTimeline(Array.isArray(payload) ? (payload as AutomationTimelineEvent[]) : []);
      } else {
        setTimeline([]);
      }

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
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    void fetchGraphHistory();
  }, [authenticated, fetchGraphHistory]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    if (anyModalOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }

    document.body.style.overflow = previousOverflow;
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [anyModalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const query = window.matchMedia("(max-width: 820px)");
    const ua = window.navigator.userAgent || "";
    const isMobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    const applyMode = (): void => {
      setMobileDeviceMode(isMobileUa || query.matches);
    };

    applyMode();
    query.addEventListener("change", applyMode);

    return () => {
      query.removeEventListener("change", applyMode);
    };
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    void loadDiagramSnapshotFromApi();
  }, [authenticated, setDiagramEdges, setDiagramNodes]);

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
    if (!authenticated) {
      return;
    }

    void fetchLatestTelemetrySnapshot();
  }, [authenticated]);

  const refreshTelemetryPanel = async (): Promise<void> => {
    await Promise.all([fetchLatestTelemetrySnapshot(snapshotPlantIdFilter), fetchTelemetryStats()]);
  };

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const socket = io({ path: "/ws/telemetry", withCredentials: true });
    socket.on("telemetry:update", (point: TelemetryView & { plantId: string }) => {
      setGraphNowMs((prev) => Math.max(prev, Date.now()));
      setTelemetry((prev) => ({
        ...prev,
        [point.plantId]: {
          ...(point.moisture !== undefined ? { moisture: point.moisture } : {}),
          ...(point.light !== undefined ? { light: point.light } : {}),
          ...(point.temperature !== undefined ? { temperature: point.temperature } : {}),
          ...(point.humidity !== undefined ? { humidity: point.humidity } : {}),
          ...(point.reservoirLevel !== undefined ? { reservoirLevel: point.reservoirLevel } : {}),
          capturedAt: point.capturedAt,
          ...(point.sourceProfileId ? { sourceProfileId: point.sourceProfileId } : {}),
          ...(point.sourceProfileName ? { sourceProfileName: point.sourceProfileName } : {}),
        },
      }));
      setLastTelemetryEventAt(point.capturedAt);
      const plant = plants.find((entry) => entry.id === point.plantId);
      setGraphHistory((prev) => {
        const nextPoint: PlantGraphPoint = {
          plantId: point.plantId,
          nickname: plant?.nickname ?? point.plantId,
          imageUrl: resolvePlantImageUrl(plant?.imageUrl ?? undefined) ?? undefined,
          capturedAt: point.capturedAt,
          ...(point.moisture !== undefined ? { moisture: point.moisture } : {}),
          ...(point.light !== undefined ? { light: point.light } : {}),
          ...(point.temperature !== undefined ? { temperature: point.temperature } : {}),
          ...(point.humidity !== undefined ? { humidity: point.humidity } : {}),
          ...(point.reservoirLevel !== undefined ? { reservoirLevel: point.reservoirLevel } : {}),
        };

        const mergedByKey = new Map<string, PlantGraphPoint>();
        for (const item of [...prev, nextPoint]) {
          mergedByKey.set(`${item.plantId}|${item.capturedAt}`, item);
        }

        const merged = Array.from(mergedByKey.values()).sort(
          (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt),
        );
        return merged.length > maxGraphHistoryPoints
          ? merged.slice(merged.length - maxGraphHistoryPoints)
          : merged;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [authenticated, plants]);

  useEffect(() => {
    if (activePanel !== "graphs") {
      return;
    }

    const timer = window.setInterval(() => {
      setGraphNowMs((prev) => Math.max(prev, Date.now()));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activePanel]);

  useEffect(() => {
    if (graphRange !== "minute") {
      return;
    }

    const nextMinuteStart = Math.floor(graphNowMs / 60_000) * 60_000;
    setMinuteWindowStartMs((prev) => (prev === nextMinuteStart ? prev : nextMinuteStart));
  }, [graphNowMs, graphRange]);

  const submitAuth = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);

    try {
      const response = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: authPassphrase }),
      });

      if (!response.ok) {
        throw new Error("Invalid passphrase");
      }

      setAuthenticated(true);
      window.localStorage.setItem(authDeviceKey, "1");
      setAuthPassphrase("");
    } catch (error) {
      setAuthenticated(false);
      window.localStorage.removeItem(authDeviceKey);
      setAuthError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const logout = async (): Promise<void> => {
    await fetch(`${apiBase}/auth/logout`, { method: "POST" });
    setAuthenticated(false);
    window.localStorage.removeItem(authDeviceKey);
    setLoading(false);
    setAuthPassphrase("");
    setSecurityModalOpen(false);
    setCurrentPassphraseDraft("");
    setNewPassphraseDraft("");
    setConfirmPassphraseDraft("");
    setSecurityError(null);
    setSecuritySuccess(null);
  };

  const submitPassphraseChange = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSecurityError(null);
    setSecuritySuccess(null);

    if (newPassphraseDraft.trim().length < 12) {
      setSecurityError("New passphrase must be at least 12 characters.");
      return;
    }

    if (newPassphraseDraft !== confirmPassphraseDraft) {
      setSecurityError("New passphrase and confirmation do not match.");
      return;
    }

    setSecuritySaving(true);
    try {
      const response = await fetch(`${apiBase}/auth/change-passphrase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassphrase: currentPassphraseDraft,
          newPassphrase: newPassphraseDraft,
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to change passphrase. Check your current passphrase.");
      }

      setCurrentPassphraseDraft("");
      setNewPassphraseDraft("");
      setConfirmPassphraseDraft("");
      setSecuritySuccess("Passphrase updated successfully.");
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : "Unable to change passphrase.");
    } finally {
      setSecuritySaving(false);
    }
  };

  const refreshPlantsAndDecision = async (): Promise<void> => {
    const [plantResponse, dailyResponse] = await Promise.all([
      fetch(`${apiBase}/plants`),
      fetch(`${apiBase}/dashboard/daily`),
    ]);

    setPlants((await plantResponse.json()) as PlantRecord[]);
    setDecision((await dailyResponse.json()) as DailyDecision);
  };

  const refreshDeviceProfiles = async (): Promise<void> => {
    const profileResponse = await fetch(`${apiBase}/devices/profiles`);
    setDeviceProfiles((await profileResponse.json()) as DeviceProfile[]);
  };

  const refreshHardwareDiscovery = async (): Promise<void> => {
    setHardwareDiscoveryLoading(true);
    setHardwareDiscoveryError(null);

    try {
      const response = await fetch(`${apiBase}/devices/discover`);
      if (!response.ok) {
        throw new Error(`Discovery failed with status ${response.status}`);
      }

      const payload = (await response.json()) as DeviceDiscovery[];
      setDiscovery(payload);

      const options = payload.find((entry) => entry.connectionType === deviceType)?.options ?? [];
      const firstDiscoveredTarget = options[0];
      if (firstDiscoveredTarget && !options.includes(deviceTarget)) {
        setDeviceTarget(firstDiscoveredTarget);
      }
    } catch (error) {
      setHardwareDiscoveryError(error instanceof Error ? error.message : "Unable to refresh discovery.");
    } finally {
      setHardwareDiscoveryLoading(false);
    }
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

  const refreshRules = async (): Promise<void> => {
    const response = await fetch(`${apiBase}/automation/rules`);
    setRules((await response.json()) as AutomationRule[]);
  };

  const evaluateAutomation = async (): Promise<void> => {
    const response = await fetch(`${apiBase}/automation/evaluate`, { method: "POST" });
    const payload = (await response.json()) as { executed: number };
    setLastEvaluationExecutions(payload.executed);
    await Promise.all([fetchRuntimeStatus(), fetchRuntimeHistory(), refreshPlantsAndDecision()]);
  };

  const saveDeviceProfile = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const channelAssignments = toChannelAssignmentsPayload(deviceChannelAssignments);
    const payload = {
      name: deviceName,
      connectionType: deviceType,
      transportTarget: deviceTarget,
      channelAssignments,
      ...(deviceEditorProfileId ? {} : { isLive: false }),
    };

    setDeviceEditorSaving(true);
    try {
      const response = await fetch(
        deviceEditorProfileId
          ? `${apiBase}/devices/profiles/${deviceEditorProfileId}`
          : `${apiBase}/devices/profiles`,
        {
          method: deviceEditorProfileId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(`Device save failed with status ${response.status}`);
      }

      await refreshDeviceProfiles();
      setDeviceEditorOpen(false);
      setDeviceEditorProfileId(null);
      setConnectionTest(null);
      setChannelProbeResult(null);
      setDetectedChannels([]);
    } catch (error) {
      setProfileValidationError(error instanceof Error ? error.message : "Unable to save device profile.");
    } finally {
      setDeviceEditorSaving(false);
    }
  };

  const openCreateDeviceEditor = (): void => {
    setDeviceEditorProfileId(null);
    setDeviceEditorOpen(true);
    setDeviceName("Living Room Kit");
    setDeviceType("serial");
    setDeviceTarget("COM3");
    setDeviceChannelAssignments([]);
    setChannelProbeResult(null);
    setDetectedChannels([]);
    setConnectionTest(null);
    setConnectionSectionOpen(true);
    setAssignmentSectionOpen(true);
  };

  const probeDeviceChannels = async (): Promise<void> => {
    setChannelProbeLoading(true);
    setChannelProbeError(null);
    setChannelProbeResult(null);
    let shouldResumeLive = false;

    try {
      if (editorProfile?.isLive) {
        if (deviceEditorProfileId) {
          const liveChannelResponse = await fetch(`${apiBase}/devices/profiles/${deviceEditorProfileId}/live-channels`);
          if (liveChannelResponse.ok) {
            const livePayload = (await liveChannelResponse.json()) as ChannelProbeResult;
            const liveChannels = Array.isArray(livePayload.channels)
              ? Array.from(new Set(livePayload.channels.map((channel) => channel.trim()).filter((channel) => channel.length > 0)))
              : [];

            if (livePayload.ok && liveChannels.length > 0) {
              setDetectedChannels(liveChannels);
              setChannelProbeResult({
                ...livePayload,
                channels: liveChannels,
              });

              setDeviceChannelAssignments((prev) => {
                const next = [...prev];
                liveChannels.forEach((channel) => {
                  if (!next.some((entry) => entry.channel === channel)) {
                    next.push(createAssignmentDraft(channel, true));
                  }
                });
                return next.filter((entry) => entry.ioType === "output" || liveChannels.includes(entry.channel));
              });
              return;
            }
          }
        }

        if (deviceEditorProfileId) {
          const pauseResponse = await fetch(`${apiBase}/devices/profiles/${deviceEditorProfileId}/live`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isLive: false }),
          });

          if (!pauseResponse.ok) {
            throw new Error(`Unable to pause live mode for probing (status ${pauseResponse.status}).`);
          }

          shouldResumeLive = true;
        }
      }

      const response = await fetch(
        `${apiBase}/devices/probe-channels?connectionType=${deviceType}&target=${encodeURIComponent(deviceTarget)}`,
      );

      if (!response.ok) {
        throw new Error(`Channel probe failed with status ${response.status}`);
      }

      const payload = (await response.json()) as ChannelProbeResult;
      setChannelProbeResult(payload);
      const channels = Array.isArray(payload.channels) ? payload.channels : [];
      setDetectedChannels(channels);

      setDeviceChannelAssignments((prev) => {
        const next = [...prev];
        channels.forEach((channel) => {
          if (!next.some((entry) => entry.channel === channel)) {
            next.push(createAssignmentDraft(channel, true));
          }
        });
        return next.filter((entry) => entry.ioType === "output" || channels.includes(entry.channel));
      });
    } catch (error) {
      setChannelProbeError(error instanceof Error ? error.message : "Unable to probe channels.");
    } finally {
      if (shouldResumeLive && deviceEditorProfileId) {
        try {
          const resumeResponse = await fetch(`${apiBase}/devices/profiles/${deviceEditorProfileId}/live`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isLive: true }),
          });

          if (!resumeResponse.ok) {
            setChannelProbeError((prev) =>
              prev
                ? `${prev} Also failed to resume live mode (status ${resumeResponse.status}).`
                : `Probe completed, but failed to resume live mode (status ${resumeResponse.status}).`,
            );
          }
        } catch {
          setChannelProbeError((prev) =>
            prev
              ? `${prev} Also failed to resume live mode.`
              : "Probe completed, but failed to resume live mode.",
          );
        }

        await refreshDeviceProfiles();
      }

      setChannelProbeLoading(false);
    }
  };

  const openEditDeviceEditor = (profile: DeviceProfile): void => {
    setDeviceEditorProfileId(profile.id);
    setDeviceEditorOpen(true);
    setDeviceName(profile.name);
    setDeviceType(profile.connectionType);
    setDeviceTarget(profile.transportTarget);
    setDeviceChannelAssignments((profile.channelAssignments ?? []).map((assignment) => toAssignmentDraft(assignment)));
    setDetectedChannels(
      Array.from(new Set((profile.channelAssignments ?? []).map((assignment) => assignment.channel))),
    );
    setChannelProbeResult(null);
    setConnectionTest(null);
    setConnectionSectionOpen(true);
    setAssignmentSectionOpen(true);
  };

  const testDeviceConnection = async (): Promise<void> => {
    if (editorProfile?.isLive) {
      setConnectionTest({
        ok: true,
        latencyMs: 0,
        message: "Live mode is currently running for this profile. Connection is healthy.",
      });
      return;
    }

    const response = await fetch(
      `${apiBase}/devices/test?connectionType=${deviceType}&target=${encodeURIComponent(deviceTarget)}`,
    );
    setConnectionTest((await response.json()) as ConnectionTestResult);
  };

  const testSavedProfileConnection = async (profile: DeviceProfile): Promise<void> => {
    setProfileTestInFlightId(profile.id);
    try {
      const response = await fetch(
        `${apiBase}/devices/test?connectionType=${profile.connectionType}&target=${encodeURIComponent(profile.transportTarget)}`,
      );
      const result = (await response.json()) as ConnectionTestResult;
      setProfileConnectionTests((prev) => ({
        ...prev,
        [profile.id]: result,
      }));
    } finally {
      setProfileTestInFlightId(null);
    }
  };

  const deleteProfile = async (id: string): Promise<void> => {
    setProfileDeleteInFlightId(id);
    try {
      await fetch(`${apiBase}/devices/profiles/${id}`, { method: "DELETE" });
      setProfileValidation((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setProfileConnectionTests((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await refreshDeviceProfiles();
    } finally {
      setProfileDeleteInFlightId(null);
    }
  };

  const clearAllProfiles = async (): Promise<void> => {
    const hasProfiles = deviceProfiles.length > 0;
    if (!hasProfiles) {
      return;
    }

    const confirmed = window.confirm(
      `Delete all ${deviceProfiles.length} hardware profile(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletingAllProfiles(true);
    try {
      await fetch(`${apiBase}/devices/profiles`, { method: "DELETE" });
      setProfileValidation({});
      setProfileConnectionTests({});
      await refreshDeviceProfiles();
    } finally {
      setDeletingAllProfiles(false);
    }
  };

  const validateProfile = async (id: string): Promise<DeviceProfileValidationResult | null> => {
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
      return payload;
    } catch (error) {
      setProfileValidationError(error instanceof Error ? error.message : "Unable to validate profile.");
      return null;
    } finally {
      setProfileValidationInFlightId(null);
    }
  };

  const toggleLiveMode = async (id: string, isLive: boolean): Promise<void> => {
    if (isLive && !profileValidation[id]) {
      const validation = await validateProfile(id);
      if (!validation || !validation.ok) {
        setProfileValidationError("Cannot enable live mode until validation passes.");
        return;
      }
    }

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

    await refreshDeviceProfiles();
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

  const jumpToPanel = (panel: Exclude<PanelId, "overview">): void => {
    setActivePanel(panel);
    setQuickActionsOpen(false);
  };

  const showMobileTabbar = mobileDeviceMode;
  const showOverviewPrelude = activePanel === "overview";

  const onDiagramConnect = useCallback(
    (connection: Connection) => {
      if (flowLiveMode) {
        setDiagramConnectionError("Flow is live and locked. Unlock to edit connections.");
        return;
      }

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
    [diagramEdges, diagramNodes, flowLiveMode, setDiagramEdges],
  );

  const addDiagramNode = (): void => {
    if (flowLiveMode) {
      return;
    }

    const id = `node-${Date.now()}`;
    const defaultsByKind: Record<DiagramNodeKind, DiagramNodeData> = {
      trigger: { label: "Plant Trigger", kind: "trigger", plantId: "", metric: "moisture", operator: "<", value: 35 },
      condition: { label: "Condition", kind: "condition", plantId: "", metric: "moisture", operator: "<", value: 35 },
      action: {
        label: "Action",
        kind: "action",
        actionType: "deviceOutput",
        target: "",
        status: "watch",
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
    if (flowLiveMode) {
      return;
    }

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
      setFlowLiveMode(true);
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

  const removeSelectedDiagramNode = (): void => {
    if (flowLiveMode) {
      return;
    }

    if (!selectedDiagramNodeId) {
      return;
    }

    setDiagramNodes((prev: Node<DiagramNodeData>[]) => prev.filter((node: Node<DiagramNodeData>) => node.id !== selectedDiagramNodeId));
    setDiagramEdges((prev: Edge[]) => prev.filter((edge: Edge) => edge.source !== selectedDiagramNodeId && edge.target !== selectedDiagramNodeId));
    setSelectedDiagramNodeId(null);
  };

  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;
  const liveProfileCount = deviceProfiles.filter((profile) => profile.isLive).length;
  const selectedDiscoveryOptions =
    discovery.find((entry) => entry.connectionType === deviceType)?.options ?? [];
  const conflictingTargets = useMemo(() => {
    const activeEditorId = deviceEditorProfileId;
    return new Set(
      deviceProfiles
        .filter(
          (profile) =>
            profile.connectionType === deviceType &&
            profile.id !== activeEditorId &&
            profile.transportTarget.trim().length > 0,
        )
        .map((profile) => profile.transportTarget.trim().toLowerCase()),
    );
  }, [deviceEditorProfileId, deviceProfiles, deviceType]);
  const hasTargetConflict = conflictingTargets.has(deviceTarget.trim().toLowerCase());
  const liveTelemetryRows = useMemo(() => {
    return Object.entries(telemetry)
      .map(([plantId, point]) => ({
        plantId,
        plantName: plantLookup.get(plantId) ?? "Unmapped Plant",
        point,
        sourceProfile: point.sourceProfileId ? profileLookup.get(point.sourceProfileId) : undefined,
      }))
      .sort((a, b) => Date.parse(b.point.capturedAt) - Date.parse(a.point.capturedAt));
  }, [plantLookup, profileLookup, telemetry]);
  const isTelemetryStreamActive =
    lastTelemetryEventAt !== null && Date.now() - Date.parse(lastTelemetryEventAt) < 20_000;
  const graphPlantOptions = useMemo(
    () =>
      plants.map((plant) => ({
        id: plant.id,
        nickname: plant.nickname,
      })),
    [plants],
  );

  const graphChartData = useMemo(() => {
    const bucketByTimestamp = new Map<string, GraphChartRow>();

    for (const point of graphHistory) {
      const timestampKey = new Date(point.capturedAt).toISOString();
      const ts = Date.parse(point.capturedAt);
      if (!Number.isFinite(ts)) {
        continue;
      }
      const existing =
        bucketByTimestamp.get(timestampKey) ??
        {
          timestamp: point.capturedAt,
          ts,
        };

      if (graphViewMode === "allPlantsSingleMetric") {
        const value = point[graphMetric];
        if (value !== undefined && !Number.isNaN(value)) {
          existing[point.plantId] = value;
        }
      } else if (graphSelectedPlantId.length > 0 && point.plantId === graphSelectedPlantId) {
        graphMetricOptions.forEach((metricOption) => {
          const value = point[metricOption.value];
          if (value !== undefined && !Number.isNaN(value)) {
            existing[metricOption.value] = value;
          }
        });
      }

      bucketByTimestamp.set(timestampKey, existing);
    }

    return Array.from(bucketByTimestamp.values())
      .sort((a, b) => Number(a.ts) - Number(b.ts));
  }, [graphHistory, graphMetric, graphSelectedPlantId, graphViewMode]);

  const graphRangeDomain = useMemo(() => {
    const now = new Date(graphNowMs);
    const end = graphNowMs + graphDomainFutureToleranceMs;
    const start =
      graphRange === "minute" ? minuteWindowStartMs : getRangeStartTimestamp(graphRange, now);
    return [start, end] as const;
  }, [graphNowMs, graphRange, minuteWindowStartMs]);

  const graphChartDataInRange = useMemo(
    () =>
      graphChartData.filter(
        (entry) => Number(entry.ts) >= graphRangeDomain[0] && Number(entry.ts) <= graphRangeDomain[1],
      ),
    [graphChartData, graphRangeDomain],
  );

  const graphChartDataSmoothed = useMemo(() => {
    if (graphChartDataInRange.length === 0) {
      return [] as GraphChartRow[];
    }

    const bucketMs = graphSmoothingBucketMsByRange[graphRange];
    const buckets = new Map<
      number,
      {
        sums: Record<string, number>;
        counts: Record<string, number>;
      }
    >();

    for (const entry of graphChartDataInRange) {
      const ts = Number(entry.ts);
      if (!Number.isFinite(ts)) {
        continue;
      }

      const bucketTs = Math.floor(ts / bucketMs) * bucketMs;
      const current = buckets.get(bucketTs) ?? { sums: {}, counts: {} };

      Object.entries(entry).forEach(([key, value]) => {
        if (key === "timestamp" || key === "ts") {
          return;
        }

        if (typeof value !== "number" || Number.isNaN(value)) {
          return;
        }

        current.sums[key] = (current.sums[key] ?? 0) + value;
        current.counts[key] = (current.counts[key] ?? 0) + 1;
      });

      buckets.set(bucketTs, current);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucketTs, aggregate]) => {
        const row: GraphChartRow = {
          timestamp: new Date(bucketTs).toISOString(),
          ts: bucketTs,
        };

        Object.keys(aggregate.sums).forEach((key) => {
          const count = aggregate.counts[key] ?? 0;
          const sum = aggregate.sums[key];
          if (count <= 0) {
            return;
          }

          if (sum === undefined) {
            return;
          }

          row[key] = Math.round((sum / count) * 100) / 100;
        });

        return row;
      });
  }, [graphChartDataInRange, graphRange]);

  const graphLineDefinitions = useMemo(() => {
    if (graphViewMode === "allPlantsSingleMetric") {
      const allPlantIds = Array.from(new Set(graphHistory.map((point) => point.plantId)));
      return allPlantIds.map((plantId, index) => ({
        key: plantId,
        label: plantLookup.get(plantId) ?? plantId,
        color: graphLinePalette[index % graphLinePalette.length] ?? "#58b2f4",
      }));
    }

    return graphMetricOptions.map((metricOption, index) => ({
      key: metricOption.value,
      label: metricOption.label,
      color: graphLinePalette[index % graphLinePalette.length] ?? "#58b2f4",
    }));
  }, [graphHistory, graphViewMode, plantLookup]);
  const editorProfile = useMemo(
    () => deviceProfiles.find((profile) => profile.id === deviceEditorProfileId) ?? null,
    [deviceEditorProfileId, deviceProfiles],
  );

  const changeDeviceType = (nextType: DeviceProfile["connectionType"]): void => {
    setDeviceType(nextType);
    setConnectionTest(null);
    setDetectedChannels([]);
    setChannelProbeResult(null);
    setChannelProbeError(null);
    setDeviceChannelAssignments([]);
    setConnectionTest(null);

    const detectedTargets = discovery.find((entry) => entry.connectionType === nextType)?.options ?? [];
    setDeviceTarget(detectedTargets[0] ?? defaultTargetByConnectionType[nextType]);
  };

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

  useEffect(() => {
    if (graphSelectedPlantId.length > 0) {
      return;
    }

    if (graphPlantOptions.length === 0) {
      return;
    }

    setGraphSelectedPlantId(graphPlantOptions[0]?.id ?? "");
  }, [graphPlantOptions, graphSelectedPlantId]);

  if (authChecking) {
    return (
      <main className="app-shell dashboard-shell">
        <section className="panel" style={{ maxWidth: "480px", margin: "3rem auto" }}>
          <h2>Checking session...</h2>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="app-shell dashboard-shell">
        <section className="panel" style={{ maxWidth: "480px", margin: "3rem auto" }}>
          <h2>Sign In</h2>
          <p className="muted">Enter your passphrase to unlock the control center.</p>
          {authError ? <p className="muted">Auth error: {authError}</p> : null}
          <form className="plant-form" onSubmit={(event) => void submitAuth(event)}>
            <input
              type="password"
              value={authPassphrase}
              onChange={(event) => setAuthPassphrase(event.target.value)}
              placeholder="Passphrase"
              autoComplete="current-password"
              required
            />
            <button type="submit" disabled={authSubmitting}>
              {authSubmitting ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app-shell dashboard-shell ${mobileDeviceMode ? "mobile-device-layout" : ""} ${activePanel === "flows" ? "flows-focus" : ""}`}
    >
      <header className="app-header panel">
        <div>
          <p className="eyebrow">Control Center</p>
          <h1>Vibe Plant Platform</h1>
          <p className="muted">Daily care, telemetry, hardware, and automation in one dashboard.</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setSecurityModalOpen(true);
              setSecurityError(null);
              setSecuritySuccess(null);
            }}
          >
            Security
          </button>
          <button type="button" className="ghost-button" onClick={() => void logout()}>
            Sign Out
          </button>
          <button type="button" className="ghost-button" onClick={() => setIsPlantModalOpen(true)}>
            Add Plant
          </button>
          <button type="button" className="accent-button" onClick={() => setActivePanel("flows")}>
            Open Flows
          </button>
        </div>
      </header>

      {showOverviewPrelude ? <section className="summary-row">
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
          <p>Applied Flow Rules</p>
          <strong>{enabledRuleCount}</strong>
        </article>
      </section> : null}

      {showOverviewPrelude ? <section className="panel hero-plants-panel" aria-label="Featured plants">
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
            const latestTelemetry = telemetry[plant.id];

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
                  <p className="muted">Plant status: {plant.healthState}</p>
                  <p className="muted">
                    {plant.species} in {plant.zone}
                  </p>
                  <p className="muted">
                    {latestTelemetry
                      ? `Moisture ${formatMeasurement(latestTelemetry.moisture, "%")} | Light ${formatMeasurement(latestTelemetry.light)} | Temp ${formatMeasurement(latestTelemetry.temperature)}`
                      : "No telemetry yet"}
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
      </section> : null}

      {showOverviewPrelude ? <section className="panel quick-actions-panel">
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
            <button type="button" className="ghost-button" onClick={() => jumpToPanel("logs")}>
              Jump to Logs
            </button>
            <button type="button" className="ghost-button" onClick={() => jumpToPanel("flows")}>
              Jump to Flows
            </button>
          </div>
        </div>
      </section> : null}

      {showOverviewPrelude ? <section className="panel automation-spotlight">
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
      </section> : null}

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
          aria-selected={activePanel === "graphs"}
          className={`tab-chip ${activePanel === "graphs" ? "active" : ""}`}
          onClick={() => {
            setActivePanel("graphs");
            void fetchGraphHistory();
          }}
        >
          Graphs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === "logs"}
          className={`tab-chip ${activePanel === "logs" ? "active" : ""}`}
          onClick={() => setActivePanel("logs")}
        >
          Logs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activePanel === "flows"}
          className={`tab-chip ${activePanel === "flows" ? "active" : ""}`}
          onClick={() => setActivePanel("flows")}
        >
          Flows
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
                    Moisture {point.moisture}% | Light {point.light} lx | Temp {point.temperature} |{" "}
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
                          Latest telemetry: Moisture {formatMeasurement(latestTelemetry.moisture, "%")} | Light{" "}
                          {formatMeasurement(latestTelemetry.light)} | Temp {formatMeasurement(latestTelemetry.temperature)}
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

      {activePanel === "flows" ? (
        <section className={`panel diagram-panel ${flowLiveMode ? "flow-live" : ""}`}>
          <div className="panel-header">
            <h2>Automation Flows</h2>
          </div>
          <p className="muted">Build trigger to condition to action flows. Apply starts live mode and locks editing until unlocked.</p>
          <p className="muted">
            {diagramSaving ? "Saving diagram..." : "Diagram sync idle."}
            {diagramLastSavedAt ? ` Last saved ${new Date(diagramLastSavedAt).toLocaleString()}.` : ""}
            {diagramSyncError ? ` Sync error: ${diagramSyncError}` : ""}
          </p>
          {flowLiveMode ? <p className="muted">Flow is live. Editing is locked while live mode is active.</p> : null}
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
              <button
                type="button"
                className="icon-button"
                title="Toggle edit lock"
                onClick={() => setFlowLiveMode((prev) => !prev)}
              >
                {flowLiveMode ? "🔒" : "🔓"}
              </button>
              <select
                value={diagramNodeKindDraft}
                onChange={(event) => setDiagramNodeKindDraft(event.target.value as DiagramNodeKind)}
                aria-label="New node type"
                disabled={flowLiveMode}
              >
                <option value="trigger">Trigger</option>
                <option value="condition">Condition</option>
                <option value="action">Action</option>
              </select>
              <button type="button" className="icon-button" title="Add node" onClick={addDiagramNode} disabled={flowLiveMode}>
                +
              </button>
              <button type="button" className="icon-button" title="Starter flow" onClick={insertStarterAutomationFlow} disabled={flowLiveMode}>
                ⚡
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
                disabled={!selectedDiagramNodeId || flowLiveMode}
              >
                ⌫
              </button>
            </div>
            {diagramReady ? (
              <ReactFlow
                nodes={diagramNodesForCanvas}
                edges={diagramEdgesForCanvas}
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
                onNodesChange={flowLiveMode ? () => undefined : onDiagramNodesChange}
                onEdgesChange={flowLiveMode ? () => undefined : onDiagramEdgesChange}
                onConnect={onDiagramConnect}
                onNodeClick={(_event: unknown, node: Node<DiagramNodeData>) => {
                  setSelectedDiagramNodeId(node.id);
                }}
                onPaneClick={() => {
                  setSelectedDiagramNodeId(null);
                }}
                nodesDraggable={!flowLiveMode}
                nodesConnectable={!flowLiveMode}
                elementsSelectable={!flowLiveMode}
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
        <section className="split devices-layout">
          <section className="panel">
            <div className="panel-header">
              <h2>Hardware Setup</h2>
              <div className="panel-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => void refreshHardwareDiscovery()}
                  disabled={hardwareDiscoveryLoading}
                >
                  {hardwareDiscoveryLoading ? "Refreshing..." : "Refresh Discovery"}
                </button>
              </div>
            </div>
            <p className="muted">
              Create real hardware profiles, validate connectivity, and monitor live telemetry updates in one place.
            </p>
            {hardwareDiscoveryError ? <p className="muted">Discovery error: {hardwareDiscoveryError}</p> : null}

            <div className="hardware-status-grid">
              <article>
                <h3>Saved Profiles</h3>
                <p>{deviceProfiles.length}</p>
              </article>
              <article>
                <h3>Live Profiles</h3>
                <p>{liveProfileCount}</p>
              </article>
              <article>
                <h3>Detected Targets</h3>
                <p>{discovery.reduce((total, entry) => total + entry.options.length, 0)}</p>
              </article>
              <article>
                <h3>Telemetry Stream</h3>
                <p>{isTelemetryStreamActive ? "active" : "waiting"}</p>
              </article>
            </div>

            <div className="panel-actions">
              {!deviceEditorOpen ? (
                <button type="button" className="accent-button" onClick={openCreateDeviceEditor}>
                  Create New Profile
                </button>
              ) : (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setDeviceEditorOpen(false);
                    setDeviceEditorProfileId(null);
                    setConnectionTest(null);
                  }}
                >
                  Close Editor
                </button>
              )}
            </div>

            {deviceEditorOpen ? (
              <>
              <form className="hardware-setup-form" onSubmit={(event) => void saveDeviceProfile(event)}>
                <div className="hardware-form-section">
                  <button
                    type="button"
                    className="hardware-section-toggle"
                    onClick={() => setConnectionSectionOpen((prev) => !prev)}
                    aria-expanded={connectionSectionOpen}
                  >
                    <h3>Connection</h3>
                    <span>{connectionSectionOpen ? "Hide" : "Show"}</span>
                  </button>
                  {connectionSectionOpen ? (
                  <div className="hardware-form-grid">
                    <div className="hardware-field">
                      <label htmlFor="device-name-input">Profile Name</label>
                      <input
                        id="device-name-input"
                        value={deviceName}
                        onChange={(event) => setDeviceName(event.target.value)}
                        aria-label="Device name"
                      />
                      <small className="field-hint">Shown in saved profiles for quick identification.</small>
                    </div>

                    <div className="hardware-field">
                      <label htmlFor="device-connection-type-select">Connection Type</label>
                      <select
                        id="device-connection-type-select"
                        value={deviceType}
                        onChange={(event) => changeDeviceType(event.target.value as DeviceProfile["connectionType"])}
                        aria-label="Device connection type"
                      >
                        <option value="serial">Serial (COM)</option>
                        <option value="network">Network (IP:Port)</option>
                        <option value="bluetooth">Bluetooth</option>
                      </select>
                      <small className="field-hint">Select the transport used by your hardware bridge.</small>
                    </div>

                    <div className="hardware-field hardware-field-wide">
                      <label htmlFor="device-target-input">Connection Target</label>
                      <input
                        id="device-target-input"
                        value={deviceTarget}
                        onChange={(event) => setDeviceTarget(event.target.value)}
                        aria-label="Device target"
                        placeholder={defaultTargetByConnectionType[deviceType]}
                        list="device-target-options"
                      />
                      <datalist id="device-target-options">
                        {selectedDiscoveryOptions.map((option) => (
                          <option key={`${deviceType}-${option}`} value={option} />
                        ))}
                      </datalist>
                      <small className="field-hint">
                        {connectionTargetHint[deviceType]} {selectedDiscoveryOptions.length > 0 ? "Suggestions available from discovery." : "Run discovery and use one of the detected targets below."}
                      </small>
                      {selectedDiscoveryOptions.length > 0 ? (
                        <div className="target-option-chips" role="group" aria-label="Detected hardware targets">
                          {selectedDiscoveryOptions.map((option) => (
                            <button
                              key={`target-chip-${deviceType}-${option}`}
                              type="button"
                              className={`target-chip ${option === deviceTarget ? "active" : ""} ${conflictingTargets.has(option.trim().toLowerCase()) ? "conflict" : ""}`}
                              onClick={() => {
                                if (conflictingTargets.has(option.trim().toLowerCase())) {
                                  return;
                                }
                                setDeviceTarget(option);
                              }}
                              disabled={conflictingTargets.has(option.trim().toLowerCase())}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {hasTargetConflict ? (
                        <small className="connection-test-result failed">
                          Target conflict: another profile already uses this target.
                        </small>
                      ) : null}
                    </div>
                  </div>
                  ) : null}
                </div>

                <div className="hardware-form-section">
                  <button
                    type="button"
                    className="hardware-section-toggle"
                    onClick={() => setAssignmentSectionOpen((prev) => !prev)}
                    aria-expanded={assignmentSectionOpen}
                  >
                    <h3>Probe and Assign Channels</h3>
                    <span>{assignmentSectionOpen ? "Hide" : "Show"}</span>
                  </button>
                  {assignmentSectionOpen ? (
                    <>
                      <div className="panel-header">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void probeDeviceChannels()}
                          disabled={channelProbeLoading}
                        >
                          {channelProbeLoading ? "Probing..." : "Probe Channels"}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            setDeviceChannelAssignments((prev) => {
                              const channel = nextManualOutputChannel(prev);
                              return [
                                ...prev,
                                {
                                  ...createAssignmentDraft(channel, false),
                                  ioType: "output",
                                  outputLabel: channel,
                                },
                              ];
                            })
                          }
                        >
                          Add Output Channel
                        </button>
                      </div>
                      <p className="muted">
                        Connect first, probe live payload channels, then assign each channel to a plant and measurement.
                      </p>
                      {channelProbeError ? <p className="muted">Probe error: {channelProbeError}</p> : null}
                      {channelProbeResult ? (
                        <p className="muted">
                          {channelProbeResult.ok ? "Probe succeeded" : "Probe returned no channels"}: {channelProbeResult.message}
                        </p>
                      ) : null}
                      <p className="muted">Detected channels: {detectedChannels.length}</p>

                      {deviceChannelAssignments.length === 0 ? (
                        <p className="muted">No channels detected yet. Click Probe Channels to load assignments.</p>
                      ) : (
                        <div className="hardware-channel-assignment-list">
                          {deviceChannelAssignments.map((assignment, index) => (
                            <div className="hardware-form-grid channel-assignment-card" key={`assignment-${assignment.channel}-${index}`}>
                          <div className="hardware-field">
                            <label>Channel</label>
                            <input
                              value={assignment.channel}
                              readOnly={assignment.discovered}
                              onChange={(event) =>
                                setDeviceChannelAssignments((prev) =>
                                  prev.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? {
                                          ...entry,
                                          channel: event.target.value,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="hardware-field">
                            <label>Plant</label>
                            <select
                              value={assignment.plantId}
                              disabled={assignment.ioType === "output"}
                              onChange={(event) =>
                                setDeviceChannelAssignments((prev) =>
                                  prev.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? {
                                          ...entry,
                                          plantId: event.target.value,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              <option value="">Select plant</option>
                              {plants.map((plant) => (
                                <option key={`assignment-plant-${plant.id}`} value={plant.id}>
                                  {plant.nickname} ({plant.zone})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="hardware-field">
                            <label>Measurement Type</label>
                            <select
                              value={assignment.measurementType}
                              disabled={assignment.ioType === "output"}
                              onChange={(event) =>
                                setDeviceChannelAssignments((prev) =>
                                  prev.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? {
                                          ...entry,
                                          measurementType: event.target.value as DeviceMeasurementType,
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              {measurementTypeOptions.map((option) => (
                                <option key={`assignment-type-${assignment.channel}-${option}`} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="hardware-field">
                            <label>I/O Mode</label>
                            <select
                              value={assignment.ioType}
                              onChange={(event) =>
                                setDeviceChannelAssignments((prev) =>
                                  prev.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? {
                                          ...entry,
                                          ioType: event.target.value as DeviceAssignmentIoType,
                                          ...(event.target.value === "output"
                                            ? { plantId: "" }
                                            : { outputLabel: entry.outputLabel || entry.channel }),
                                        }
                                      : entry,
                                  ),
                                )
                              }
                            >
                              <option value="input">Input (telemetry)</option>
                              <option value="output">Output (action target)</option>
                            </select>
                          </div>

                          {!assignment.discovered ? (
                            <div className="hardware-field">
                              <label>&nbsp;</label>
                              <button
                                type="button"
                                className="ghost-button"
                                onClick={() =>
                                  setDeviceChannelAssignments((prev) => prev.filter((_, entryIndex) => entryIndex !== index))
                                }
                              >
                                Remove
                              </button>
                            </div>
                          ) : null}

                          {assignment.ioType === "output" ? (
                            <div className="hardware-field">
                              <label>Output Label</label>
                              <input
                                value={assignment.outputLabel}
                                placeholder="Irrigation Valve"
                                onChange={(event) =>
                                  setDeviceChannelAssignments((prev) =>
                                    prev.map((entry, entryIndex) =>
                                      entryIndex === index
                                        ? {
                                            ...entry,
                                            outputLabel: event.target.value,
                                          }
                                        : entry,
                                    ),
                                  )
                                }
                              />
                              <small className="field-hint">
                                This output will appear in flow action target options.
                              </small>
                            </div>
                          ) : assignment.measurementType === "moisture" ? (
                            <>
                              <div className="hardware-field">
                                <label>Input Min</label>
                                <input
                                  value={assignment.inputMin}
                                  placeholder="300"
                                  onChange={(event) =>
                                    setDeviceChannelAssignments((prev) =>
                                      prev.map((entry, entryIndex) =>
                                        entryIndex === index
                                          ? {
                                              ...entry,
                                              inputMin: event.target.value,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                />
                              </div>
                              <div className="hardware-field">
                                <label>Input Max</label>
                                <input
                                  value={assignment.inputMax}
                                  placeholder="900"
                                  onChange={(event) =>
                                    setDeviceChannelAssignments((prev) =>
                                      prev.map((entry, entryIndex) =>
                                        entryIndex === index
                                          ? {
                                              ...entry,
                                              inputMax: event.target.value,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                />
                                <small className="field-hint">
                                  Values map to 0-100 using (max - raw) / (max - min).
                                </small>
                              </div>
                            </>
                          ) : assignment.measurementType === "temperature" ? (
                            <>
                              <div className="hardware-field">
                                <label>Input Unit</label>
                                <select
                                  value={assignment.temperatureInputUnit}
                                  onChange={(event) =>
                                    setDeviceChannelAssignments((prev) =>
                                      prev.map((entry, entryIndex) =>
                                        entryIndex === index
                                          ? {
                                              ...entry,
                                              temperatureInputUnit: event.target.value as DeviceTemperatureUnit,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                >
                                  <option value="celsius">Celsius (C)</option>
                                  <option value="fahrenheit">Fahrenheit (F)</option>
                                </select>
                              </div>
                              <div className="hardware-field">
                                <label>Display Unit</label>
                                <select
                                  value={assignment.temperatureOutputUnit}
                                  onChange={(event) =>
                                    setDeviceChannelAssignments((prev) =>
                                      prev.map((entry, entryIndex) =>
                                        entryIndex === index
                                          ? {
                                              ...entry,
                                              temperatureOutputUnit: event.target.value as DeviceTemperatureUnit,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
                                >
                                  <option value="celsius">Celsius (C)</option>
                                  <option value="fahrenheit">Fahrenheit (F)</option>
                                </select>
                              </div>
                            </>
                          ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>

                <div className="inline-actions hardware-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => void testDeviceConnection()}
                    disabled={hasTargetConflict}
                  >
                    Test Connection
                  </button>
                  <button type="submit" className="accent-button" disabled={hasTargetConflict || deviceEditorSaving}>
                    {deviceEditorSaving
                      ? "Saving..."
                      : deviceEditorProfileId
                        ? "Save Profile Changes"
                        : "Save Profile"}
                  </button>
                </div>
              </form>
              <div className="inline-actions">
                {connectionTest ? (
                  <small className={`connection-test-result ${connectionTest.ok ? "ok" : "failed"}`}>
                    {connectionTest.ok ? "ok" : "failed"} {connectionTest.latencyMs}ms - {connectionTest.message}
                  </small>
                ) : null}
              </div>
              </>
            ) : null}

            <div className="hardware-live-stream panel-subsection">
              <div className="panel-header">
                <h3>Live Telemetry Stream</h3>
                <small className={isTelemetryStreamActive ? "stream-state-good" : "stream-state-waiting"}>
                  {isTelemetryStreamActive ? "Receiving updates" : "No recent update"}
                </small>
              </div>
              {lastTelemetryEventAt ? (
                <p className="muted">Last event: {new Date(lastTelemetryEventAt).toLocaleString()}</p>
              ) : (
                <p className="muted">No telemetry stream events have arrived yet.</p>
              )}

              {liveTelemetryRows.length === 0 ? (
                <p className="muted">Waiting for hardware telemetry. Once connected, values will appear here in real time.</p>
              ) : (
                <ul className="simple-list hardware-telemetry-list">
                  {liveTelemetryRows.map((entry) => (
                    <li key={`stream-${entry.plantId}`} className="compact-card">
                      <div className="profile-head">
                        <strong>{entry.plantName}</strong>
                        <span className="state-pill">{entry.plantId.slice(0, 8)}</span>
                      </div>
                      <p className="muted">
                        Moisture {formatMeasurement(entry.point.moisture, "%")} | Light{" "}
                        {formatMeasurement(entry.point.light)} | Temp {formatMeasurement(entry.point.temperature)} | Humidity{" "}
                        {formatMeasurement(entry.point.humidity, "%")} | Reservoir {formatMeasurement(entry.point.reservoirLevel, "%")}
                      </p>
                      <p className="muted">
                        Source profile: {entry.point.sourceProfileName ?? entry.point.sourceProfileId ?? "Direct ingest"}
                      </p>
                      {entry.sourceProfile ? (
                        <p className="muted">
                          Mapped labels: {entry.sourceProfile.channelAssignments
                            .filter((assignment) => assignment.plantId === entry.plantId)
                            .map((assignment) => `${assignment.measurementType}=${assignment.channel}`)
                            .join(", ") || "none"}
                        </p>
                      ) : null}
                      <p className="muted">Captured {new Date(entry.point.capturedAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Saved Profiles</h2>
              <div className="panel-actions">
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void clearAllProfiles()}
                  disabled={deletingAllProfiles || deviceProfiles.length === 0}
                >
                  {deletingAllProfiles ? "Deleting..." : "Delete All Profiles"}
                </button>
              </div>
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
                    Assignments: {profile.channelAssignments.length}
                  </p>
                  <p className="muted">
                    {profile.channelAssignments.length > 0
                      ? profile.channelAssignments
                          .map((assignment) => {
                            if ((assignment.ioType ?? "input") === "output") {
                              return `${assignment.channel} -> output/${assignment.outputLabel ?? assignment.channel}`;
                            }

                            const plantName = plantLookup.get(String(assignment.plantId ?? "")) ?? assignment.plantId;
                            return `${assignment.channel} -> ${plantName}/${assignment.measurementType}`;
                          })
                          .join(" | ")
                      : "No channel assignments"}
                  </p>
                  <div className="actions">
                    <button type="button" className="ghost-button" onClick={() => openEditDeviceEditor(profile)}>
                      Edit Profile
                    </button>
                    {!profile.isLive ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void testSavedProfileConnection(profile)}
                        disabled={profileTestInFlightId === profile.id}
                      >
                        {profileTestInFlightId === profile.id ? "Testing..." : "Test"}
                      </button>
                    ) : null}
                    <button onClick={() => void toggleLiveMode(profile.id, !profile.isLive)}>
                      {profile.isLive ? "Disable Live" : "Enable Live"}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void deleteProfile(profile.id)}
                      disabled={profileDeleteInFlightId === profile.id}
                    >
                      {profileDeleteInFlightId === profile.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                  {profileConnectionTests[profile.id] ? (
                    <div className="profile-validation-block">
                      <small className={`connection-test-result ${profileConnectionTests[profile.id]?.ok ? "ok" : "failed"}`}>
                        Test: {profileConnectionTests[profile.id]?.ok ? "ok" : "failed"} {profileConnectionTests[profile.id]?.latencyMs}ms - {profileConnectionTests[profile.id]?.message}
                      </small>
                    </div>
                  ) : null}
                  {profileValidation[profile.id]?.issues.length ? (
                    <div className="profile-validation-block">
                      <small>Validation issues found.</small>
                      <ul className="profile-validation-list">
                        {profileValidation[profile.id]?.issues.map((issue, index) => (
                          <li key={`${profile.id}-${issue.code}-${index}`} className={`issue-${issue.severity}`}>
                            [{issue.severity}] {issue.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </section>
      ) : null}

      {activePanel === "graphs" ? (
        <section className="panel graphs-panel">
          <div className="panel-header">
            <h2>Plant Graphs</h2>
            <div className="panel-actions">
              <button type="button" className="ghost-button" onClick={() => void fetchGraphHistory()} disabled={graphHistoryLoading}>
                {graphHistoryLoading ? "Refreshing..." : "Refresh History"}
              </button>
            </div>
          </div>

          <div className="graphs-controls">
            <label>
              <span>Range</span>
              <select
                value={graphRange}
                onChange={(event) => {
                  setGraphRange(event.target.value as GraphRange);
                }}
              >
                {graphRangeOptions.map((option) => (
                  <option key={`graph-range-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>View</span>
              <select
                value={graphViewMode}
                onChange={(event) => setGraphViewMode(event.target.value as GraphViewMode)}
              >
                <option value="allPlantsSingleMetric">All plants, one metric</option>
                <option value="singlePlantOverlay">Single plant, overlay metrics</option>
              </select>
            </label>
            <label>
              <span>Metric</span>
              <select
                value={graphMetric}
                onChange={(event) => setGraphMetric(event.target.value as GraphMetric)}
                disabled={graphViewMode !== "allPlantsSingleMetric"}
              >
                {graphMetricOptions.map((option) => (
                  <option key={`graph-metric-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Plant</span>
              <select
                value={graphSelectedPlantId}
                onChange={(event) => setGraphSelectedPlantId(event.target.value)}
                disabled={graphViewMode !== "singlePlantOverlay"}
              >
                {graphPlantOptions.map((option) => (
                  <option key={`graph-plant-${option.id}`} value={option.id}>
                    {option.nickname}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {graphHistoryError ? <p className="muted">Graph history error: {graphHistoryError}</p> : null}

          <div className="graphs-hero">
            <div className="graphs-canvas-wrap">
              {graphChartDataSmoothed.length === 0 ? (
                <p className="muted">No telemetry history for this range yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={460}>
                  <LineChart data={graphChartDataSmoothed} margin={{ top: 14, right: 18, bottom: 14, left: 4 }}>
                    <CartesianGrid stroke="#2a4055" strokeDasharray="4 4" />
                    <XAxis
                      type="number"
                      dataKey="ts"
                      domain={[graphRangeDomain[0], graphRangeDomain[1]]}
                      tickFormatter={(value) => formatGraphTick(Number(value), graphRange)}
                      minTickGap={20}
                      stroke="#8fb1cd"
                    />
                    <YAxis stroke="#8fb1cd" />
                    <Tooltip
                      labelFormatter={(value) => formatGraphTooltipLabel(Number(value), graphRange)}
                      contentStyle={{ background: "#0d1c2c", border: "1px solid #36516e", borderRadius: "10px" }}
                      labelStyle={{ color: "#cae0f3" }}
                    />
                    <Legend wrapperStyle={{ color: "#9bb4c9" }} />
                    {graphLineDefinitions.map((line) => (
                      <Line
                        key={`graph-line-${line.key}`}
                        type="monotone"
                        dataKey={line.key}
                        stroke={line.color}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={false}
                        connectNulls
                        name={line.label}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activePanel === "logs" ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Flow Runtime Logs</h2>
            <button type="button" className="ghost-button" onClick={() => void evaluateAutomation()}>
              Evaluate Now
            </button>
          </div>

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
        </section>
      ) : null}

      {showMobileTabbar ? (
        <nav className="mobile-tabbar" aria-label="Mobile navigation" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === "overview"}
            className={`mobile-tab ${activePanel === "overview" ? "active" : ""}`}
            onClick={() => setActivePanel("overview")}
          >
            <span className="mobile-tab-icon" aria-hidden="true">Home</span>
            <span className="mobile-tab-label">Overview</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === "plants"}
            className={`mobile-tab ${activePanel === "plants" ? "active" : ""}`}
            onClick={() => setActivePanel("plants")}
          >
            <span className="mobile-tab-icon" aria-hidden="true">Plants</span>
            <span className="mobile-tab-label">Plants</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === "devices"}
            className={`mobile-tab ${activePanel === "devices" ? "active" : ""}`}
            onClick={() => setActivePanel("devices")}
          >
            <span className="mobile-tab-icon" aria-hidden="true">Devices</span>
            <span className="mobile-tab-label">Devices</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === "graphs"}
            className={`mobile-tab ${activePanel === "graphs" ? "active" : ""}`}
            onClick={() => {
              setActivePanel("graphs");
              void fetchGraphHistory();
            }}
          >
            <span className="mobile-tab-icon" aria-hidden="true">Graphs</span>
            <span className="mobile-tab-label">Graphs</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === "logs"}
            className={`mobile-tab ${activePanel === "logs" ? "active" : ""}`}
            onClick={() => setActivePanel("logs")}
          >
            <span className="mobile-tab-icon" aria-hidden="true">Logs</span>
            <span className="mobile-tab-label">Logs</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === "flows"}
            className={`mobile-tab ${activePanel === "flows" ? "active" : ""}`}
            onClick={() => setActivePanel("flows")}
          >
            <span className="mobile-tab-icon" aria-hidden="true">Flows</span>
            <span className="mobile-tab-label">Flows</span>
          </button>
        </nav>
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

      {securityModalOpen ? (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => {
            if (!securitySaving) {
              setSecurityModalOpen(false);
            }
          }}
        >
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Security settings"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Security Settings</h2>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setSecurityModalOpen(false)}
                disabled={securitySaving}
              >
                Close
              </button>
            </div>
            <p className="muted">Rotate your app passphrase. You will remain signed in after updating it.</p>
            {securityError ? <p className="muted">Security error: {securityError}</p> : null}
            {securitySuccess ? <p className="muted">{securitySuccess}</p> : null}
            <form className="plant-form" onSubmit={(event) => void submitPassphraseChange(event)}>
              <input
                type="password"
                value={currentPassphraseDraft}
                onChange={(event) => setCurrentPassphraseDraft(event.target.value)}
                placeholder="Current passphrase"
                autoComplete="current-password"
                required
              />
              <input
                type="password"
                value={newPassphraseDraft}
                onChange={(event) => setNewPassphraseDraft(event.target.value)}
                placeholder="New passphrase (12+ chars)"
                autoComplete="new-password"
                minLength={12}
                required
              />
              <input
                type="password"
                value={confirmPassphraseDraft}
                onChange={(event) => setConfirmPassphraseDraft(event.target.value)}
                placeholder="Confirm new passphrase"
                autoComplete="new-password"
                minLength={12}
                required
              />
              <button type="submit" disabled={securitySaving}>
                {securitySaving ? "Updating..." : "Update Passphrase"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

    </main>
  );
}
