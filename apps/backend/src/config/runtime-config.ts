import { isAbsolute, resolve } from "node:path";

const defaultCorsOrigin = "http://localhost:5173";

const getStringEnv = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
};

const getNumberEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseCorsOrigins = (): string[] => {
  const raw = getStringEnv("CORS_ORIGINS", defaultCorsOrigin);
  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : [defaultCorsOrigin];
};

const resolveRuntimePath = (value: string): string => {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
};

export type RuntimeConfig = {
  host: string;
  port: number;
  corsOrigins: string[];
  sqliteDbFile: string;
  uploadsDir: string;
};

export const getRuntimeConfig = (): RuntimeConfig => {
  const sqliteDbFile = resolveRuntimePath(getStringEnv("SQLITE_DB_FILE", "data/vibe-plant.sqlite"));
  const uploadsDir = resolveRuntimePath(getStringEnv("UPLOADS_DIR", "data/uploads"));

  return {
    host: getStringEnv("HOST", "0.0.0.0"),
    port: getNumberEnv("PORT", 3000),
    corsOrigins: parseCorsOrigins(),
    sqliteDbFile,
    uploadsDir,
  };
};