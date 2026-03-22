# Raspberry Pi 4 + Cloudflare Quickstart

This is a simplified path to run Vibe Plant Platform on a Raspberry Pi 4 with acceptable downtime.

## 1) What Runs Where
- Pi host: backend (`npm run prod:backend:run-host`) on port `43000`
- Pi Docker: frontend (`npm run prod:frontend:deploy`) on port `48080`
- Cloudflare Tunnel: public hostname -> `http://localhost:48080`

## 2) Pre-Work In This Repo
- Use `.env.rpi.example` as the base for Pi `.env`
- Use scripts in `scripts/pi`:
  - `deploy.sh`
  - `health-check.sh`
  - `backup-data.sh`
  - `restore-data.sh`

## 3) Commit and Push (local machine)
From repo root:

```bash
git checkout -b chore/rpi4-migration
git add .
git commit -m "chore: add rpi4 + cloudflare quickstart and helper scripts"
git push -u origin chore/rpi4-migration
```

Then merge as normal (PR or direct).

## 4) Pi Setup (one-time)
On Raspberry Pi OS 64-bit:

```bash
sudo apt update
sudo apt install -y git curl jq
```

Install Docker + compose plugin (official convenience script is fine for non-critical setup):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

Install Node 22 (using NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## 5) Clone + Configure On Pi

```bash
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt
cd /opt
git clone <YOUR_REPO_URL> vibe-plant-platform
cd vibe-plant-platform
cp .env.rpi.example .env
```

Edit `.env` and set:
- `CORS_ORIGINS` with your real hostname
- `VIBE_AUTH_PASSPHRASE`
- `VIBE_AUTH_SECRET`
- `VIBE_AUTH_COOKIE_SECURE=true`

Make helper scripts executable:

```bash
chmod +x scripts/pi/*.sh
```

## 6) First Deploy On Pi

```bash
./scripts/pi/deploy.sh
```

Start backend in a separate shell/session:

```bash
npm run prod:backend:run-host
```

Then verify:

```bash
./scripts/pi/health-check.sh
```

## 7) Cloudflare Tunnel (simple)
Install and authenticate cloudflared on Pi, then create a tunnel to frontend port `48080`.

Minimal tunnel config idea:

```yaml
ingress:
  - hostname: plants.example.com
    service: http://localhost:48080
  - service: http_status:404
```

Important:
- Keep frontend target as `localhost:48080`
- Do not route directly to backend
- Ensure hostname in `.env` `CORS_ORIGINS`

## 8) Ongoing Operations
Update app:

```bash
cd /opt/vibe-plant-platform
git pull
./scripts/pi/deploy.sh
# restart backend host process if needed
```

Backup data:

```bash
./scripts/pi/backup-data.sh
```

Restore data:

```bash
./scripts/pi/restore-data.sh /absolute/path/to/backup.tgz
```

## 9) Recommended Next (optional)
- Convert backend host process to a `systemd` service for auto-start on boot.
- Convert cloudflared to a `systemd` service.
- Add a daily cron job for `backup-data.sh`.
