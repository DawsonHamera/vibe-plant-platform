CREATE TABLE IF NOT EXISTS diagram_snapshots (
  scope TEXT PRIMARY KEY,
  nodes_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
