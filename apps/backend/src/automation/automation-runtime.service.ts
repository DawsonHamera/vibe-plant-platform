import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { PlantHealthState, TelemetryPoint } from "@vibe/shared";
import { PlantsService } from "../plants/plants.service";
import { TelemetryStateService } from "../telemetry/telemetry-state.service";
import { AutomationService, AutomationRule } from "./automation.service";

type RuleCondition = {
  metric: "moisture" | "light" | "temperature";
  operator: "<" | "<=" | ">" | ">=";
  value: number;
  plantId?: string;
  clauses?: Array<{
    metric: "moisture" | "light" | "temperature";
    operator: "<" | "<=" | ">" | ">=";
    value: number;
  }>;
};

type RuleAction =
  | {
      type: "deviceOutput";
      target: string;
      seconds: number;
    }
  | {
      type: "updatePlantStatus";
      status: PlantHealthState;
      seconds: number;
    };

type RuleSafety = {
  cooldownMinutes: number;
  maxDailyRuntimeSeconds: number;
};

export type AutomationRuntimeStatus = {
  lastRunAt: string | null;
  lastExecutionCount: number;
  totalExecutions: number;
  blockedCooldownCount: number;
  blockedDailyLimitCount: number;
};

export type AutomationRuntimeHistoryEntry = {
  ranAt: string;
  executionCount: number;
  blockedCooldownCountDelta: number;
  blockedDailyLimitCountDelta: number;
};

const MAX_RUNTIME_HISTORY_BUFFER = 500;

@Injectable()
export class AutomationRuntimeService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(AutomationRuntimeService.name);
  private readonly runtimeStatus: AutomationRuntimeStatus = {
    lastRunAt: null,
    lastExecutionCount: 0,
    totalExecutions: 0,
    blockedCooldownCount: 0,
    blockedDailyLimitCount: 0,
  };
  private readonly runtimeHistory: AutomationRuntimeHistoryEntry[] = [];

  constructor(
    private readonly automationService: AutomationService,
    private readonly plantsService: PlantsService,
    private readonly telemetryState: TelemetryStateService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.runEvaluationCycle();
    }, 7000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  getRuntimeStatus(): AutomationRuntimeStatus {
    return { ...this.runtimeStatus };
  }

  getRuntimeHistory(limit = 20): AutomationRuntimeHistoryEntry[] {
    const parsedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 20;
    const normalizedLimit = Math.max(1, Math.min(parsedLimit, 200));

    return this.runtimeHistory
      .slice(-normalizedLimit)
      .reverse()
      .map((entry) => ({ ...entry }));
  }

  runEvaluationCycle(now = new Date()): number {
    const rules = this.automationService.listRules().filter((rule) => rule.enabled);
    let executions = 0;
    let blockedCooldownInCycle = 0;
    let blockedDailyLimitInCycle = 0;

    for (const rule of rules) {
      const condition = this.parseCondition(rule);
      const action = this.parseAction(rule);
      const safety = this.parseSafety(rule);

      const plants = this.plantsService.list();
      for (const plant of plants) {
        const point = this.telemetryState.getLatest(plant.id);
        if (!point) {
          continue;
        }

        if (condition.plantId && condition.plantId !== plant.id) {
          continue;
        }

        if (!this.matchesRuleCondition(point, condition)) {
          continue;
        }

        const safetyCheck = this.evaluateSafety(rule.id, plant.id, action.seconds, safety, now);
        if (!safetyCheck.allowed) {
          this.logger.warn(
            `Rule ${rule.id} blocked for plant ${plant.id}: ${safetyCheck.reason}`,
          );

          if (safetyCheck.reason === "cooldown window active") {
            blockedCooldownInCycle += 1;
          }

          if (safetyCheck.reason === "daily runtime budget exceeded") {
            blockedDailyLimitInCycle += 1;
          }

          continue;
        }

        this.automationService.recordRuntimeEvent(rule.id, {
          source: "runtime",
          reason: `Condition matched for ${condition.metric}`,
          payload: {
            plantId: plant.id,
            metric: condition.metric,
            value: point[condition.metric],
            actionType: action.type,
            ...(action.type === "deviceOutput"
              ? { actionTarget: action.target }
              : { nextHealthState: action.status }),
            runtimeSeconds: action.seconds,
          },
          createdAt: now.toISOString(),
        });

        if (action.type === "updatePlantStatus") {
          this.plantsService.update(plant.id, { healthState: action.status });
        }

        this.logger.log(
          `Rule ${rule.id} executed for plant ${plant.id} (${action.type}/${action.seconds}s)`,
        );

        executions += 1;
      }
    }

    this.logger.log(`Runtime evaluation cycle finished with ${executions} execution(s)`);

    this.runtimeStatus.lastRunAt = now.toISOString();
    this.runtimeStatus.lastExecutionCount = executions;
    this.runtimeStatus.totalExecutions += executions;
    this.runtimeStatus.blockedCooldownCount += blockedCooldownInCycle;
    this.runtimeStatus.blockedDailyLimitCount += blockedDailyLimitInCycle;

    this.runtimeHistory.push({
      ranAt: now.toISOString(),
      executionCount: executions,
      blockedCooldownCountDelta: blockedCooldownInCycle,
      blockedDailyLimitCountDelta: blockedDailyLimitInCycle,
    });

    if (this.runtimeHistory.length > MAX_RUNTIME_HISTORY_BUFFER) {
      this.runtimeHistory.shift();
    }

    return executions;
  }

  private parseCondition(rule: AutomationRule): RuleCondition {
    const rawClauses = Array.isArray(rule.condition.clauses)
      ? (rule.condition.clauses as Array<Record<string, unknown>>)
      : [];
    const clauses = rawClauses
      .map((clause) => ({
        metric: (clause.metric as RuleCondition["metric"]) ?? "moisture",
        operator: (clause.operator as RuleCondition["operator"]) ?? "<",
        value: Number(clause.value ?? 35),
      }))
      .filter((clause) => Number.isFinite(clause.value));

    return {
      metric: (rule.condition.metric as RuleCondition["metric"]) ?? "moisture",
      operator: (rule.condition.operator as RuleCondition["operator"]) ?? "<",
      value: Number(rule.condition.value ?? 35),
      plantId:
        typeof rule.condition.plantId === "string" && rule.condition.plantId.trim().length > 0
          ? rule.condition.plantId
          : undefined,
      ...(clauses.length > 0 ? { clauses } : {}),
    };
  }

  private parseAction(rule: AutomationRule): RuleAction {
    const actionType = String(rule.action.type ?? "deviceOutput");
    const seconds = Number(rule.action.seconds ?? 6);

    if (actionType === "updatePlantStatus") {
      const status = String(rule.action.status ?? "watch") as PlantHealthState;
      return {
        type: "updatePlantStatus",
        status,
        seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
      };
    }

    return {
      type: "deviceOutput",
      target: String(rule.action.target ?? ""),
      seconds: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    };
  }

  private parseSafety(rule: AutomationRule): RuleSafety {
    return {
      cooldownMinutes: Number(rule.safety.cooldownMinutes ?? 60),
      maxDailyRuntimeSeconds: Number(rule.safety.maxDailyRuntimeSeconds ?? 90),
    };
  }

  private matchesCondition(value: number, operator: RuleCondition["operator"], threshold: number): boolean {
    if (operator === "<") return value < threshold;
    if (operator === "<=") return value <= threshold;
    if (operator === ">") return value > threshold;
    return value >= threshold;
  }

  private matchesRuleCondition(point: TelemetryPoint, condition: RuleCondition): boolean {
    if (Array.isArray(condition.clauses) && condition.clauses.length > 0) {
      return condition.clauses.every((clause) => {
        const metricValue = point[clause.metric];
        if (metricValue === undefined) {
          return false;
        }

        return this.matchesCondition(metricValue, clause.operator, clause.value);
      });
    }

    const metricValue = point[condition.metric];
    if (metricValue === undefined) {
      return false;
    }

    return this.matchesCondition(metricValue, condition.operator, condition.value);
  }

  private evaluateSafety(
    ruleId: string,
    plantId: string,
    runtimeSeconds: number,
    safety: RuleSafety,
    now: Date,
  ): { allowed: boolean; reason: string } {
    const recentEvent = this.automationService.findLastRuntimeEvent(ruleId, plantId);
    if (recentEvent) {
      const deltaMs = now.getTime() - new Date(recentEvent.createdAt).getTime();
      if (deltaMs < safety.cooldownMinutes * 60 * 1000) {
        return { allowed: false, reason: "cooldown window active" };
      }
    }

    const usedToday = this.automationService.dailyRuntimeSeconds(ruleId, plantId, now);
    if (usedToday + runtimeSeconds > safety.maxDailyRuntimeSeconds) {
      return { allowed: false, reason: "daily runtime budget exceeded" };
    }

    return { allowed: true, reason: "ok" };
  }
}
