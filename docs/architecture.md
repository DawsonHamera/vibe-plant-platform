# Vibe Plant Platform Architecture

## Stack
- Frontend: React + TypeScript + Vite in apps/frontend
- Backend: NestJS + TypeScript in apps/backend
- Shared contracts: TypeScript package in packages/shared
- Data: SQLite file (data/vibe-plant.sqlite) using node:sqlite APIs

## Operations Docs
- Production deployment runbook: `docs/deployment-runbook.md`

## Frontend Capabilities Summary
- Plant list, care actions, and daily decision visibility.
- Dynamic editable diagrams panel for adjusting visual automation and layout mappings without leaving the dashboard context.
- Live telemetry cards via WebSocket updates and latest snapshot reads.
- Automation controls including rule toggle/simulate flows, timeline filters, and a runtime status panel fed by `GET /automation/runtime-status`.

## Backend Modules
- plants: Plant CRUD with partial edit support (including schedule values, health state, notes, and last-watered timestamp), watering completion endpoint, and plant image upload endpoint.
- dashboard: Daily care decision projection (due/overdue/alerts).
- telemetry: WebSocket gateway plus simulated periodic telemetry stream.
- devices: No-code connection workflow APIs (discover, test, profile save).
 - devices: No-code connection workflow APIs (discover, test, profile save, profile validation) with live-mode safety gating.
- automation: Rules, dry-run simulation, and event timeline storage.
- diagrams: Scope-based diagram snapshot read/write APIs for persistent visual workflow editing.
- database: SQLite service and schema bootstrap.

## Unified No-Code Automation Model
- Diagrams are now an executable automation authoring surface, not just visual documentation.
- Node types:
	- `trigger`: optional plant scoping (`plantId`) for downstream conditions/actions.
	- `condition`: metric/operator/threshold checks (moisture, light, temperature).
	- `action`: actuator target and safety parameters (runtime seconds, cooldown, daily runtime cap).
- Compilation API: `POST /automation/diagram-scopes/:scope/apply`.
- Runtime path: compiled rules are inserted into the automation rule set and processed by the same runtime evaluator used for manual rules.
- Timeline path: executions from diagram-compiled rules are recorded through existing automation event logging, so timeline and diagram-driven automations stay unified.

## Plant Image Upload and Static Serving
- Upload endpoint: `POST /plants/:id/image` with `multipart/form-data` and file field `image`.
- Behavior: backend accepts JPEG/PNG/WebP/GIF uploads (max 5 MB), stores the file, updates the plant `imageUrl`, and returns the updated plant record.
- Static hosting: uploaded files are served from `/uploads`, so persisted image URLs are web-accessible without extra proxy config.
- Practical client flow: upload via `POST /plants/:id/image`, then render the returned `imageUrl` directly in frontend plant cards/details.

## Diagram Snapshot Persistence
- Read endpoint: `GET /diagrams/:scope` (for example `GET /diagrams/dashboard`).
- Write endpoint: `PUT /diagrams/:scope` with `{ nodes: [...], edges: [...] }` payload.
- Storage: SQLite `diagram_snapshots` table with per-scope JSON blobs and `updated_at` timestamp.
- Frontend behavior: diagrams panel loads from backend on startup, auto-saves edits with a short debounce, and can apply flows directly into active automation rules.

## Migration Pipeline
- SQL migrations are stored in `apps/backend/migrations` and applied in lexical order.
- `schema_migrations` tracks applied files for idempotent startup and deployment runs.
- Manual execution command: `npm run migrate --workspace @vibe/backend`.

## Hardware Adapter Layer
- Device transport is routed through a registry abstraction by connection type.
- Adapters currently included: serial, network, and bluetooth.
- No-code workflows use adapter `discover` and `test` methods, while profile simulation/live mode builds on top of those checks.
- Profile validation endpoint (`POST /devices/profiles/:id/validate`) checks required channel mappings and calibration sanity before live mode can be enabled.

## Data Portability Strategy
- Tables use portable SQL types and JSON text columns where flexibility is required.
- Domain logic uses module services and DTO contracts, isolating storage implementation.
- Migration path to MySQL can preserve service interfaces while replacing SQL adapter and DDL.

## Realtime Strategy
- WebSocket gateway at /ws/telemetry publishes telemetry:update events.
- HTTP read endpoint `GET /telemetry/latest` returns latest values for all plants; when `plantId` is provided, it returns a single latest point or `null` if not found.
- HTTP observability endpoint `GET /telemetry/stats` returns ingest volume, latest cache size, and latest lookup hit/miss counters.
- HTTP ingest endpoint `POST /telemetry/ingest` validates plant existence before recording/publishing and responds with `202 { ok: true }` on accepted payloads.
- Telemetry service emits periodic synthetic points for development and UI verification.
- Telemetry state service maintains latest per-plant sensor values for automation evaluation.
- Telemetry ingest emits periodic structured volume logs every 50 ingests with cache size and lookup hit rate fields.
- Hardware adapters can later feed normalized telemetry into the same publish pathway.

Practical API examples:

```http
GET /telemetry/latest?plantId=2f55e6c3-fdb5-4b66-96dd-7e2d7a6ad6a7
```

```json
{
	"plantId": "2f55e6c3-fdb5-4b66-96dd-7e2d7a6ad6a7",
	"moisture": 48.2,
	"light": 233.7,
	"temperature": 22.5,
	"capturedAt": "2026-03-16T14:21:34.112Z"
}
```

```http
POST /telemetry/ingest
Content-Type: application/json

{
	"plantId": "2f55e6c3-fdb5-4b66-96dd-7e2d7a6ad6a7",
	"moisture": 41.9,
	"light": 190.4,
	"temperature": 21.8,
	"capturedAt": "2026-03-16T14:22:00.000Z"
}
```

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{ "ok": true }
```

## Automation Runtime
- Runtime evaluator executes on interval and supports manual trigger via POST /automation/evaluate.
- Rules evaluate telemetry conditions and apply action payloads with safety checks.
- Safety checks currently enforce cooldown windows and maximum daily runtime per rule-plant pair.
- Timeline endpoint `GET /automation/timeline` accepts optional `ruleId`, `plantId`, `source`, and `limit` (default 50, max 200), returning newest-first events.
- Runtime logging includes blocked reason signals (cooldown, daily runtime exceeded) and end-of-cycle execution summaries.

## Quality Gates
- Typecheck: npm run typecheck
- Lint baseline: npm run lint
- Tests: npm run test
- Build: npm run build
- CI workflow: .github/workflows/ci.yml

## Next Hardening Targets
- Replace synthetic telemetry with protocol adapter feeds.
- Add auth and role-ready identity boundary.
- Expand integration tests for API workflows and SQLite persistence.
- Add observability for automation execution latency and actuator failures.
