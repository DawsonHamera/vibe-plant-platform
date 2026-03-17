ALTER TABLE automation_events ADD COLUMN plant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_plant_id ON automation_events(plant_id);
CREATE INDEX IF NOT EXISTS idx_events_plant_created_at ON automation_events(plant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_source_rule_created_at ON automation_events(source, rule_id, created_at DESC);
