import { describe, expect, it, vi } from "vitest";
import { AutomationFlowService } from "./automation-flow.service";

describe("AutomationFlowService", () => {
  it("compiles condition->action chains into runtime rules", () => {
    const diagramsService = {
      getSnapshot: vi.fn(() => ({
        scope: "dashboard",
        updatedAt: new Date().toISOString(),
        nodes: [
          { id: "trigger-1", data: { kind: "trigger", label: "Bedroom Plant", plantId: "plant-1" } },
          {
            id: "condition-1",
            data: { kind: "condition", metric: "moisture", operator: "<", value: 30, label: "Dry" },
          },
          {
            id: "action-1",
            data: {
              kind: "action",
              label: "Water Pump",
              actionType: "deviceOutput",
              target: "profile-1:ch1",
              seconds: 7,
              cooldownMinutes: 45,
              maxDailyRuntimeSeconds: 120,
            },
          },
        ],
        edges: [
          { source: "trigger-1", target: "condition-1" },
          { source: "condition-1", target: "action-1" },
        ],
      })),
    };

    const automationService = {
      replaceDiagramRules: vi.fn((_scope: string, rules: unknown[]) => rules),
    };

    const service = new AutomationFlowService(diagramsService as never, automationService as never);
    const result = service.applyDiagramScope("dashboard");

    expect(result.compiledRuleCount).toBe(1);
    expect(automationService.replaceDiagramRules).toHaveBeenCalledTimes(1);
    const firstRule = result.rules[0] as Record<string, unknown>;
    expect(firstRule.name).toBe("dashboard:action-1:0");
    expect(firstRule.condition).toMatchObject({ metric: "moisture", operator: "<", value: 35, plantId: "plant-1" });
    expect(firstRule.action).toMatchObject({ type: "deviceOutput", target: "profile-1:ch1", seconds: 7 });
  });

  it("returns validation issues in preview for unsupported edge types", () => {
    const diagramsService = {
      getSnapshot: vi.fn(() => ({
        scope: "dashboard",
        updatedAt: new Date().toISOString(),
        nodes: [
          { id: "action-1", data: { kind: "action", label: "Water" } },
          { id: "condition-1", data: { kind: "condition", label: "Dry" } },
        ],
        edges: [{ source: "action-1", target: "condition-1" }],
      })),
    };
    const automationService = {
      replaceDiagramRules: vi.fn((_scope: string, rules: unknown[]) => rules),
    };

    const service = new AutomationFlowService(diagramsService as never, automationService as never);
    const preview = service.previewDiagramScope("dashboard");

    expect(preview.issues.length).toBeGreaterThan(0);
    expect(preview.issues.some((issue) => issue.code === "UNSUPPORTED_EDGE")).toBe(true);
  });

  it("compiles legacy trigger->action diagrams with default moisture condition", () => {
    const diagramsService = {
      getSnapshot: vi.fn(() => ({
        scope: "dashboard",
        updatedAt: new Date().toISOString(),
        nodes: [
          { id: "start", data: { label: "Sensor Input" } },
          { id: "action", data: { label: "Water Pump Action", actionType: "deviceOutput", target: "profile-1:ch1", seconds: 6 } },
        ],
        edges: [{ source: "start", target: "action" }],
      })),
    };
    const automationService = {
      replaceDiagramRules: vi.fn((_scope: string, rules: unknown[]) => rules),
    };

    const service = new AutomationFlowService(diagramsService as never, automationService as never);
    const result = service.applyDiagramScope("dashboard");

    expect(result.compiledRuleCount).toBe(1);
    const firstRule = result.rules[0] as Record<string, unknown>;
    expect(firstRule.condition).toMatchObject({ metric: "moisture", operator: "<", value: 35 });
    expect(result.issues.some((issue) => issue.code === "ACTION_TARGET_REQUIRED")).toBe(false);
  });

  it("supports condition-to-condition chaining as an AND clause set", () => {
    const diagramsService = {
      getSnapshot: vi.fn(() => ({
        scope: "dashboard",
        updatedAt: new Date().toISOString(),
        nodes: [
          { id: "trigger-1", data: { kind: "trigger", label: "Any Plant" } },
          {
            id: "condition-1",
            data: { kind: "condition", metric: "moisture", operator: "<", value: 35, label: "Dry" },
          },
          {
            id: "condition-2",
            data: { kind: "condition", metric: "temperature", operator: ">", value: 26, label: "Warm" },
          },
          {
            id: "action-1",
            data: { kind: "action", label: "Pump", actionType: "deviceOutput", target: "profile-1:ch1", seconds: 8 },
          },
        ],
        edges: [
          { source: "trigger-1", target: "condition-1" },
          { source: "condition-1", target: "condition-2" },
          { source: "condition-2", target: "action-1" },
        ],
      })),
    };
    const automationService = {
      replaceDiagramRules: vi.fn((_scope: string, rules: unknown[]) => rules),
    };

    const service = new AutomationFlowService(diagramsService as never, automationService as never);
    const result = service.applyDiagramScope("dashboard");
    const firstRule = result.rules[0] as Record<string, unknown>;
    const condition = firstRule.condition as Record<string, unknown>;

    expect(result.compiledRuleCount).toBe(1);
    expect(Array.isArray(condition.clauses)).toBe(true);
    expect((condition.clauses as Array<Record<string, unknown>>).length).toBe(3);
  });
});
