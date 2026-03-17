import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SqliteService } from "../database/sqlite.service";
import { CreateRuleDto } from "./dto/create-rule.dto";

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  safety: Record<string, unknown>;
  sourceType?: "manual" | "diagram";
  sourceScope?: string;
  createdAt: string;
  updatedAt: string;
};

export type TimelineQuery = {
  ruleId?: string;
  plantId?: string;
  source?: string;
  limit?: number;
};

@Injectable()
export class AutomationService {
  constructor(private readonly sqlite: SqliteService) {}

  listRules(): AutomationRule[] {
    const stmt = this.sqlite.database.prepare(`
      SELECT * FROM automation_rules ORDER BY created_at DESC
    `);

    return stmt.all().map((row) => this.mapRule(row as Record<string, unknown>));
  }

  createRule(payload: CreateRuleDto): AutomationRule {
    const now = new Date().toISOString();
    const rule: AutomationRule = {
      id: randomUUID(),
      name: payload.name,
      enabled: payload.enabled,
      condition: payload.condition,
      action: payload.action,
      safety: payload.safety,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.sqlite.database.prepare(`
      INSERT INTO automation_rules (
        id, name, enabled, condition_json, action_json,
        safety_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      rule.id,
      rule.name,
      rule.enabled ? 1 : 0,
      JSON.stringify(rule.condition),
      JSON.stringify(rule.action),
      JSON.stringify(rule.safety),
      rule.createdAt,
      rule.updatedAt,
    );

    return rule;
  }

  replaceDiagramRules(
    scope: string,
    compiledRules: Array<{
      name: string;
      enabled: boolean;
      condition: Record<string, unknown>;
      action: Record<string, unknown>;
      safety: Record<string, unknown>;
    }>,
  ): AutomationRule[] {
    const normalizedScope = scope.trim().toLowerCase() || "dashboard";
    const sourceTypeSnippet = `"sourceType":"diagram"`;
    const sourceScopeSnippet = `"sourceScope":${JSON.stringify(normalizedScope)}`;

    const deleteStmt = this.sqlite.database.prepare(`
      DELETE FROM automation_rules
      WHERE instr(safety_json, ?) > 0
        AND instr(safety_json, ?) > 0
    `);
    deleteStmt.run(sourceTypeSnippet, sourceScopeSnippet);

    const now = new Date().toISOString();
    const insertStmt = this.sqlite.database.prepare(`
      INSERT INTO automation_rules (
        id, name, enabled, condition_json, action_json,
        safety_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const createdRules: AutomationRule[] = [];
    for (const compiled of compiledRules) {
      const next: AutomationRule = {
        id: randomUUID(),
        name: compiled.name,
        enabled: compiled.enabled,
        condition: compiled.condition,
        action: compiled.action,
        safety: {
          ...compiled.safety,
          sourceType: "diagram",
          sourceScope: normalizedScope,
        },
        sourceType: "diagram",
        sourceScope: normalizedScope,
        createdAt: now,
        updatedAt: now,
      };

      insertStmt.run(
        next.id,
        next.name,
        next.enabled ? 1 : 0,
        JSON.stringify(next.condition),
        JSON.stringify(next.action),
        JSON.stringify(next.safety),
        next.createdAt,
        next.updatedAt,
      );

      createdRules.push(next);
    }

    return createdRules;
  }

  setRuleEnabled(id: string, enabled: boolean): AutomationRule {
    const rule = this.getRuleById(id);
    const updatedAt = new Date().toISOString();
    const stmt = this.sqlite.database.prepare(`
      UPDATE automation_rules SET
        enabled = ?,
        updated_at = ?
      WHERE id = ?
    `);

    stmt.run(enabled ? 1 : 0, updatedAt, id);
    return { ...rule, enabled, updatedAt };
  }

  simulate(ruleId: string): { accepted: boolean; eventId: string } {
    const eventId = randomUUID();
    this.recordRuntimeEvent(ruleId, {
      source: "simulation",
      reason: "Dry-run simulation requested",
      payload: { simulated: true, runtimeSeconds: 0 },
      createdAt: new Date().toISOString(),
      id: eventId,
    });

    return { accepted: true, eventId };
  }

  recordRuntimeEvent(
    ruleId: string,
    input: {
      source: string;
      reason: string;
      payload: Record<string, unknown>;
      createdAt: string;
      id?: string;
    },
  ): string {
    const eventId = input.id ?? randomUUID();
    const plantId = this.extractPlantId(input.payload);
    const stmt = this.sqlite.database.prepare(`
      INSERT INTO automation_events (id, rule_id, source, reason, payload_json, plant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      eventId,
      ruleId,
      input.source,
      input.reason,
      JSON.stringify(input.payload),
      plantId,
      input.createdAt,
    );

    return eventId;
  }

  findLastRuntimeEvent(ruleId: string, plantId: string): { createdAt: string } | null {
    const stmt = this.sqlite.database.prepare(`
      SELECT created_at, payload_json
      FROM automation_events
      WHERE rule_id = ? AND source = 'runtime'
      ORDER BY created_at DESC
      LIMIT 50
    `);

    const rows = stmt.all(ruleId) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
      if (String(payload.plantId) === plantId) {
        return { createdAt: String(row.created_at) };
      }
    }

    return null;
  }

  dailyRuntimeSeconds(ruleId: string, plantId: string, now: Date): number {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const stmt = this.sqlite.database.prepare(`
      SELECT payload_json
      FROM automation_events
      WHERE rule_id = ? AND source = 'runtime' AND created_at >= ?
    `);

    const rows = stmt.all(ruleId, dayStart.toISOString()) as Array<Record<string, unknown>>;
    return rows.reduce((total, row) => {
      const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
      if (String(payload.plantId) !== plantId) {
        return total;
      }

      const runtimeSeconds = Number(payload.runtimeSeconds ?? 0);
      return total + runtimeSeconds;
    }, 0);
  }

  timeline(query: TimelineQuery = {}): Array<Record<string, unknown>> {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (query.ruleId) {
      where.push("rule_id = ?");
      params.push(query.ruleId);
    }

    if (query.plantId) {
      where.push("(plant_id = ? OR (plant_id IS NULL AND instr(payload_json, ?) > 0))");
      params.push(query.plantId);
      params.push(`"plantId":${JSON.stringify(query.plantId)}`);
    }

    if (query.source) {
      where.push("source = ?");
      params.push(query.source);
    }

    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const stmt = this.sqlite.database.prepare(`
      SELECT * FROM automation_events ${whereClause} ORDER BY created_at DESC LIMIT ?
    `);
    params.push(limit);

    return stmt.all(...params).map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      source: row.source,
      reason: row.reason,
      payload: JSON.parse(String(row.payload_json)),
      createdAt: row.created_at,
    }));
  }

  private mapRule(row: Record<string, unknown>): AutomationRule {
    const safety = JSON.parse(String(row.safety_json)) as Record<string, unknown>;

    return {
      id: String(row.id),
      name: String(row.name),
      enabled: Number(row.enabled) === 1,
      condition: JSON.parse(String(row.condition_json)) as Record<string, unknown>,
      action: JSON.parse(String(row.action_json)) as Record<string, unknown>,
      safety,
      sourceType:
        safety.sourceType === "diagram" || safety.sourceType === "manual"
          ? (safety.sourceType as "diagram" | "manual")
          : undefined,
      sourceScope: typeof safety.sourceScope === "string" ? safety.sourceScope : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private getRuleById(id: string): AutomationRule {
    const stmt = this.sqlite.database.prepare("SELECT * FROM automation_rules WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new NotFoundException(`Automation rule ${id} was not found`);
    }

    return this.mapRule(row);
  }

  private extractPlantId(payload: Record<string, unknown>): string | null {
    const plantId = payload.plantId;
    if (plantId === undefined || plantId === null) {
      return null;
    }

    return String(plantId);
  }
}
