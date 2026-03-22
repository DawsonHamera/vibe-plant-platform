# Hardware Setup Guide

## Scope
This guide explains the expected hardware connection models the software supports. Physical wiring and board-level setup are handled by the operator.

## Supported Device Models
- Arduino connected to host machine through serial COM.
- Raspberry Pi running on local network and exposing sensor or control endpoints.
- Optional Bluetooth-capable sensor or control devices.

## In-App Connection Flow Targets
1. Select connection type: Serial, Network, or Bluetooth.
2. Discover available devices.
3. Run connectivity test.
4. Map one hardware profile to one or more plants in-app.
5. Map incoming channel labels to optional measurements (moisture/light/temperature).
6. Optionally configure moisture calibration.
7. Save profile, run profile validation checks, and resolve blocking issues.
8. Enable live automation mode.

## Sensor Types
- Soil moisture
- Ambient light
- Temperature
- Optional humidity and reservoir level

## Actuator Types
- Water pump
- Misting solenoid
- Lighting relay
- Fan relay

## Hardware Telemetry Contract
All hardware transports (Serial COM, Network, Bluetooth) should produce the same raw channel payload.

Backend ingest endpoint (profile-based routing):
- `POST /devices/profiles/:id/ingest`

Required payload fields:
- `channels` (object of channel label to numeric reading)

Optional payload fields:
- `capturedAt` (ISO-8601 timestamp). If omitted, backend sets server timestamp.

Canonical JSON payload:
```json
{
	"channels": {
		"ch0": 582,
		"ch1": 315.4,
		"ch2": 24.1,
		"battery": 3.92
	},
	"capturedAt": "2026-03-21T16:30:10.123Z"
}
```

Validation behavior:
- Rejects missing `channels` object.
- Accepts any channel keys.
- Accepts any combination of mapped measurements.
- Device payload should not include plant ID mapping.

## Transport Framing By Connection Type
Use these as integration conventions in your firmware bridge or edge collector.

Serial (COM):
- One JSON object per line (NDJSON), UTF-8.
- Line terminator: `\n`.
- Example frame:
```text
{"channels":{"ch0":582,"ch1":315.4,"ch2":24.1},"capturedAt":"2026-03-21T16:30:10.123Z"}
```

Bluetooth:
- Same JSON object payload.
- If using BLE characteristics, send complete JSON per update (or chunk/reassemble before forwarding).
- Include `capturedAt` if device clock is stable; otherwise omit and let backend timestamp.

Network:
- Preferred: HTTP POST with `content-type: application/json` to `/devices/profiles/:id/ingest`.
- Alternative: TCP bridge that converts received JSON frames into ingest POSTs.

## Device Profile Mapping Schema
In-app profiles store how raw channels map into normalized telemetry fields.

Required profile shape (create/update):
```json
{
	"name": "Zone 1 Arduino",
	"connectionType": "serial",
	"transportTarget": "COM3",
	"plantIds": [
		"8d8b5b7f-2044-42cf-b6d9-0e626f5cf5bd"
	],
	"channelMap": {
		"moisture": "ch0",
		"light": "ch1",
		"temperature": "ch2"
	},
	"calibration": {
		"moistureDry": 900,
		"moistureWet": 300
	},
	"isLive": false
}
```

Minimal profile shape is valid (all measurements optional):
```json
{
	"name": "Battery + Temp Probe",
	"connectionType": "network",
	"transportTarget": "192.168.1.40:4000",
	"plantIds": ["8d8b5b7f-2044-42cf-b6d9-0e626f5cf5bd"],
	"channelMap": {
		"temperature": "temp"
	},
	"isLive": false
}
```

Profile validation rules:
- At least one `plantIds` mapping is required before enabling live mode.
- `channelMap.moisture`, `channelMap.light`, and `channelMap.temperature` are optional.
- Reusing the same channel for multiple metrics is allowed but flagged as a warning.
- Moisture calibration is optional.
- If both `moistureDry` and `moistureWet` are provided: dry must be greater than wet.
- A dry-wet gap less than 100 is allowed but flagged as a warning.

Target format rules used by connection testing:
- Serial target format: `COM<number>` (example: `COM3`).
- Network target format: `<ipv4>:<port>` (example: `192.168.1.25:4000`).
- Bluetooth target format: `BT-<name>-<number>` (example: `BT-SOIL-01`).

## Safety Recommendations
- Define max run times per actuator.
- Require cooldown windows between runs.
- Use manual emergency stop from dashboard.
- Record all automation actions in an event log.

## Mock Telemetry Feed (No Hardware)
Use the backend mock feed script to generate telemetry when physical devices are not connected.

Environment variables:
- BACKEND_URL: Base URL for the backend API (default: http://localhost:3000).
- PLANT_IDS: Comma-separated plant IDs to send telemetry for (required).
- DURATION_MS: Total run time in milliseconds (default: 30000).
- INTERVAL_MS: Delay between send cycles in milliseconds (default: 400).
- MOCK_MODE: Telemetry profile preset (default: normal). Options: normal, dry-stress, heat-spike.

Example command (bash):
PLANT_IDS=plant-1,plant-2 BACKEND_URL=http://localhost:3000 DURATION_MS=20000 INTERVAL_MS=500 npm run mock:telemetry --workspace @vibe/backend

Mode example (bash):
PLANT_IDS=plant-1 MOCK_MODE=dry-stress npm run mock:telemetry --workspace @vibe/backend

## Integration Notes For Developers
- Keep protocol adapters isolated from domain logic.
- Normalize telemetry schema before storage and rule evaluation.
- Ensure simulator mode can feed synthetic sensor values.
- Preserve traceability for each automation decision.

## Implemented API Endpoints
- `GET /devices/discover`
- `GET /devices/test?connectionType=...&target=...`
- `GET /devices/profiles`
- `POST /devices/profiles`
- `DELETE /devices/profiles`
- `DELETE /devices/profiles/:id`
- `POST /devices/profiles/:id/simulate`
- `POST /devices/profiles/:id/validate`
- `POST /devices/profiles/:id/ingest`
- `PATCH /devices/profiles/:id/live`
- `POST /telemetry/ingest`
- `POST /automation/evaluate`

## Adapter Structure
- `serial.adapter.ts`: Serial COM discovery and handshake validation.
- `network.adapter.ts`: IP:port discovery and target probe validation.
- `bluetooth.adapter.ts`: Bluetooth device discovery and pairing validation.
- `device-adapter.registry.ts`: Unified dispatch for connection-type routing.
