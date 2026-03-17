# Vibe Plant Platform

Monorepo foundation for a production-ready plant management and automation platform.

## Workspace
- `apps/frontend`: React + TypeScript application.
- `apps/backend`: NestJS API and realtime gateway.
- `packages/shared`: Shared types and contracts.

## Deployment
- Production deployment and operator procedures: `docs/deployment-runbook.md`

## Implemented API Surface
- `GET /health`
- `GET /health/details`
- `GET|POST /plants`
- `GET|PATCH|DELETE /plants/:id`
- `POST /plants/:id/water`
- `POST /plants/:id/image` (multipart upload)
- `GET /dashboard/daily`
- `POST /telemetry/ingest`
- `GET /telemetry/latest?plantId=:id` (optional query)
- `GET /telemetry/stats`
- `GET /devices/discover`
- `GET /devices/test?connectionType=serial|network|bluetooth&target=...`
- `GET|POST /devices/profiles`
- `POST /devices/profiles/:id/simulate`
- `POST /devices/profiles/:id/validate`
- `PATCH /devices/profiles/:id/live`
- `GET|POST /automation/rules`
- `POST /automation/rules/:id/simulate`
- `POST /automation/evaluate`
- `GET /automation/timeline`
- `GET /automation/runtime-status`
- `POST /automation/diagram-scopes/:scope/apply`
- `GET /automation/diagram-scopes/:scope/preview`
- `GET /diagrams/:scope`
- `PUT /diagrams/:scope`
- Static file serving for uploaded images at `/uploads/*`

API notes:
- `PATCH /plants/:id` supports partial plant edits for `nickname`, `species`, `zone`, `growthStage`, `notes`, `imageUrl`, `healthState`, and `lastWateredAt`; schedule edits are sent via `schedule` (`wateringEveryDays`, optional `fertilizingEveryDays`, optional `pruningEveryDays`) and persisted onto existing schedule values.
- `POST /telemetry/ingest` validates that `plantId` exists and returns `202` with `{ "ok": true }` when accepted.
- `GET /telemetry/latest` returns latest telemetry for all plants; with `plantId`, it returns that plant's latest point or `null` if none exists.
- `GET /telemetry/stats` returns ingest volume, latest telemetry cache size, and latest lookup hit/miss metrics.
- `POST /devices/profiles/:id/validate` runs no-code onboarding checks for required channel mappings and moisture calibration sanity.
- `GET /automation/timeline` supports optional filters `ruleId`, `plantId`, and `source`, plus `limit` (default `50`, max `200`), ordered newest-first.
- `GET /automation/runtime-status` returns current runtime health/loop metadata for the automation status panel.
- `POST /automation/diagram-scopes/:scope/apply` compiles diagram nodes/edges into executable automation rules used by runtime and timeline.
- `GET /automation/diagram-scopes/:scope/preview` compiles and validates a diagram without mutating active rules, returning potential warnings/errors.
- `GET /health/details` returns service uptime and database entity counts for operational monitoring.
- `POST /plants/:id/image` accepts `multipart/form-data` using file field `image`, supports JPEG/PNG/WebP/GIF up to 5 MB, stores the image, and returns the updated plant record with `imageUrl`.
- Uploaded plant images are available under `/uploads`, so `imageUrl` can be rendered directly by the frontend.
- `GET /diagrams/:scope` returns the persisted diagram snapshot for that scope (for example `dashboard`).
- `PUT /diagrams/:scope` persists diagram `nodes` and `edges` JSON for cross-session dashboard sync.
- Automation runtime logs include blocked reasons (cooldown window, daily runtime budget exceeded) and per-cycle execution summaries.

Plant image upload example:

```http
POST /plants/2f55e6c3-fdb5-4b66-96dd-7e2d7a6ad6a7/image
Content-Type: multipart/form-data

image=<binary file>
```

```json
{
   "id": "2f55e6c3-fdb5-4b66-96dd-7e2d7a6ad6a7",
   "nickname": "Monstera",
   "imageUrl": "/uploads/2f55e6c3-fdb5-4b66-96dd-7e2d7a6ad6a7-1710601200000.jpg"
}
```

## Dynamic Editable Diagrams Panel
- The dashboard includes a dynamic editable diagrams panel for visual planning and quick iterative edits.
- Operators can adjust diagram content in place while reviewing plants, devices, and automation context.
- The panel is intended for no-code workflow updates and faster operator handoff during troubleshooting.
- Diagram snapshots are now synced through backend APIs so edits persist across browser refreshes and machines.
- Diagram nodes are now executable flow nodes (`trigger`, `condition`, `action`) rather than documentation-only blocks.
- Applying a diagram flow generates automation rules, and those rules feed the same runtime evaluator and timeline stream.

Runtime status example:

```http
GET /automation/runtime-status
```

```json
{
   "running": true,
   "lastEvaluationAt": "2026-03-16T14:30:00.000Z",
   "lastCycleExecutions": 2,
   "activeRules": 5
}
```

Telemetry examples:

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

Telemetry stats example:

```http
GET /telemetry/stats
```

```json
{
   "ingestCount": 128,
   "cachedPlantCount": 4,
   "latestLookup": {
      "hits": 42,
      "misses": 6,
      "hitRate": 0.875
   }
}
```

Realtime:
- WebSocket endpoint path: `/ws/telemetry`
- Event: `telemetry:update`

## Quick start
1. Install dependencies:
   - `npm install`
2. Run backend:
   - `npm run dev:backend`
3. Run frontend:
   - `npm run dev:frontend`
4. Run backend migrations manually (optional; startup also applies migrations):
   - `npm run migrate --workspace @vibe/backend`

## Quality commands
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

## Troubleshooting
- If image upload returns `Cannot POST /plants/:id/image`, the backend process is likely running an older `dist` build.
- Restart backend after rebuilding (`npm run build` then `npm run start --workspace @vibe/backend`) or run watch mode (`npm run dev:backend`) during development.

## CI
- GitHub Actions workflow at `.github/workflows/ci.yml` runs install, typecheck, lint, test, and build on pushes and pull requests.
