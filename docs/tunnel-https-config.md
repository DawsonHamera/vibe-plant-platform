# Tunnel & HTTPS Configuration Guide

## Current Setup

Your Vibe Plant Platform is now configured to work with tunnels like Cloudflare, ngrok, or similar services.

### Services
- **Frontend**: HTTP on localhost:48080 (served via nginx)
- **Backend API**: HTTP on localhost:43000 (NestJS)
- **Public Domain**: planthub.deloro3dpc.tech

## The SSL Error You Received

**Error**: `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`

This error occurred because the tunnel was trying to enforce HTTPS connections to your backend, but there was a protocol mismatch between what the tunnel expected and what the backend provided.

## Solution Implemented

### 1. Frontend Protocol Detection
The frontend now **automatically detects** if it's being served via HTTPS and upgrades API calls to use HTTPS accordingly.

**File**: [apps/frontend/src/App.tsx](apps/frontend/src/App.tsx#L21-L31)

```typescript
if (window.location.protocol === "https:") {
  // Replace http:// with https:// for API base URL
  baseUrl = baseUrl.replace(/^http:/, "https:");
}
```

This means:
- ✅ Local development works seamlessly with HTTP
- ✅ When tunneled via HTTPS, API calls automatically use HTTPS
- ✅ No mixed content warnings

### 2. CORS Configuration Updated
Both CORS and backend now accept both HTTP and HTTPS origins:

```
CORS_ORIGINS=http://localhost:48080,https://localhost:48080,http://127.0.0.1:48080,https://127.0.0.1:48080,...
```

## How to Configure Your Tunnel

### Option A: Cloudflare Tunnel (Recommended)
For the backend API port (43000), ensure your tunnel configuration routes to HTTP (not HTTPS):

```yaml
ingress:
  - hostname: planthub.deloro3dpc.tech
    path: /api/*
    service: http://localhost:43000
  - hostname: planthub.deloro3dpc.tech
    service: http://localhost:48080  # Frontend
```

**Key Point**: Leave the backend service as `http://localhost:43000` - Cloudflare Tunnel will handle HTTPS encryption from clients to the tunnel endpoint. The tunnel-to-local communication should be plain HTTP.

### Option B: ngrok
```bash
ngrok http 48080  # Frontend on HTTPS domain
```

For backend, create a separate tunnel:
```bash
ngrok http 43000  # Backend API
```

Then configure the frontend's API base URL to point to the ngrok backend tunnel.

### Option C: Custom SSH/VPN Tunnel
If using a custom tunnel solution, ensure it:
1. Accepts HTTPS from clients
2. Routes to HTTP localhost:43000 for backend
3. Routes to HTTP localhost:48080 for frontend

## Testing the Fix

### Locally
```bash
docker compose -f docker-compose.prod.yml ps
# Both services should show "healthy"
```

### On Tunnel
1. Access `https://planthub.deloro3dpc.tech`
2. Open browser DevTools (F12)
3. Go to Network tab
4. Check that API calls are successful (200/2xx responses)
5. **No mixed content warnings** should appear

## Environment Variables

If you need to add your tunnel domain to CORS for testing:

```env
CORS_ORIGINS=http://localhost:48080,https://localhost:48080,https://planthub.deloro3dpc.tech,http://planthub.deloro3dpc.tech
```

Then rebuild:
```bash
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d
```

## Common Issues & Fixes

| Issue | Cause | Solution |
|-------|-------|----------|
| Still getting SSL errors | Tunnel is enforcing HTTPS to local backend | Configure tunnel to use HTTP for backend service |
| Mixed content warnings | Frontend using HTTPS, APIs using HTTP | Frontend now auto-detects this - should be fixed |
| 401 Unauthorized errors | Auth credentials not sent | Browser auto-includes cookies (credentials: include) - restart browser cache |  
| CORS failures | Tunnel domain not in CORS_ORIGINS | Add tunnel domain to CORS_ORIGINS env var |

## TLS Certificates

The backend generates self-signed certificates on startup (visible in logs) but doesn't use them by default. If you need end-to-end encryption from local services:

1. Update [apps/backend/src/main.ts](apps/backend/src/main.ts) to enable HTTPS
2. Mount certificates to backend container
3. Ensure frontend's protocol detection remains active

For now, the tunnel provider (Cloudflare/ngrok) handles HTTPS encryption, and internal communication is plain HTTP for simplicity and performance.

## Support

If you continue seeing SSL errors:
1. Check your tunnel provider's configuration
2. Ensure backend is reachable: `curl http://localhost:43000/health`
3. Check backend logs: `docker compose -f docker-compose.prod.yml logs backend`
4. Verify CORS origins: `docker compose -f docker-compose.prod.yml logs backend | grep CORS`
