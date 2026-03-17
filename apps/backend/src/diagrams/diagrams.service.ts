import { Injectable } from "@nestjs/common";
import { SqliteService } from "../database/sqlite.service";

export type DiagramSnapshotRecord = {
  scope: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  updatedAt: string;
};

const defaultDiagramSnapshot = (): DiagramSnapshotRecord => ({
  scope: "dashboard",
  nodes: [
    {
      id: "start",
      type: "default",
      position: { x: 140, y: 80 },
      data: { label: "Sensor Input" },
    },
    {
      id: "action",
      type: "default",
      position: { x: 400, y: 210 },
      data: { label: "Water Pump Action" },
    },
  ],
  edges: [
    {
      id: "edge-start-action",
      source: "start",
      target: "action",
      animated: true,
      label: "when moisture < 35%",
    },
  ],
  updatedAt: new Date(0).toISOString(),
});

@Injectable()
export class DiagramsService {
  constructor(private readonly sqlite: SqliteService) {}

  getSnapshot(scope: string): DiagramSnapshotRecord {
    const normalizedScope = this.normalizeScope(scope);
    const stmt = this.sqlite.database.prepare(
      "SELECT scope, nodes_json, edges_json, updated_at FROM diagram_snapshots WHERE scope = ?",
    );
    const row = stmt.get(normalizedScope) as
      | {
          scope: string;
          nodes_json: string;
          edges_json: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      const fallback = defaultDiagramSnapshot();
      return { ...fallback, scope: normalizedScope };
    }

    return {
      scope: row.scope,
      nodes: JSON.parse(row.nodes_json) as Array<Record<string, unknown>>,
      edges: JSON.parse(row.edges_json) as Array<Record<string, unknown>>,
      updatedAt: row.updated_at,
    };
  }

  upsertSnapshot(
    scope: string,
    payload: {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    },
  ): DiagramSnapshotRecord {
    const normalizedScope = this.normalizeScope(scope);
    const updatedAt = new Date().toISOString();
    const stmt = this.sqlite.database.prepare(`
      INSERT INTO diagram_snapshots (scope, nodes_json, edges_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      normalizedScope,
      JSON.stringify(payload.nodes),
      JSON.stringify(payload.edges),
      updatedAt,
    );

    return {
      scope: normalizedScope,
      nodes: payload.nodes,
      edges: payload.edges,
      updatedAt,
    };
  }

  private normalizeScope(scope: string): string {
    const cleaned = scope.trim().toLowerCase();
    return cleaned.length > 0 ? cleaned : "dashboard";
  }
}
