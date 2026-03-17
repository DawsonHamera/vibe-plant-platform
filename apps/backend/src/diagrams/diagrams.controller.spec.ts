import { describe, expect, it, vi } from "vitest";
import { DiagramsController } from "./diagrams.controller";

describe("DiagramsController", () => {
  it("delegates getSnapshot to service", () => {
    const expected = {
      scope: "dashboard",
      nodes: [{ id: "a" }],
      edges: [{ id: "b" }],
      updatedAt: new Date().toISOString(),
    };
    const diagramsService = {
      getSnapshot: vi.fn(() => expected),
      upsertSnapshot: vi.fn(),
    };
    const controller = new DiagramsController(diagramsService as never);

    const result = controller.getSnapshot({ scope: "dashboard" });

    expect(diagramsService.getSnapshot).toHaveBeenCalledWith("dashboard");
    expect(result).toEqual(expected);
  });

  it("delegates upsertSnapshot to service", () => {
    const payload = {
      nodes: [{ id: "n1" }],
      edges: [{ id: "e1" }],
    };
    const expected = {
      scope: "dashboard",
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    const diagramsService = {
      getSnapshot: vi.fn(),
      upsertSnapshot: vi.fn(() => expected),
    };
    const controller = new DiagramsController(diagramsService as never);

    const result = controller.upsertSnapshot({ scope: "dashboard" }, payload);

    expect(diagramsService.upsertSnapshot).toHaveBeenCalledWith("dashboard", payload);
    expect(result).toEqual(expected);
  });
});
