# Deployment Runbook (Production)

This runbook is for operators deploying Vibe Plant Platform with Docker Compose in production-like environments.

## 1) Prerequisites
- Docker Engine and Docker Compose plugin installed (`docker compose version`).
- Host has open ports for:
  - Backend API: `PORT` (default `3000`)
  - Frontend: `FRONTEND_PORT` (default `8080`)
- Repository checked out on the deploy host.
- Disk space for:
  - Docker images
  - SQLite database file
  - Uploaded plant images

## 2) Environment Variables and `.env`
1. Copy environment template:
   ```bash
   cp .env.example .env
   ```
   On Windows PowerShell:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Edit `.env` with production values.

Minimum variables used by `docker-compose.prod.yml`:
- `HOST` (default `0.0.0.0`)
- `PORT` (default `3000`)
- `CORS_ORIGINS` (comma-separated; include your frontend URL)
- `SQLITE_DB_FILE` (default `data/vibe-plant.sqlite`)
- `UPLOADS_DIR` (default `data/uploads`)
- `VITE_API_BASE_URL` (frontend build-time API URL, e.g. `https://api.example.com`)
- `FRONTEND_PORT` (default `8080`)

Notes:
- Frontend API base URL is baked in at image build time. If `VITE_API_BASE_URL` changes, rebuild frontend image.
- `CORS_ORIGINS` applies to REST and WebSocket connections.

## 3) Build/Test Gates Before Deploy
Run these from repository root and require green results before deploying:
```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Recommended release gate:
- Confirm working tree is clean or intentional.
- Tag the release commit.
- Keep previous image layers available until post-deploy verification passes.

## 4) Production Deploy Commands (Docker Compose)
From repository root:

Start/update:
```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

Stop services:
```bash
docker compose --env-file .env -f docker-compose.prod.yml down
```

Tail logs:
```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f
```

Service-specific logs:
```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f backend frontend
```

Status:
```bash
docker compose --env-file .env -f docker-compose.prod.yml ps
```

Runtime behavior defaults:
- Services use `restart: unless-stopped`.
- Compose healthchecks probe backend `/health` and frontend `/` for container health state.

## 5) Health Verification and Smoke Checks
Replace host/ports if different.

Backend health:
```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/health/details
```
Expected: HTTP `200` with JSON payloads.

Frontend reachable:
```bash
curl -I http://localhost:8080
```
Expected: HTTP `200`.

Core API smoke checks:
```bash
curl -fsS http://localhost:3000/plants
curl -fsS http://localhost:3000/telemetry/stats
curl -fsS http://localhost:3000/automation/runtime-status
```

Optional ingest smoke check:
```bash
curl -X POST http://localhost:3000/telemetry/ingest \
  -H "Content-Type: application/json" \
  -d '{"plantId":"<existing-plant-id>","moisture":45,"light":210,"temperature":22.1,"capturedAt":"2026-03-16T14:22:00.000Z"}'
```

WebSocket quick check:
- Confirm frontend loads live telemetry updates.
- WebSocket endpoint path must be `/ws/telemetry`.

## 6) Rollback
Use this when a deployment is unhealthy after verification.

1. Stop current stack:
   ```bash
   docker compose --env-file .env -f docker-compose.prod.yml down
   ```
2. Restore previous `.env` (if changed) and previous release revision.
3. Re-deploy previous known-good release:
   ```bash
   docker compose --env-file .env -f docker-compose.prod.yml up -d --build
   ```
4. Re-run health + smoke checks.

Fast rollback option:
- Keep a copy of the last known-good release directory (or git tag).
- Switch to that revision and redeploy with the same commands.

## 7) Backup and Restore (SQLite + Uploads)
Data lives in named Docker volume `vibe_backend_data` mounted to `/app/apps/backend/data`.

### Backup
Create backup directory on host:
```bash
mkdir -p backups
```

Archive volume contents:
```bash
docker run --rm \
  -v vibe_backend_data:/data \
  -v "$(pwd)/backups:/backup" \
  alpine sh -c "tar czf /backup/vibe-backend-data-$(date +%F-%H%M%S).tgz -C /data ."
```

What this captures:
- SQLite DB files (including WAL/SHM if present)
- Uploads directory contents

### Restore
1. Stop stack:
   ```bash
   docker compose --env-file .env -f docker-compose.prod.yml down
   ```
2. Restore archive into volume (replace file name):
   ```bash
   docker run --rm \
     -v vibe_backend_data:/data \
     -v "$(pwd)/backups:/backup" \
     alpine sh -c "rm -rf /data/* && tar xzf /backup/<backup-file>.tgz -C /data"
   ```
3. Start stack:
   ```bash
   docker compose --env-file .env -f docker-compose.prod.yml up -d --build
   ```
4. Verify health and key records.

## 8) Troubleshooting Notes
### CORS errors in browser
- Symptom: frontend requests blocked by CORS.
- Fix:
  - Ensure `CORS_ORIGINS` includes the exact frontend origin (scheme + host + port).
  - Recreate backend container after `.env` changes.

### Stale backend process / missing newer endpoints
- Symptom: endpoint like image upload or new route returns 404 after update.
- Fix:
  - Rebuild and restart backend (`up -d --build`).
  - Check backend logs for startup version and route registration.

### WebSocket not connecting
- Symptom: no live telemetry updates.
- Fix:
  - Confirm frontend uses correct API base URL (`VITE_API_BASE_URL`).
  - Confirm WebSocket path is `/ws/telemetry`.
  - Ensure reverse proxy/load balancer forwards WebSocket upgrades.
  - Ensure `CORS_ORIGINS` includes frontend origin.
