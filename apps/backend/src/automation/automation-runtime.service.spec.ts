import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlantRecord, TelemetryPoint } from "@vibe/shared";
import { AutomationRuntimeService } from "./automation-runtime.service";
import type { AutomationRule } from "./automation.service";

const nowIso = new Date().toISOString();

const plant: PlantRecord = {
  id: "p1",
  nickname: "Fern",
  species: "Fern",
  zone: "Office",
  growthStage: "mature",
  healthState: "good",
  schedule: { wateringEveryDays: 3 },
  createdAt: nowIso,
  updatedAt: nowIso,
};

const telemetryPoint: TelemetryPoint = {
  plantId: "p1",
  moisture: 22,
  light: 200,
  temperature: 23,
  capturedAt: nowIso,
};

const rule: AutomationRule = {
  id: "r1",
  name: "Dry soil pump",
  enabled: true,
  condition: { metric: "moisture", operator: "<", value: 35 },
  action: { target: "pump", seconds: 8 },
  safety: { cooldownMinutes: 60, maxDailyRuntimeSeconds: 10 },
  createdAt: nowIso,
  updatedAt: nowIso,
};

describe("AutomationRuntimeService", () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes matching rule and honors cooldown/runtime limits", () => {
    const runtimeEvents: Array<Record<string, unknown>> = [];

    const automationService = {
      listRules: () => [rule],
      recordRuntimeEvent: (_ruleId: string, input: Record<string, unknown>) => {
        runtimeEvents.push(input);
      },
      findLastRuntimeEvent: () => null,
      dailyRuntimeSeconds: () => 0,
    };

    const plantsService = {
      list: () => [plant],
      markWatered: () => plant,
    };

    const telemetryState = {
      getLatest: () => telemetryPoint,
    };

    const service = new AutomationRuntimeService(
      automationService as never,
      plantsService as never,
      telemetryState as never,
    );

    const count = service.runEvaluationCycle();
    expect(count).toBe(1);
    expect(runtimeEvents.length).toBe(1);

    const blockedByCooldownService = new AutomationRuntimeService(
      {
        ...automationService,
        findLastRuntimeEvent: () => ({ createdAt: new Date().toISOString() }),
      } as never,
      plantsService as never,
      telemetryState as never,
    );

    expect(blockedByCooldownService.runEvaluationCycle()).toBe(0);

    const blockedByRuntimeService = new AutomationRuntimeService(
      {
        ...automationService,
        findLastRuntimeEvent: () => null,
        dailyRuntimeSeconds: () => 5,
      } as never,
      plantsService as never,
      telemetryState as never,
    );

    expect(blockedByRuntimeService.runEvaluationCycle()).toBe(0);
  });

  it("stops and resumes execution when a rule is disabled then re-enabled", () => {
    const mutableRule: AutomationRule = {
      ...rule,
      id: "r-toggle",
      enabled: true,
      safety: { cooldownMinutes: 0, maxDailyRuntimeSeconds: 300 },
    };

    const recordRuntimeEvent = vi.fn();
    const automationService = {
      listRules: () => [mutableRule],
      recordRuntimeEvent,
      findLastRuntimeEvent: () => null,
      dailyRuntimeSeconds: () => 0,
    };

    const plantsService = {
      list: () => [plant],
      markWatered: () => plant,
    };

    const telemetryState = {
      getLatest: () => telemetryPoint,
    };

    const service = new AutomationRuntimeService(
      automationService as never,
      plantsService as never,
      telemetryState as never,
    );

    const now = new Date("2026-03-16T12:00:00.000Z");
    expect(service.runEvaluationCycle(now)).toBe(1);

    mutableRule.enabled = false;
    expect(service.runEvaluationCycle(now)).toBe(0);

    mutableRule.enabled = true;
    expect(service.runEvaluationCycle(now)).toBe(1);

    expect(recordRuntimeEvent).toHaveBeenCalledTimes(2);
  });

  it("tracks runtime status across execution and blocked safety outcomes", () => {
    let lastRuntimeEventAt: string | null = null;
    let dailyRuntimeSeconds = 0;

    const automationService = {
      listRules: () => [rule],
      recordRuntimeEvent: (_ruleId: string, input: Record<string, unknown>) => {
        lastRuntimeEventAt = String(input.createdAt);
      },
      findLastRuntimeEvent: () =>
        lastRuntimeEventAt ? ({ createdAt: lastRuntimeEventAt } as { createdAt: string }) : null,
      dailyRuntimeSeconds: () => dailyRuntimeSeconds,
    };

    const plantsService = {
      list: () => [plant],
      markWatered: () => plant,
    };

    const telemetryState = {
      getLatest: () => telemetryPoint,
    };

    const service = new AutomationRuntimeService(
      automationService as never,
      plantsService as never,
      telemetryState as never,
    );

    const firstRunAt = new Date("2026-03-16T12:00:00.000Z");
    expect(service.runEvaluationCycle(firstRunAt)).toBe(1);
    expect(service.getRuntimeStatus()).toEqual({
      lastRunAt: firstRunAt.toISOString(),
      lastExecutionCount: 1,
      totalExecutions: 1,
      blockedCooldownCount: 0,
      blockedDailyLimitCount: 0,
    });

    const cooldownBlockedAt = new Date("2026-03-16T12:01:00.000Z");
    expect(service.runEvaluationCycle(cooldownBlockedAt)).toBe(0);
    expect(service.getRuntimeStatus()).toEqual({
      lastRunAt: cooldownBlockedAt.toISOString(),
      lastExecutionCount: 0,
      totalExecutions: 1,
      blockedCooldownCount: 1,
      blockedDailyLimitCount: 0,
    });

    lastRuntimeEventAt = "2026-03-16T10:00:00.000Z";
    dailyRuntimeSeconds = 5;

    const dailyLimitBlockedAt = new Date("2026-03-16T12:02:00.000Z");
    expect(service.runEvaluationCycle(dailyLimitBlockedAt)).toBe(0);
    expect(service.getRuntimeStatus()).toEqual({
      lastRunAt: dailyLimitBlockedAt.toISOString(),
      lastExecutionCount: 0,
      totalExecutions: 1,
      blockedCooldownCount: 1,
      blockedDailyLimitCount: 1,
    });
  });

  it("accumulates runtime history entries per cycle and returns most recent first", () => {
    let lastRuntimeEventAt: string | null = null;
    let dailyRuntimeSeconds = 0;

    const automationService = {
      listRules: () => [rule],
      recordRuntimeEvent: (_ruleId: string, input: Record<string, unknown>) => {
        lastRuntimeEventAt = String(input.createdAt);
      },
      findLastRuntimeEvent: () =>
        lastRuntimeEventAt ? ({ createdAt: lastRuntimeEventAt } as { createdAt: string }) : null,
      dailyRuntimeSeconds: () => dailyRuntimeSeconds,
    };

    const plantsService = {
      list: () => [plant],
      markWatered: () => plant,
    };

    const telemetryState = {
      getLatest: () => telemetryPoint,
    };

    const service = new AutomationRuntimeService(
      automationService as never,
      plantsService as never,
      telemetryState as never,
    );

    const firstRunAt = new Date("2026-03-16T12:00:00.000Z");
    const cooldownBlockedAt = new Date("2026-03-16T12:01:00.000Z");
    const dailyLimitBlockedAt = new Date("2026-03-16T12:02:00.000Z");

    expect(service.runEvaluationCycle(firstRunAt)).toBe(1);
    expect(service.runEvaluationCycle(cooldownBlockedAt)).toBe(0);
    lastRuntimeEventAt = "2026-03-16T10:00:00.000Z";
    dailyRuntimeSeconds = 5;
    expect(service.runEvaluationCycle(dailyLimitBlockedAt)).toBe(0);

    expect(service.getRuntimeHistory()).toEqual([
      {
        ranAt: dailyLimitBlockedAt.toISOString(),
        executionCount: 0,
        blockedCooldownCountDelta: 0,
        blockedDailyLimitCountDelta: 1,
      },
      {
        ranAt: cooldownBlockedAt.toISOString(),
        executionCount: 0,
        blockedCooldownCountDelta: 1,
        blockedDailyLimitCountDelta: 0,
      },
      {
        ranAt: firstRunAt.toISOString(),
        executionCount: 1,
        blockedCooldownCountDelta: 0,
        blockedDailyLimitCountDelta: 0,
      },
    ]);
  });

  it("applies history limit and returns latest entries first", () => {
    const automationService = {
      listRules: () => [rule],
      recordRuntimeEvent: vi.fn(),
      findLastRuntimeEvent: () => null,
      dailyRuntimeSeconds: () => 0,
    };

    const plantsService = {
      list: () => [plant],
      markWatered: () => plant,
    };

    const telemetryState = {
      getLatest: () => telemetryPoint,
    };

    const service = new AutomationRuntimeService(
      automationService as never,
      plantsService as never,
      telemetryState as never,
    );

    for (let i = 0; i < 205; i += 1) {
      service.runEvaluationCycle(new Date(`2026-03-16T12:${String(i % 60).padStart(2, "0")}:00.000Z`));
    }

    const limited = service.getRuntimeHistory(2);
    expect(limited).toHaveLength(2);
    expect(limited[0]?.ranAt).toBe("2026-03-16T12:24:00.000Z");
    expect(limited[1]?.ranAt).toBe("2026-03-16T12:23:00.000Z");

    expect(service.getRuntimeHistory(999)).toHaveLength(200);
  });
});
