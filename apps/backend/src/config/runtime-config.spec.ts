import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "./runtime-config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("getRuntimeConfig", () => {
  it("returns defaults when env vars are missing", () => {
    delete process.env.HOST;
    delete process.env.PORT;
    delete process.env.CORS_ORIGINS;
    delete process.env.SQLITE_DB_FILE;
    delete process.env.UPLOADS_DIR;

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("C:/repo/vibe-plant-platform");
    const config = getRuntimeConfig();

    expect(cwdSpy).toHaveBeenCalled();
    expect(config).toEqual({
      host: "0.0.0.0",
      port: 3000,
      corsOrigins: ["http://localhost:5173"],
      sqliteDbFile: resolve("C:/repo/vibe-plant-platform", "data/vibe-plant.sqlite"),
      uploadsDir: resolve("C:/repo/vibe-plant-platform", "data/uploads"),
    });
  });

  it("uses env overrides and parses comma-separated CORS values", () => {
    process.env.HOST = "127.0.0.1";
    process.env.PORT = "4100";
    process.env.CORS_ORIGINS = " https://app.local , ,https://admin.local  ,   ";
    process.env.SQLITE_DB_FILE = "./runtime/db.sqlite";
    process.env.UPLOADS_DIR = "runtime/uploads";

    vi.spyOn(process, "cwd").mockReturnValue("C:/repo/vibe-plant-platform");
    const config = getRuntimeConfig();

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(4100);
    expect(config.corsOrigins).toEqual(["https://app.local", "https://admin.local"]);
    expect(config.sqliteDbFile).toBe(resolve("C:/repo/vibe-plant-platform", "./runtime/db.sqlite"));
    expect(config.uploadsDir).toBe(resolve("C:/repo/vibe-plant-platform", "runtime/uploads"));
  });

  it("falls back to default CORS origin when only empty values are provided", () => {
    process.env.CORS_ORIGINS = "   ,   ,";

    const config = getRuntimeConfig();

    expect(config.corsOrigins).toEqual(["http://localhost:5173"]);
  });

  it("keeps absolute SQLITE_DB_FILE and UPLOADS_DIR values unchanged", () => {
    const absoluteDb = resolve("C:/runtime", "db.sqlite");
    const absoluteUploads = resolve("C:/runtime", "uploads");

    process.env.SQLITE_DB_FILE = absoluteDb;
    process.env.UPLOADS_DIR = absoluteUploads;
    vi.spyOn(process, "cwd").mockReturnValue("C:/repo/vibe-plant-platform");

    const config = getRuntimeConfig();

    expect(config.sqliteDbFile).toBe(absoluteDb);
    expect(config.uploadsDir).toBe(absoluteUploads);
  });
});