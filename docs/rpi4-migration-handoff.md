# Raspberry Pi 4 Migration Handoff

Date: 2026-03-21

This document captures the simplified migration plan to move Vibe Plant Platform to a Raspberry Pi 4 for 24/7 operation with Cloudflare Tunnel.

## Goal
Run the app on Raspberry Pi with acceptable downtime and minimal operational overhead.

## Runtime Model
- Backend runs on Pi host: port 43000
- Frontend runs in Docker on Pi: port 48080
- Cloudflare Tunnel routes public hostname to frontend (`http://localhost:48080`)

## What Was Prepared In Repo
- Pi environment template: `.env.rpi.example`
- Quickstart guide: `docs/rpi4-cloudflare-quickstart.md`
- Pi helper scripts:
  - `scripts/pi/deploy.sh`
  - `scripts/pi/health-check.sh`
  - `scripts/pi/backup-data.sh`
  - `scripts/pi/restore-data.sh`
- NPM shortcuts:
  - `npm run pi:deploy`
  - `npm run pi:health`
  - `npm run pi:backup`
  - `npm run pi:restore`

## Simplified Migration Steps
1. Push this repository state to git.
2. On Pi, install Docker + Node.js 22 + git.
3. Clone repo to `/opt/vibe-plant-platform`.
4. Copy `.env.rpi.example` to `.env` and set real values.
5. Run deploy helper: `npm run pi:deploy`.
6. Start backend host process: `npm run prod:backend:run-host`.
7. Verify: `npm run pi:health`.
8. Configure Cloudflare Tunnel to route hostname to `http://localhost:48080`.
9. Confirm login, telemetry, automation, and graph updates from public hostname.

## Cloudflare Notes
- Tunnel target should be frontend only (`localhost:48080`).
- Do not expose backend directly.
- Ensure `.env` `CORS_ORIGINS` includes your Cloudflare hostname.
- Keep `VITE_API_BASE_URL=/api`.

## Data and Persistence
This commit intentionally includes current SQLite changes so existing runtime data can be carried forward:
- `apps/backend/data/vibe-plant.sqlite`
- `apps/backend/data/vibe-plant.sqlite-wal`

## Manual Next Steps After This Commit
1. Pull this commit on Pi.
2. Complete `.env` secrets and hostname values.
3. Deploy and run backend as above.
4. Optional hardening later:
  - systemd service for backend host process
  - systemd service for cloudflared
  - daily backup schedule using `scripts/pi/backup-data.sh`
