import { Injectable } from "@nestjs/common";
import { DiagramsService } from "../diagrams/diagrams.service";
import { AutomationRule, AutomationService } from "./automation.service";

type FlowNodeKind = "trigger" | "condition" | "action";

type FlowNode = {
  id: string;
  data: {
    label?: string;
    kind?: FlowNodeKind;
    metric?: "moisture" | "light" | "temperature";
    operator?: "<" | "<=" | ">" | ">=";
    value?: number;
    target?: "pump" | "mister" | "relay";
    seconds?: number;
    cooldownMinutes?: number;
    maxDailyRuntimeSeconds?: number;
    plantId?: string;
  };
};

type FlowEdge = {
  source?: string;
  target?: string;
};

type FlowConditionClause = {
  metric: "moisture" | "light" | "temperature";
  operator: "<" | "<=" | ">" | ">=";
  value: number;
};

type CompiledRuleInput = {
  name: string;
  enabled: boolean;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  safety: Record<string, unknown>;
};

export type FlowValidationIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
  nodeId?: string;
};

export type DiagramPreviewResult = {
  scope: string;
  compiledRuleCount: number;
  compiledRules: CompiledRuleInput[];
  issues: FlowValidationIssue[];
};

export type DiagramApplyResult = {
  scope: string;
  compiledRuleCount: number;
  rules: AutomationRule[];
  issues: FlowValidationIssue[];
};

@Injectable()
export class AutomationFlowService {
  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly automationService: AutomationService,
  ) {}

  previewDiagramScope(scope: string): DiagramPreviewResult {
    const snapshot = this.diagramsService.getSnapshot(scope);
    const { compiledRules, issues } = this.compileRules(
      snapshot.scope,
      snapshot.nodes as FlowNode[],
      snapshot.edges as FlowEdge[],
    );

    return {
      scope: snapshot.scope,
      compiledRuleCount: compiledRules.length,
      compiledRules,
      issues,
    };
  }

  applyDiagramScope(scope: string): DiagramApplyResult {
    const preview = this.previewDiagramScope(scope);
    const rules = this.automationService.replaceDiagramRules(preview.scope, preview.compiledRules);

    return {
      scope: preview.scope,
      compiledRuleCount: rules.length,
      rules,
      issues: preview.issues,
    };
  }

  private compileRules(
    scope: string,
    nodes: FlowNode[],
    edges: FlowEdge[],
  ): { compiledRules: CompiledRuleInput[]; issues: FlowValidationIssue[] } {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const issues: FlowValidationIssue[] = [];
    const result: CompiledRuleInput[] = [];

    for (const edge of edges) {
      if (!edge.source || !edge.target) {
        issues.push({
          severity: "error",
          code: "INVALID_EDGE",
          message: "Edge is missing source or target.",
        });
        continue;
      }

      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!sourceNode || !targetNode) {
        issues.push({
          severity: "error",
          code: "MISSING_EDGE_NODE",
          message: "Edge references a node that does not exist.",
        });
        continue;
      }

      const sourceKind = this.getNodeKind(sourceNode);
      const targetKind = this.getNodeKind(targetNode);
      const validConnection =
        (sourceKind === "trigger" && targetKind === "condition") ||
        (sourceKind === "condition" && targetKind === "condition") ||
        (sourceKind === "condition" && targetKind === "action") ||
        (sourceKind === "trigger" && targetKind === "action");

      if (!validConnection) {
        issues.push({
          severity: "error",
          code: "UNSUPPORTED_EDGE",
          message: `Unsupported edge ${sourceKind} -> ${targetKind}.`,
          nodeId: targetNode.id,
        });
      }

      if (sourceKind === "trigger" && targetKind === "action") {
        issues.push({
          severity: "warning",
          code: "LEGACY_DIRECT_ACTION",
          message: "Direct trigger -> action edge uses default moisture condition (< 35).",
          nodeId: targetNode.id,
        });
      }
    }

    const actionNodes = nodes.filter((node) => this.getNodeKind(node) === "action");
    for (const actionNode of actionNodes) {
      const incomingConditionEdges = edges.filter((edge) => edge.target === actionNode.id);
      let hasCompiledRuleForAction = false;
      for (const edge of incomingConditionEdges) {
        const maybeCondition = edge.source ? nodeById.get(edge.source) : null;
        if (!maybeCondition || this.getNodeKind(maybeCondition) !== "condition") {
          continue;
        }

        const chain = this.collectConditionChain(maybeCondition.id, nodeById, edges);
        issues.push(...chain.issues);

        const conditions = chain.conditions.length > 0 ? chain.conditions : [maybeCondition];
        const clauses: FlowConditionClause[] = conditions.map((conditionNode) => ({
          metric: conditionNode.data.metric ?? "moisture",
          operator: conditionNode.data.operator ?? "<",
          value: Number(conditionNode.data.value ?? 35),
        }));

        const primary = clauses[0] ?? { metric: "moisture", operator: "<", value: 35 };
        const triggerPlantId = chain.triggerPlantId;

        result.push({
          name: actionNode.data.label?.trim() || `${maybeCondition.data.label?.trim() || "Flow"} Action`,
          enabled: true,
          condition: {
            metric: primary.metric,
            operator: primary.operator,
            value: primary.value,
            ...(clauses.length > 1 ? { clauses } : {}),
            ...(triggerPlantId ? { plantId: triggerPlantId } : {}),
          },
          action: {
            target: actionNode.data.target ?? "pump",
            seconds: Number(actionNode.data.seconds ?? 8),
          },
          safety: {
            cooldownMinutes: Number(actionNode.data.cooldownMinutes ?? 60),
            maxDailyRuntimeSeconds: Number(actionNode.data.maxDailyRuntimeSeconds ?? 90),
            sourceType: "diagram",
            sourceScope: scope,
          },
        });

        hasCompiledRuleForAction = true;
      }

      // Legacy compatibility: treat direct trigger->action edges as moisture threshold automation.
      const incomingTriggerEdges = edges.filter((edge) => edge.target === actionNode.id);
      for (const edge of incomingTriggerEdges) {
        const maybeTrigger = edge.source ? nodeById.get(edge.source) : null;
        if (!maybeTrigger || this.getNodeKind(maybeTrigger) !== "trigger") {
          continue;
        }

        const alreadyHasConditionRule = result.some((rule) => rule.name === (actionNode.data.label?.trim() || ""));
        if (alreadyHasConditionRule) {
          continue;
        }

        result.push({
          name: actionNode.data.label?.trim() || "Legacy Flow Action",
          enabled: true,
          condition: {
            metric: "moisture",
            operator: "<",
            value: 35,
            ...(maybeTrigger.data.plantId ? { plantId: maybeTrigger.data.plantId } : {}),
          },
          action: {
            target: actionNode.data.target ?? "pump",
            seconds: Number(actionNode.data.seconds ?? 8),
          },
          safety: {
            cooldownMinutes: Number(actionNode.data.cooldownMinutes ?? 60),
            maxDailyRuntimeSeconds: Number(actionNode.data.maxDailyRuntimeSeconds ?? 90),
            sourceType: "diagram",
            sourceScope: scope,
          },
        });

        hasCompiledRuleForAction = true;
      }

      if (!hasCompiledRuleForAction) {
        issues.push({
          severity: "warning",
          code: "ACTION_NOT_CONNECTED",
          message: "Action node is not connected to a valid trigger/condition chain.",
          nodeId: actionNode.id,
        });
      }
    }

    return {
      compiledRules: result,
      issues,
    };
  }

  private collectConditionChain(
    startConditionId: string,
    nodeById: Map<string, FlowNode>,
    edges: FlowEdge[],
  ): { conditions: FlowNode[]; triggerPlantId?: string; issues: FlowValidationIssue[] } {
    const conditions: FlowNode[] = [];
    const issues: FlowValidationIssue[] = [];
    const seen = new Set<string>();
    let currentId: string | null = startConditionId;
    let triggerPlantId: string | undefined;

    while (currentId) {
      if (seen.has(currentId)) {
        issues.push({
          severity: "error",
          code: "CONDITION_CYCLE",
          message: "Cycle detected in chained condition nodes.",
          nodeId: currentId,
        });
        break;
      }

      seen.add(currentId);
      const currentNode = nodeById.get(currentId);
      if (!currentNode || this.getNodeKind(currentNode) !== "condition") {
        break;
      }

      conditions.push(currentNode);
      const incoming = edges.filter((edge) => edge.target === currentId && edge.source);
      if (incoming.length === 0) {
        break;
      }

      const upstreamNodes = incoming
        .map((edge) => nodeById.get(String(edge.source)))
        .filter((node): node is FlowNode => Boolean(node));

      const conditionParents = upstreamNodes.filter((node) => this.getNodeKind(node) === "condition");
      const triggerParents = upstreamNodes.filter((node) => this.getNodeKind(node) === "trigger");

      if (conditionParents.length > 1) {
        issues.push({
          severity: "warning",
          code: "MULTIPLE_UPSTREAM_CONDITIONS",
          message: "Multiple upstream conditions found; using the first connection for chaining.",
          nodeId: currentId,
        });
      }

      if (triggerParents.length > 1) {
        issues.push({
          severity: "warning",
          code: "MULTIPLE_UPSTREAM_TRIGGERS",
          message: "Multiple trigger nodes found; using the first trigger connection.",
          nodeId: currentId,
        });
      }

      if (conditionParents.length > 0) {
        currentId = conditionParents[0]?.id ?? null;
        continue;
      }

      if (triggerParents.length > 0) {
        const trigger = triggerParents[0];
        triggerPlantId =
          typeof trigger?.data.plantId === "string" && trigger.data.plantId.trim().length > 0
            ? trigger.data.plantId.trim()
            : undefined;
      }

      break;
    }

    return {
      conditions,
      triggerPlantId,
      issues,
    };
  }

  private getNodeKind(node: FlowNode): FlowNodeKind {
    if (node.data.kind) {
      return node.data.kind;
    }

    const label = (node.data.label ?? "").toLowerCase();
    if (label.includes("condition") || label.includes("dry") || label.includes("threshold")) {
      return "condition";
    }

    if (label.includes("action") || label.includes("pump") || label.includes("mister") || label.includes("relay")) {
      return "action";
    }

    return "trigger";
  }
}
