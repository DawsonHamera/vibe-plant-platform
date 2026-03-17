import { describe, expect, it, vi } from "vitest";
import { DiagramsService } from "./diagrams.service";

describe("DiagramsService", () => {
  it("returns default snapshot when scope has no saved record", () => {
    const get = vi.fn(() => undefined);
    const prepare = vi.fn(() => ({ get }));
    const sqlite = { database: { prepare } };
    const service = new DiagramsService(sqlite as never);

    const snapshot = service.getSnapshot("dashboard");

    expect(snapshot.scope).toBe("dashboard");
    expect(snapshot.nodes.length).toBeGreaterThan(0);
    expect(snapshot.edges.length).toBeGreaterThan(0);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("stores and returns updated snapshot payload", () => {
    const run = vi.fn();
    const prepare = vi.fn(() => ({ run }));
    const sqlite = { database: { prepare } };
    const service = new DiagramsService(sqlite as never);
    const payload = {
      nodes: [{ id: "node-1", data: { label: "A" }, position: { x: 10, y: 20 } }],
      edges: [{ id: "edge-1", source: "node-1", target: "node-2" }],
    };

    const saved = service.upsertSnapshot(" Dashboard ", payload);

    expect(saved.scope).toBe("dashboard");
    expect(saved.nodes).toEqual(payload.nodes);
    expect(saved.edges).toEqual(payload.edges);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
