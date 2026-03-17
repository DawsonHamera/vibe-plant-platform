import { BadRequestException, Logger, ValidationPipe } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationController } from "./automation.controller";
import { TimelineQueryDto } from "./dto/timeline-query.dto";

describe("AutomationController timeline query validation", () => {
  const validationPipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });

  const transformTimelineQuery = async (
    query: Record<string, unknown>,
  ): Promise<TimelineQueryDto> => {
    return validationPipe.transform(query, {
      type: "query",
      metatype: TimelineQueryDto,
      data: "query",
    }) as Promise<TimelineQueryDto>;
  };

  const automationService = {
    listRules: vi.fn(() => []),
    createRule: vi.fn(),
    timeline: vi.fn(() => []),
    simulate: vi.fn(),
    setRuleEnabled: vi.fn(),
  };

  const runtimeService = {
    runEvaluationCycle: vi.fn(() => 0),
    getRuntimeStatus: vi.fn(() => ({
      lastRunAt: null,
      lastExecutionCount: 0,
      totalExecutions: 0,
      blockedCooldownCount: 0,
      blockedDailyLimitCount: 0,
    })),
    getRuntimeHistory: vi.fn(() => []),
  };

  const flowService = {
    applyDiagramScope: vi.fn(() => ({
      scope: "dashboard",
      compiledRuleCount: 0,
      rules: [],
      issues: [],
    })),
    previewDiagramScope: vi.fn(() => ({
      scope: "dashboard",
      compiledRuleCount: 0,
      compiledRules: [],
      issues: [],
    })),
  };

  const controller = new AutomationController(
    automationService as never,
    runtimeService as never,
    flowService as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards normalized valid query values to service timeline", async () => {
    const query = await transformTimelineQuery({ limit: "25", source: "runtime" });

    controller.timeline(query);

    expect(automationService.timeline).toHaveBeenCalledWith({
      source: "runtime",
      limit: 25,
    });
  });

  it("rejects non-numeric limit with BadRequestException via ValidationPipe strategy", async () => {
    await expect(
      transformTimelineQuery({ limit: "not-a-number" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects out-of-range limit with BadRequestException via ValidationPipe strategy", async () => {
    await expect(transformTimelineQuery({ limit: "0" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(transformTimelineQuery({ limit: "201" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("passes optional filter combinations ruleId, source, plantId, and limit", async () => {
    const query = await transformTimelineQuery({
      ruleId: "rule-42",
      source: "simulation",
      plantId: "plant-88",
      limit: "12",
    });

    controller.timeline(query);

    expect(automationService.timeline).toHaveBeenCalledWith({
      ruleId: "rule-42",
      source: "simulation",
      plantId: "plant-88",
      limit: 12,
    });
  });

  it("forwards enabled toggle payload to service", () => {
    const updatedRule = {
      id: "rule-7",
      name: "Watering",
      enabled: false,
      condition: { metric: "moisture", below: 25 },
      action: { type: "irrigate", seconds: 12 },
      safety: { maxDailySeconds: 120 },
      createdAt: "2026-03-16T10:00:00.000Z",
      updatedAt: "2026-03-16T10:05:00.000Z",
    };
    automationService.setRuleEnabled.mockReturnValue(updatedRule);

    const result = controller.setRuleEnabled("rule-7", { enabled: false });

    expect(automationService.setRuleEnabled).toHaveBeenCalledWith("rule-7", false);
    expect(result).toEqual(updatedRule);
  });

  it("returns runtime status from runtime service passthrough", () => {
    const status = {
      lastRunAt: "2026-03-16T10:00:00.000Z",
      lastExecutionCount: 2,
      totalExecutions: 7,
      blockedCooldownCount: 3,
      blockedDailyLimitCount: 1,
    };
    runtimeService.getRuntimeStatus.mockReturnValue(status as never);

    const result = controller.runtimeStatus();

    expect(runtimeService.getRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(result).toEqual(status);
  });

  it("passes default limit to runtime-history service and returns response", () => {
    const history = [
      {
        ranAt: "2026-03-16T10:00:00.000Z",
        executionCount: 2,
        blockedCooldownCountDelta: 1,
        blockedDailyLimitCountDelta: 0,
      },
    ];
    runtimeService.getRuntimeHistory.mockReturnValue(history as never);

    const result = controller.runtimeHistory();

    expect(runtimeService.getRuntimeHistory).toHaveBeenCalledWith(20);
    expect(result).toEqual(history);
  });

  it("normalizes and forwards provided runtime-history limit", () => {
    controller.runtimeHistory("250");
    expect(runtimeService.getRuntimeHistory).toHaveBeenCalledWith(200);

    controller.runtimeHistory("0");
    expect(runtimeService.getRuntimeHistory).toHaveBeenCalledWith(1);

    controller.runtimeHistory("not-a-number");
    expect(runtimeService.getRuntimeHistory).toHaveBeenCalledWith(20);
  });

  it("applies diagram scope through flow service", () => {
    const expected = {
      scope: "dashboard",
      compiledRuleCount: 2,
      rules: [{ id: "rule-1" }],
      issues: [],
    };
    flowService.applyDiagramScope.mockReturnValue(expected as never);

    const result = controller.applyDiagramScope({ scope: "dashboard" });

    expect(flowService.applyDiagramScope).toHaveBeenCalledWith("dashboard");
    expect(result).toEqual(expected);
  });

  it("previews diagram scope through flow service", () => {
    const expected = {
      scope: "dashboard",
      compiledRuleCount: 1,
      compiledRules: [{ name: "Water Pump" }],
      issues: [{ severity: "warning", code: "LEGACY_DIRECT_ACTION" }],
    };
    flowService.previewDiagramScope.mockReturnValue(expected as never);

    const result = controller.previewDiagramScope({ scope: "dashboard" });

    expect(flowService.previewDiagramScope).toHaveBeenCalledWith("dashboard");
    expect(result).toEqual(expected);
  });
});