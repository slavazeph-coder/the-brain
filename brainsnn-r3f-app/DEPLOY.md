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

## 8. brainsnn.com launch checklist (Vault-as-Obsidian-replacement)

The L109 Vault, L110 Graph, and L111 Daily Notes layers turn the app
into a local-first knowledge tool with a cognitive firewall on every
note. Use this checklist for the launch.

### 8a. Domain layout (recommended)

```
brainsnn.com               → ui/brainsnn-site (marketing landing, fast SSG)
app.brainsnn.com           → brainsnn-r3f-app (this Railway service)
```

Why split: the R3F app is ~1 MB gzipped and slow on first paint; the
landing site at `ui/brainsnn-site` is ~30 KB. First-time visitors land
on a fast page, click "Open the app" → `app.brainsnn.com` for the full
108-layer experience.

To switch from the current single-domain setup:

```bash
# 1. Tell Railway about the new subdomain
railway domain app.brainsnn.com

# 2. At your DNS provider:
#    CNAME  app   <railway-cname-target>

# 3. Re-deploy the marketing site to Pages on the apex
#    (ui/brainsnn-site has its own workflow at
#    .github/workflows/brainsnn-site-pages.yml)
```

### 8b. Pre-launch smoke test (in addition to §6)

```bash
# Vault data is local, but the wiring should not 404:
curl -sI https://app.brainsnn.com/ | head -1
# → HTTP/2 200

# Open DevTools, run in the console of app.brainsnn.com:
#   localStorage.getItem('brainsnn_vault_index_v1')
# Should be `null` on first load.
```

Manual QA on the live URL (allow ~10 min):

- [ ] L109 Vault: New note → type a body with `[[Other]]` → see autocomplete
      open after `[[`, accept → click the rendered link in the preview, lands
      on a freshly-created "Other" note.
- [ ] L109 Vault: Cognitive firewall card appears under the editor for any
      body ≥ 5 words; numbers update on save.
- [ ] L110 Vault Graph: refresh the panel after creating 5 notes with cross
      links — graph should show 5 nodes, edges connecting them.
- [ ] L111 Daily Notes: "Today's note" button creates a YYYY-MM-DD note;
      a second click of the same button does not create a duplicate.
- [ ] Import .md: drag-drop 3 markdown files; they appear in the sidebar.
- [ ] Export JSON: download a `brainsnn-vault-YYYY-MM-DD.json` file; it is
      valid JSON with the expected shape (array of notes).
- [ ] L57 Data Portability still round-trips the entire `brainsnn_*` namespace
      including the new vault keys.

### 8c. Storage quotas (browser localStorage)

Each browser allocates ~5 MB to localStorage per origin. The vault uses
one key per note (`brainsnn_vault_note_<id>`) plus the index, so the
real cap is roughly:

```
budget ≈ 5 MB
per-note overhead ≈ 100 bytes (key + JSON envelope)
average note ≈ 2 KB body
→ ~2,000–3,000 notes per browser before headroom runs out
```

When users approach that cap, migrate to IndexedDB by replacing
`localStorageBackend()` with an IndexedDB-backed storage object that
implements the same `{ get, set, remove, keys }` shape — the rest of
the vault code is storage-agnostic by design.

## 9. Rollbacks

Railway keeps deploy history. Roll back via the dashboard or:

```bash
railway status
railway redeploy --previous
```
