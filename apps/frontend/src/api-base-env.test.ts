// @vitest-environment jsdom

import { createElement } from "react";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

const asResponse = (payload: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => payload,
  }) as Response;

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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("App API base env", () => {
  it("strips trailing slash from VITE_API_BASE_URL for request URLs", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "http://api.example.test/");

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/plants")) {
        return asResponse([]);
      }

      if (url.includes("/dashboard/daily")) {
        return asResponse({
          date: "2026-03-16",
          duePlantIds: [],
          overduePlantIds: [],
          alerts: [],
        });
      }

      if (url.includes("/devices/discover") || url.includes("/devices/profiles")) {
        return asResponse([]);
      }

      if (url.includes("/automation/rules") || url.includes("/automation/timeline")) {
        return asResponse([]);
      }

      if (url.includes("/automation/runtime-status")) {
        return asResponse({
          lastRunAt: null,
          lastExecutionCount: 0,
          totalExecutions: 0,
          blockedCooldownCount: 0,
          blockedDailyLimitCount: 0,
        });
      }

      if (url.includes("/automation/runtime-history")) {
        return asResponse([]);
      }

      if (url.includes("/health/details")) {
        return asResponse({
          runtime: {
            mode: "normal",
            source: "test",
            schedulerTickMs: 5000,
            staleTelemetryThresholdMs: 120000,
            defaultPlantId: "plant-1",
          },
          backend: {
            status: "ok",
            timestamp: "2026-03-16T00:00:00.000Z",
          },
          checks: [],
        });
      }

      if (url.includes("/telemetry/stats")) {
        return asResponse({
          ingestCount: 0,
          cachedPlantCount: 0,
          latestLookup: {
            hits: 0,
            misses: 0,
            hitRate: null,
          },
        });
      }

      if (url.includes("/telemetry/latest")) {
        return asResponse([]);
      }

      return asResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const { App } = await import("./App");

    await act(async () => {
      root.render(createElement(App));
    });

    expect(fetchMock.mock.calls.some((call) => String(call[0]) === "http://api.example.test/plants")).toBe(
      true,
    );
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("api.example.test//")),
    ).toBe(false);
  });
});