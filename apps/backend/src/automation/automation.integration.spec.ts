import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PlantRecord, TelemetryPoint } from "@vibe/shared";
import { AutomationRuntimeService } from "./automation-runtime.service";
import type { AutomationRule } from "./automation.service";

describe("Automation Evaluate Integration", () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("API evaluate endpoint with persistence", () => {
    it("executes rule, records event, and enforces cooldown across multiple cycles", () => {
      const nowIso = new Date().toISOString();
      const plantId = "plant-1";
      const ruleId = "rule-1";

      // Mock plant
      const plant: PlantRecord = {
        id: plantId,
        nickname: "Test Plant",
        species: "Test Species",
        zone: "Zone A",
        growthStage: "mature",
        healthState: "good",
        schedule: { wateringEveryDays: 3 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Mock rule
      const rule: AutomationRule = {
        id: ruleId,
        name: "Dry soil pump",
        enabled: true,
        condition: { metric: "moisture", operator: "<", value: 35 },
        action: { type: "deviceOutput", target: "profile-a:ch1", seconds: 5 },
        safety: { cooldownMinutes: 60, maxDailyRuntimeSeconds: 60 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Mock telemetry
      const dryTelemetryPoint: TelemetryPoint = {
        plantId,
        moisture: 22,
        light: 200,
        temperature: 23,
        capturedAt: nowIso,
      };

      // In-memory event storage
      const events: Array<{
        id: string;
        ruleId: string;
        source: string;
        reason: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }> = [];

      // Mock automation service
      const automationService = {
        listRules: () => [rule],
        recordRuntimeEvent: (
          _ruleId: string,
          input: Record<string, unknown>,
        ) => {
          const eventId = randomUUID();
          events.push({
            id: eventId,
            ruleId: _ruleId,
            source: String(input.source),
            reason: String(input.reason),
            payload: input.payload as Record<string, unknown>,
            createdAt: String(input.createdAt),
          });
          return eventId;
        },
        findLastRuntimeEvent: (ruleId: string, plantId: string) => {
          const lastEvent = events
            .filter((e) => e.ruleId === ruleId && e.source === "runtime")
            .filter((e) => {
              const payload = e.payload as Record<string, unknown>;
              return String(payload.plantId) === plantId;
            })
            .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1))[0];

          return lastEvent ? { createdAt: lastEvent.createdAt } : null;
        },
        dailyRuntimeSeconds: (ruleId: string, plantId: string) => {
          return events
            .filter((e) => e.ruleId === ruleId && e.source === "runtime")
            .filter((e) => {
              const payload = e.payload as Record<string, unknown>;
              return String(payload.plantId) === plantId;
            })
            .reduce((total, e) => {
              const runtimeSeconds = Number((e.payload as Record<string, unknown>).runtimeSeconds ?? 0);
              return total + runtimeSeconds;
            }, 0);
        },
      };

      // Mock plants service
      const plantsService = {
        list: () => [plant],
        update: () => plant,
      };

      // Mock telemetry state service
      const telemetryState = {
        getLatest: () => dryTelemetryPoint,
      };

      // Create automation runtime service
      const runtimeService = new AutomationRuntimeService(
        automationService as never,
        plantsService as never,
        telemetryState as never,
      );

      // First evaluation: should execute (condition met, no cooldown)
      const firstCount = runtimeService.runEvaluationCycle();
      expect(firstCount).toBe(1);
      expect(events.length).toBe(1);
      const firstEvent = events[0];
      expect(firstEvent).toBeDefined();
      expect(firstEvent?.source).toBe("runtime");
      expect(firstEvent?.payload.plantId).toBe(plantId);

      // Second evaluation immediately: should be blocked by cooldown
      const secondCount = runtimeService.runEvaluationCycle();
      expect(secondCount).toBe(0);
      expect(events.length).toBe(1); // No new event recorded
    });

    it("blocks execution when daily runtime limit is exceeded", () => {
      const nowIso = new Date().toISOString();
      const plantId = "plant-2";
      const ruleId = "rule-2";

      const plant: PlantRecord = {
        id: plantId,
        nickname: "Test Plant 2",
        species: "Test Species",
        zone: "Zone B",
        growthStage: "mature",
        healthState: "good",
        schedule: { wateringEveryDays: 3 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const rule: AutomationRule = {
        id: ruleId,
        name: "High temp pump",
        enabled: true,
        condition: { metric: "temperature", operator: ">", value: 28 },
        action: { type: "deviceOutput", target: "profile-a:ch2", seconds: 30 },
        safety: { cooldownMinutes: 5, maxDailyRuntimeSeconds: 40 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const hotTelemetryPoint: TelemetryPoint = {
        plantId,
        moisture: 60,
        light: 300,
        temperature: 29,
        capturedAt: nowIso,
      };

      // Simulate existing daily runtime
      const existingRuntime = 35; // Already used 35 seconds today

      const automationService = {
        listRules: () => [rule],
        recordRuntimeEvent: () => randomUUID(),
        findLastRuntimeEvent: () => null,
        dailyRuntimeSeconds: () => existingRuntime,
      };

      const plantsService = {
        list: () => [plant],
        update: () => plant,
      };

      const telemetryState = {
        getLatest: () => hotTelemetryPoint,
      };

      const runtimeService = new AutomationRuntimeService(
        automationService as never,
        plantsService as never,
        telemetryState as never,
      );

      // Evaluation should be blocked (35 + 30 > 40)
      const count = runtimeService.runEvaluationCycle();
      expect(count).toBe(0);
    });

    it("allows execution when daily runtime budget remains", () => {
      const nowIso = new Date().toISOString();
      const plantId = "plant-3";
      const ruleId = "rule-3";

      const plant: PlantRecord = {
        id: plantId,
        nickname: "Test Plant 3",
        species: "Test Species",
        zone: "Zone C",
        growthStage: "mature",
        healthState: "good",
        schedule: { wateringEveryDays: 3 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const rule: AutomationRule = {
        id: ruleId,
        name: "Light pump",
        enabled: true,
        condition: { metric: "light", operator: "<", value: 150 },
        action: { type: "deviceOutput", target: "profile-a:ch3", seconds: 10 },
        safety: { cooldownMinutes: 10, maxDailyRuntimeSeconds: 100 },
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const darkTelemetryPoint: TelemetryPoint = {
        plantId,
        moisture: 50,
        light: 100,
        temperature: 22,
        capturedAt: nowIso,
      };

      const existingRuntime = 80; // Already used 80 seconds, but 10 more fits

      const automationService = {
        listRules: () => [rule],
        recordRuntimeEvent: () => randomUUID(),
        findLastRuntimeEvent: () => null,
        dailyRuntimeSeconds: () => existingRuntime,
      };

      const plantsService = {
        list: () => [plant],
        update: () => plant,
      };

      const telemetryState = {
        getLatest: () => darkTelemetryPoint,
      };

      const runtimeService = new AutomationRuntimeService(
        automationService as never,
        plantsService as never,
        telemetryState as never,
      );

      // Evaluation should succeed (80 + 10 <= 100)
      const count = runtimeService.runEvaluationCycle();
      expect(count).toBe(1);
    });
  });
});
