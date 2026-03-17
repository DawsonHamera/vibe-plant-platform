import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AutomationService } from "./automation.service";

type AutomationEventRow = {
  id: string;
  rule_id: string;
  plant_id: string | null;
  source: string;
  reason: string;
  payload_json: string;
  created_at: string;
};

const makeService = (rows: AutomationEventRow[]): AutomationService => {
  const database = {
    prepare: (sql: string) => {
      if (!sql.includes("SELECT * FROM automation_events")) {
        return {
          all: () => [],
          run: () => undefined,
        };
      }

      return {
        all: (...args: unknown[]) => {
          let index = 0;
          let result = [...rows];

          if (sql.includes("rule_id = ?")) {
            const ruleId = String(args[index++]);
            result = result.filter((row) => row.rule_id === ruleId);
          }

          if (sql.includes("plant_id = ? OR (plant_id IS NULL AND instr(payload_json, ?) > 0)")) {
            const plantId = String(args[index++]);
            const legacyPlantIdSnippet = String(args[index++]);
            result = result.filter((row) => {
              return (
                row.plant_id === plantId ||
                (row.plant_id === null && row.payload_json.includes(legacyPlantIdSnippet))
              );
            });
          }

          if (sql.includes("source = ?")) {
            const source = String(args[index++]);
            result = result.filter((row) => row.source === source);
          }

          const limit = Number(args[index] ?? 50);
          return result
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
            .slice(0, limit);
        },
      };
    },
  };

  return new AutomationService({ database } as never);
};

describe("AutomationService timeline", () => {
  const rows: AutomationEventRow[] = [
    {
      id: "evt-1",
      rule_id: "rule-a",
      plant_id: null,
      source: "runtime",
      reason: "Runtime action",
      payload_json: JSON.stringify({ plantId: "plant-1", runtimeSeconds: 3 }),
      created_at: "2026-03-16T10:00:00.000Z",
    },
    {
      id: "evt-2",
      rule_id: "rule-b",
      plant_id: null,
      source: "simulation",
      reason: "Simulated action",
      payload_json: JSON.stringify({ plantId: "plant-2", runtimeSeconds: 0 }),
      created_at: "2026-03-16T11:00:00.000Z",
    },
    {
      id: "evt-3",
      rule_id: "rule-a",
      plant_id: null,
      source: "runtime",
      reason: "Runtime action",
      payload_json: JSON.stringify({ plantId: "plant-3", runtimeSeconds: 5 }),
      created_at: "2026-03-16T12:00:00.000Z",
    },
    {
      id: "evt-4",
      rule_id: "rule-c",
      plant_id: "plant-1",
      source: "runtime",
      reason: "Runtime action",
      payload_json: JSON.stringify({ plantId: "plant-1", runtimeSeconds: 7 }),
      created_at: "2026-03-16T13:00:00.000Z",
    },
  ];

  it("returns unfiltered timeline newest first", () => {
    const service = makeService(rows);

    const timeline = service.timeline();

    expect(timeline.map((event) => event.id)).toEqual(["evt-4", "evt-3", "evt-2", "evt-1"]);
  });

  it("filters timeline by source", () => {
    const service = makeService(rows);

    const timeline = service.timeline({ source: "simulation" });

    expect(timeline.map((event) => event.id)).toEqual(["evt-2"]);
  });

  it("filters timeline by ruleId", () => {
    const service = makeService(rows);

    const timeline = service.timeline({ ruleId: "rule-a" });

    expect(timeline.map((event) => event.id)).toEqual(["evt-3", "evt-1"]);
  });

  it("filters timeline by plantId in payload", () => {
    const service = makeService(rows);

    const timeline = service.timeline({ plantId: "plant-1" });

    expect(timeline.map((event) => event.id)).toEqual(["evt-4", "evt-1"]);
  });

  it("includes both new plant_id rows and legacy payload-only rows for plantId filter", () => {
    const service = makeService([
      {
        id: "evt-new",
        rule_id: "rule-a",
        plant_id: "plant-9",
        source: "runtime",
        reason: "Runtime action",
        payload_json: JSON.stringify({ plantId: "plant-9", runtimeSeconds: 2 }),
        created_at: "2026-03-16T14:00:00.000Z",
      },
      {
        id: "evt-legacy",
        rule_id: "rule-a",
        plant_id: null,
        source: "runtime",
        reason: "Runtime action",
        payload_json: JSON.stringify({ plantId: "plant-9", runtimeSeconds: 1 }),
        created_at: "2026-03-16T13:00:00.000Z",
      },
      {
        id: "evt-other",
        rule_id: "rule-a",
        plant_id: null,
        source: "runtime",
        reason: "Runtime action",
        payload_json: JSON.stringify({ plantId: "plant-10", runtimeSeconds: 3 }),
        created_at: "2026-03-16T12:00:00.000Z",
      },
    ]);

    const timeline = service.timeline({ plantId: "plant-9" });

    expect(timeline.map((event) => event.id)).toEqual(["evt-new", "evt-legacy"]);
  });

  it("persists plant_id on runtime event writes when payload contains plantId", () => {
    let sql = "";
    let params: unknown[] = [];

    const service = new AutomationService({
      database: {
        prepare: (statement: string) => {
          sql = statement;
          return {
            run: (...args: unknown[]) => {
              params = args;
            },
            all: () => [],
          };
        },
      },
    } as never);

    service.recordRuntimeEvent("rule-a", {
      id: "evt-write",
      source: "runtime",
      reason: "Runtime action",
      payload: { plantId: "plant-22", runtimeSeconds: 9 },
      createdAt: "2026-03-16T15:00:00.000Z",
    });

    expect(sql).toContain("plant_id");
    expect(params[5]).toBe("plant-22");
  });

  it("enforces limit and caps limit at 200", () => {
    const largeRows: AutomationEventRow[] = Array.from({ length: 250 }).map((_, index) => ({
      id: `evt-${index}`,
      rule_id: "rule-many",
      plant_id: null,
      source: "runtime",
      reason: "Runtime action",
      payload_json: JSON.stringify({ plantId: `plant-${index % 3}` }),
      created_at: new Date(Date.UTC(2026, 2, 16, 0, 0, index)).toISOString(),
    }));

    const service = makeService(largeRows);

    expect(service.timeline({ limit: 5 }).length).toBe(5);
    expect(service.timeline({ limit: 500 }).length).toBe(200);
  });

  it("updates enabled state in database and returns updated rule", () => {
    let updateSql = "";
    let updateParams: unknown[] = [];

    const service = new AutomationService({
      database: {
        prepare: (sql: string) => {
          if (sql.includes("SELECT * FROM automation_rules WHERE id = ?")) {
            return {
              get: (id: string) => ({
                id,
                name: "Rule",
                enabled: 1,
                condition_json: JSON.stringify({ metric: "soil" }),
                action_json: JSON.stringify({ type: "water" }),
                safety_json: JSON.stringify({ maxDailySeconds: 30 }),
                created_at: "2026-03-16T09:00:00.000Z",
                updated_at: "2026-03-16T09:00:00.000Z",
              }),
            };
          }

          if (sql.includes("UPDATE automation_rules SET")) {
            updateSql = sql;
            return {
              run: (...args: unknown[]) => {
                updateParams = args;
              },
            };
          }

          return {
            all: () => [],
            run: () => undefined,
          };
        },
      },
    } as never);

    const result = service.setRuleEnabled("rule-1", false);

    expect(updateSql).toContain("enabled = ?");
    expect(updateParams[0]).toBe(0);
    expect(updateParams[2]).toBe("rule-1");
    expect(result.id).toBe("rule-1");
    expect(result.enabled).toBe(false);
    expect(result.updatedAt).not.toBe("2026-03-16T09:00:00.000Z");
  });

  it("throws NotFoundException when toggling enabled state for missing rule", () => {
    const service = new AutomationService({
      database: {
        prepare: (sql: string) => {
          if (sql.includes("SELECT * FROM automation_rules WHERE id = ?")) {
            return {
              get: () => undefined,
            };
          }

          return {
            all: () => [],
            run: () => undefined,
          };
        },
      },
    } as never);

    expect(() => service.setRuleEnabled("missing-rule", true)).toThrow(NotFoundException);
  });
});
