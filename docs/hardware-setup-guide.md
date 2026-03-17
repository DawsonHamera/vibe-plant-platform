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
4. Map channels to plant or zone inputs and outputs.
5. Calibrate thresholds and signal normalization.
6. Save profile, run profile validation checks, and resolve any blocking issues.
7. Run simulation test.
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
- `POST /devices/profiles/:id/simulate`
- `POST /devices/profiles/:id/validate`
- `PATCH /devices/profiles/:id/live`
- `POST /automation/evaluate`

## Adapter Structure
- `serial.adapter.ts`: Serial COM discovery and handshake validation.
- `network.adapter.ts`: IP:port discovery and target probe validation.
- `bluetooth.adapter.ts`: Bluetooth device discovery and pairing validation.
- `device-adapter.registry.ts`: Unified dispatch for connection-type routing.
