type ScriptConfig = {
  backendUrl: string;
  plantIds: string[];
  durationMs: number;
  intervalMs: number;
  mode: MockMode;
};

type MockMode = "normal" | "dry-stress" | "heat-spike";

function parseConfig(): ScriptConfig {
  const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const rawPlantIds = process.env.PLANT_IDS ?? "";
  const mode = (process.env.MOCK_MODE ?? "normal") as MockMode;
  const plantIds = rawPlantIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const durationMs = Number(process.env.DURATION_MS ?? 30_000);
  const intervalMs = Number(process.env.INTERVAL_MS ?? 400);

  if (plantIds.length === 0) {
    throw new Error("PLANT_IDS is required. Example: PLANT_IDS=id-1,id-2");
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("DURATION_MS must be a positive number");
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("INTERVAL_MS must be a positive number");
  }

  if (mode !== "normal" && mode !== "dry-stress" && mode !== "heat-spike") {
    throw new Error("MOCK_MODE must be one of: normal, dry-stress, heat-spike");
  }

  return {
    backendUrl,
    plantIds,
    durationMs,
    intervalMs,
    mode,
  };
}

function randomInRange(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function buildPayload(plantId: string, mode: MockMode) {
  if (mode === "dry-stress") {
    return {
      plantId,
      moisture: randomInRange(4, 35),
      light: randomInRange(110, 760),
      temperature: randomInRange(18, 35),
      capturedAt: new Date().toISOString(),
    };
  }

  if (mode === "heat-spike") {
    const hasSpike = Math.random() < 0.15;
    return {
      plantId,
      moisture: randomInRange(12, 80),
      light: randomInRange(90, 730),
      temperature: hasSpike ? randomInRange(37, 44) : randomInRange(24, 38),
      capturedAt: new Date().toISOString(),
    };
  }

  return {
    plantId,
    moisture: randomInRange(10, 90),
    light: randomInRange(80, 700),
    temperature: randomInRange(14, 34),
    capturedAt: new Date().toISOString(),
  };
}

async function postTelemetry(backendUrl: string, plantId: string, mode: MockMode): Promise<boolean> {
  const response = await fetch(`${backendUrl}/telemetry/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(buildPayload(plantId, mode)),
  });

  return response.ok;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function run(): Promise<void> {
  const config = parseConfig();
  const startedAt = Date.now();
  const stopAt = startedAt + config.durationMs;

  let sent = 0;
  let failed = 0;

  console.log("Starting mock telemetry feed", {
    backendUrl: config.backendUrl,
    plantIds: config.plantIds,
    durationMs: config.durationMs,
    intervalMs: config.intervalMs,
    mode: config.mode,
  });

  while (Date.now() < stopAt) {
    const requests = config.plantIds.map(async (plantId) => {
      try {
        const ok = await postTelemetry(config.backendUrl, plantId, config.mode);
        if (ok) {
          sent += 1;
        } else {
          failed += 1;
          console.warn(`Ingest failed for plant ${plantId}`);
        }
      } catch (error) {
        failed += 1;
        console.warn(`Request error for plant ${plantId}`, error);
      }
    });

    await Promise.all(requests);
    await delay(config.intervalMs);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log("Mock telemetry feed complete", {
    elapsedMs,
    sent,
    failed,
  });
}

run().catch((error) => {
  console.error("Mock telemetry feed failed to start", error);
  process.exitCode = 1;
});
