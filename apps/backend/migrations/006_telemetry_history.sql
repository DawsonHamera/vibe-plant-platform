CREATE TABLE IF NOT EXISTS telemetry_history (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL,
  moisture REAL,
  light REAL,
  temperature REAL,
  humidity REAL,
  reservoir_level REAL,
  captured_at TEXT NOT NULL,
  source_profile_id TEXT,
  source_profile_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_history_captured_at ON telemetry_history (captured_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_history_plant_captured_at ON telemetry_history (plant_id, captured_at);
