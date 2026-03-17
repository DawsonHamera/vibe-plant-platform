CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  species TEXT NOT NULL,
  zone TEXT NOT NULL,
  growth_stage TEXT NOT NULL,
  notes TEXT,
  image_url TEXT,
  health_state TEXT NOT NULL,
  watering_every_days INTEGER NOT NULL,
  fertilizing_every_days INTEGER,
  pruning_every_days INTEGER,
  last_watered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  connection_type TEXT NOT NULL,
  transport_target TEXT NOT NULL,
  channel_map TEXT NOT NULL,
  calibration TEXT NOT NULL,
  is_live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  condition_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  safety_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
