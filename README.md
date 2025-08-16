# Advanced Load Tester

Next-Generation Load Testing Framework with Node.js + optional Python bridge for ML/AI analytics and a real‑time dashboard.

## Features

- HTTP/HTTPS, WebSocket, GraphQL, gRPC, and optional browser scenarios
- Real-time dashboard and Socket.IO updates
- Optional Python bridge for metrics analysis and proxy generation
- Config manager, real-time performance tracker, and proxy manager utilities
- Vitest test suite and ESLint v9 flat config

## Requirements

- Node.js >= 16
- Python >= 3.8 (optional; needed for `python_bridge_new.py` features)

## Quick start

1) Install Node deps

```powershell
npm install
```

2) (Optional) Install Python deps

```powershell
pip install -r requirements.txt
```

3) Run the unified server (serves API and dashboard; starts Python bridge if available):

```powershell
npm start
```

Open http://localhost:3000 for the dashboard.

## Useful scripts

- `npm run dev` – reload on JS/html/css changes
- `npm test` – run Vitest with coverage
- `npm run lint` – ESLint flat config
- `npm run docker:build && npm run docker:run` – containerized run

## Project layout

- `app.js` – unified entrypoint (Express + Socket.IO + optional Python bridge)
- `js/` – core engines and utilities
- `dashboard/` – real-time dashboard
- `python_bridge_new.py` and `proxy_manager.py` – optional Python components

## Deployment

This is a server app (Node + optional Python). Static hosts like GitHub Pages cannot run it. Here are options:

- Vercel: Not suitable for long-running socket servers and background workers. Vercel serverless functions have short timeouts and no WebSocket upgrades by default. You can host just the static dashboard there; point it at your external backend.
- GitHub Pages: Static only; cannot host Node/Python servers. You can deploy only the `dashboard/` as static content; point it at your external backend.
- Recommended: Deploy to a VM or container platform (e.g., Docker on a VPS, Fly.io, Railway, Render, Heroku alternatives). Map ports 3000 (Node) and 5001 (Python bridge).

### Static dashboard (Vercel or GitHub Pages)

The dashboard is now decoupled using `dashboard/config.js` with two variables:

- `window.API_BASE` – base URL for HTTP API (e.g., https://your-backend.example.com)
- `window.WS_BASE` – base URL for Socket.IO (usually same as API base)

Options to set it:

- Local/dev: run `npm run dashboard:config` after setting env vars:

```powershell
$env:DASHBOARD_API_BASE = "https://your-backend.example.com"; $env:DASHBOARD_WS_BASE = "https://your-backend.example.com"; npm run dashboard:config
```

- GitHub Pages: we included `.github/workflows/deploy-dashboard.yml` which runs the generator using repository-level Variables `DASHBOARD_API_BASE` and `DASHBOARD_WS_BASE` and publishes `dashboard/`.

- Vercel: set a Build Command that runs `npm ci --omit=dev && node scripts/write-dashboard-config.js` and set Environment Variables `DASHBOARD_API_BASE` and `DASHBOARD_WS_BASE`. Set the Output Directory to `dashboard` and framework to "Other".

Note: If `dashboard/config.js` is missing, the dashboard defaults to `window.location.origin`.

### CORS and Socket.IO origins

Set `ALLOWED_ORIGINS` (comma-separated) for the backend to restrict cross-origin access:

```yaml
services:
	app:
		environment:
			- ALLOWED_ORIGINS=https://your-vercel-app.vercel.app,https://your-user.github.io
```

If unset, the server allows all origins (useful for local dev). In production, set explicit origins.

### Minimal Docker example

```dockerfile
# Dockerfile (multi-stage optional)
FROM node:18-bullseye
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 python3-pip \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 3000 5001
CMD ["npm","start"]
```

Build and run:

```powershell
npm run docker:build
npm run docker:run
```

Or with Compose:

```powershell
docker compose up --build -d
```

If you need the Python bridge in the same container, use a multi-stage or base image with Python and install `requirements.txt`, then run a process manager (e.g., `npm start` launches Node and spawns Python as defined in `app.js`).

## Configuration notes

- Dashboard served at `/` (real-time) and `/dashboard/real-time`.
- API base: `/api/v1/*`. Python proxy at `/api/python/*` when bridge is running.
- Logs: `logs/`. Reports: `reports/`.

## Security & production

- Put this behind a reverse proxy (Nginx/Caddy) with TLS.
- Configure CORS and allowed origins for Socket.IO if exposing publicly.
- Keep optional heavy features (browser, gRPC) disabled unless needed.

## License

MIT
