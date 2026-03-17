CREATE INDEX IF NOT EXISTS idx_plants_zone ON plants(zone);
CREATE INDEX IF NOT EXISTS idx_plants_health ON plants(health_state);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON automation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_profiles_type ON device_profiles(connection_type);
