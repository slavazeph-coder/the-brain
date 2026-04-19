# Deploying BrainSNN on Railway

The app is a single container: Vite SPA built to `dist/`, served by an
Express server (`server.js`) that also handles the viral endpoints
(`/api/og`, `/r/:hash`, `/i/:hash`, `/api/fetch-url`, `/api/leaderboard`).

## 1. Prerequisites

- Railway account (free tier is fine for launch week)
- `brainsnn.com` DNS you can edit
- Optional but strongly recommended: an Upstash Redis (free) for a
  persistent weekly leaderboard. Without it the leaderboard still works
  but resets per process restart.

## 2. Install the Railway CLI

```bash
curl -fsSL https://railway.app/install.sh | sh
# or: brew install railway
railway login
```

## 3. Ship the service

From this directory (`brainsnn-r3f-app/`):

```bash
railway link        # pick an existing project or create one
railway up          # builds Dockerfile, deploys the image
```

Railway reads `railway.toml`:
- builder: `DOCKERFILE`
- start command: `node server.js`
- healthcheck: `/healthz`

The first build takes ~3 min (npm ci + vite build). The service listens
on `$PORT` (Railway injects it) and binds `0.0.0.0`.

## 4. Attach `brainsnn.com`

```bash
railway domain brainsnn.com
```

Railway prints a CNAME target (e.g. `service-production-abc.up.railway.app`).
Add it at your DNS provider:

```
Type    Name    Value
CNAME   @       service-production-abc.up.railway.app
CNAME   www     service-production-abc.up.railway.app
```

Many registrars don't allow a CNAME on the apex — use Cloudflare (free
proxy + flattened CNAME), or your registrar's ALIAS/ANAME record, or
point `@` at Railway's IPs via an A record if the dashboard offers one.
HTTPS is automatic once DNS resolves.

## 5. Env vars (Project → Variables)

Required for the leaderboard to persist:

```
UPSTASH_REDIS_REST_URL    https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN  <token>
```

Create an Upstash Redis at <https://upstash.com>, copy the REST URL +
token. Free tier is enough for launch week.

Optional (unlock deeper layers — app runs fine without them):

```
VITE_TRIBE_API            https://your-tribe-service
VITE_GEMMA_API_ENDPOINT   https://generativelanguage.googleapis.com/...
VITE_GEMMA_API_KEY        ...
VITE_SYNC_WS_URL          wss://your-relay
```

`VITE_*` vars are read at Vite build time — set them *before* the next
`railway up` so the bundle picks them up.

## 6. Smoke test

```bash
curl https://brainsnn.com/healthz
# → {"ok":true,"ts":...}

curl -o /tmp/og.png https://brainsnn.com/api/og
file /tmp/og.png
# → PNG image data, 1200 x 630

curl -s https://brainsnn.com/api/leaderboard | jq
# → {"week":"2026-W16","total":0,"top":[],"backend":"upstash"}
```

Then visit:
- `https://brainsnn.com/` — live app, demo tiles visible
- `https://brainsnn.com/r/<hash>` — a shared reaction (replace hash with a real one after a scan)
- Twitter card validator: <https://cards-dev.twitter.com/validator>
- LinkedIn post inspector: <https://www.linkedin.com/post-inspector/>

Both should render the 1200×630 card.

## 7. Local dev / staging the container

```bash
npm install
npm run build
npm start                  # boots server.js on :8080
# then: http://localhost:8080
```

Or build the container:

```bash
docker build -t brainsnn .
docker run --rm -p 8080:8080 -e PORT=8080 brainsnn
```

## 8. Rollbacks

Railway keeps deploy history. Roll back via the dashboard or:

```bash
railway status
railway redeploy --previous
```
