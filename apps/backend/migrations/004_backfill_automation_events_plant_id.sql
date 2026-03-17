UPDATE automation_events
SET plant_id = json_extract(payload_json, '$.plantId')
WHERE plant_id IS NULL
  AND json_extract(payload_json, '$.plantId') IS NOT NULL;
