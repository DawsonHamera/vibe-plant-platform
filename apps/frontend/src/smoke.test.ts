// @vitest-environment jsdom

import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

const asResponse = (ok: boolean, status: number, payload: unknown): Response =>
  ({
    ok,
    status,
    json: async () => payload,
  }) as Response;

const mockAppFetch = (plantsPayload: unknown[] = []): void => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("/plants")) {
      return asResponse(true, 200, plantsPayload);
    }

    if (url.includes("/dashboard/daily")) {
      return asResponse(true, 200, {
        date: "2026-03-16",
        duePlantIds: [],
        overduePlantIds: [],
        alerts: [],
      });
    }

    if (url.includes("/devices/discover")) {
      return asResponse(true, 200, []);
    }

    if (url.includes("/devices/profiles")) {
      return asResponse(true, 200, []);
    }

    if (url.includes("/automation/rules")) {
      return asResponse(true, 200, []);
    }

    if (url.includes("/telemetry/latest")) {
      return asResponse(true, 200, []);
    }

    if (url.includes("/telemetry/stats")) {
      return asResponse(true, 200, {
        ingestCount: 0,
        cachedPlantCount: 0,
        latestLookup: {
          hits: 0,
          misses: 0,
          hitRate: null,
        },
      });
    }

    if (url.includes("/automation/timeline") && url.includes("ruleId=bad")) {
      return asResponse(false, 500, {});
    }

    if (url.includes("/automation/timeline")) {
      return asResponse(true, 200, []);
    }

    return asResponse(true, 200, {});
  });

  vi.stubGlobal("fetch", fetchMock);
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("automation timeline ui", () => {
  it("renders filter form inputs and allows value updates", async () => {
    mockAppFetch();
    await act(async () => {
      root.render(createElement(App));
    });

    const automationTabButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Timeline + Rules",
    ) as HTMLButtonElement;

    await act(async () => {
      automationTabButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const ruleInput = container.querySelector('input[placeholder="ruleId (optional)"]') as HTMLInputElement;
    const plantInput = container.querySelector('input[placeholder="plantId (optional)"]') as HTMLInputElement;
    const sourceInput = container.querySelector('input[placeholder="source (optional)"]') as HTMLInputElement;
    const limitInput = container.querySelector('input[placeholder="limit"]') as HTMLInputElement;

    await act(async () => {
      ruleInput.value = "rule-1";
      ruleInput.dispatchEvent(new Event("input", { bubbles: true }));
      plantInput.value = "plant-9";
      plantInput.dispatchEvent(new Event("input", { bubbles: true }));
      sourceInput.value = "scheduler";
      sourceInput.dispatchEvent(new Event("input", { bubbles: true }));
      limitInput.value = "25";
      limitInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect((ruleInput as HTMLInputElement).value).toBe("rule-1");
    expect((plantInput as HTMLInputElement).value).toBe("plant-9");
    expect((sourceInput as HTMLInputElement).value).toBe("scheduler");
    expect((limitInput as HTMLInputElement).value).toBe("25");
  });

  it("renders hero plants and advanced summaries", async () => {
    mockAppFetch([
      {
        id: "plant-hero-1",
        nickname: "Monstera",
        species: "Monstera deliciosa",
        zone: "Living Room",
        growthStage: "vegetative",
        healthState: "good",
        schedule: {
          wateringEveryDays: 3,
        },
      },
    ]);

    await act(async () => {
      root.render(createElement(App));
    });

    expect(container.textContent).toContain("Plant Focus");
    expect(container.textContent).toContain("Advanced platform health");

    const plantsTabButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Plants",
    ) as HTMLButtonElement;

    await act(async () => {
      plantsTabButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Advanced plant settings");
  });
});
