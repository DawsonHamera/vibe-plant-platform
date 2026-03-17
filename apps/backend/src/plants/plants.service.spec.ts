import { mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlantsService } from "./plants.service";

describe("PlantsService remove image cleanup", () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const path of cleanupPaths) {
      rmSync(path, { recursive: true, force: true });
    }
    cleanupPaths.length = 0;
  });

  it("removes uploaded image file when deleting plant", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "plants-service-"));
    cleanupPaths.push(tempRoot);
    const uploadDir = join(tempRoot, "data", "uploads");
    const imageFilename = "cleanup-target.png";
    const imagePath = join(uploadDir, imageFilename);

    rmSync(uploadDir, { recursive: true, force: true });
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(imagePath, "image", { encoding: "utf8", flag: "w" });

    const plantRow = {
      id: "plant-1",
      nickname: "Pothos",
      species: "Pothos",
      zone: "Desk",
      growth_stage: "vegetative",
      notes: null,
      image_url: `/uploads/${imageFilename}`,
      health_state: "good",
      watering_every_days: 3,
      fertilizing_every_days: null,
      pruning_every_days: null,
      last_watered_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const sqlite = {
      database: {
        prepare: (sql: string) => {
          if (sql === "SELECT * FROM plants WHERE id = ?") {
            return { get: () => plantRow };
          }

          if (sql === "DELETE FROM plants WHERE id = ?") {
            return { run: () => undefined };
          }

          throw new Error(`Unexpected SQL in test: ${sql}`);
        },
      },
    };

    const cwd = process.cwd();
    process.chdir(tempRoot);
    try {
      const service = new PlantsService(sqlite as never);
      service.remove("plant-1");
    } finally {
      process.chdir(cwd);
    }

    expect(existsSync(imagePath)).toBe(false);
  });

  it("updates editable plant fields and merges partial schedule payload", () => {
    const now = new Date().toISOString();
    const plantRow = {
      id: "plant-1",
      nickname: "Pothos",
      species: "Epipremnum",
      zone: "Desk",
      growth_stage: "vegetative",
      notes: "old notes",
      image_url: "/uploads/old.png",
      health_state: "good",
      watering_every_days: 3,
      fertilizing_every_days: 30,
      pruning_every_days: null,
      last_watered_at: null,
      created_at: now,
      updated_at: now,
    };

    let updateArgs: unknown[] = [];
    const sqlite = {
      database: {
        prepare: (sql: string) => {
          if (sql === "SELECT * FROM plants WHERE id = ?") {
            return { get: () => plantRow };
          }

          if (sql.includes("UPDATE plants SET")) {
            return {
              run: (...args: unknown[]) => {
                updateArgs = args;
                return undefined;
              },
            };
          }

          throw new Error(`Unexpected SQL in test: ${sql}`);
        },
      },
    };

    const service = new PlantsService(sqlite as never);
    const updated = service.update("plant-1", {
      nickname: "Desk Ivy",
      species: "Epipremnum aureum",
      zone: "Window",
      notes: "watch leaf curl",
      imageUrl: "https://example.com/new.png",
      healthState: "watch",
      schedule: {
        fertilizingEveryDays: 14,
      },
    });

    expect(updated.nickname).toBe("Desk Ivy");
    expect(updated.species).toBe("Epipremnum aureum");
    expect(updated.zone).toBe("Window");
    expect(updated.notes).toBe("watch leaf curl");
    expect(updated.imageUrl).toBe("https://example.com/new.png");
    expect(updated.healthState).toBe("watch");
    expect(updated.schedule).toEqual({
      wateringEveryDays: 3,
      fertilizingEveryDays: 14,
      pruningEveryDays: undefined,
    });

    expect(updateArgs[0]).toBe("Desk Ivy");
    expect(updateArgs[1]).toBe("Epipremnum aureum");
    expect(updateArgs[2]).toBe("Window");
    expect(updateArgs[4]).toBe("watch leaf curl");
    expect(updateArgs[5]).toBe("https://example.com/new.png");
    expect(updateArgs[6]).toBe("watch");
    expect(updateArgs[7]).toBe(3);
    expect(updateArgs[8]).toBe(14);
    expect(updateArgs[9]).toBeNull();
    expect(updateArgs[11]).toBeTypeOf("string");
    expect(updateArgs[12]).toBe("plant-1");
  });
});
