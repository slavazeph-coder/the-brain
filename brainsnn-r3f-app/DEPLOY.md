# Deploying BrainSNN

BrainSNN is the Vite app in `brainsnn-r3f-app/`, served by `server.js` on
Railway. The production service is:

- Railway project: `wonderful-charisma`
- Project id: `c7f26b12-f812-4785-bbaf-a49b9caeb228`
- Service: `the-brain`
- Environment: `production`
- App root: `brainsnn-r3f-app`
- Healthcheck: `https://www.brainsnn.com/healthz`

## Normal deploy

1. Merge a PR into `main`.
2. Open GitHub Actions.
3. Watch `Deploy BrainSNN app to Railway`.
4. Green means Railway reported a successful deployment and the live healthcheck
   returned HTTP 200.

The workflow runs when `main` changes any of:

- `brainsnn-r3f-app/**`
- root `Dockerfile`
- root `railway.toml`
- `.github/workflows/brainsnn-app-deploy.yml`

It can also be run manually with `workflow_dispatch`.

## One-time GitHub setup

Required repository secret:

```text
RAILWAY_TOKEN
```

Optional repository variables if Railway is renamed:

```text
RAILWAY_PROJECT_ID
RAILWAY_SERVICE
RAILWAY_ENVIRONMENT
BRAINSNN_HEALTH_URL
```

Do not put app API keys in GitHub workflow files. Vite build-time values must be
Railway service variables so Railway can pass them into Docker:

```text
VITE_CRUMB_LLM_URL
VITE_CRUMB_LLM_KEY
VITE_GEMINI_API_KEY
VITE_GEMINI_MODEL
VITE_GEMINI_API_BASE
VITE_GEMMA_API_ENDPOINT
VITE_GEMMA_API_KEY
VITE_GEMMA_MODEL
VITE_TRIBE_API
VITE_SYNC_WS_URL
VITE_LOBSTER_TRAP_URL
VITE_LOBSTER_TRAP_KEY
```

`VITE_*` values are public once baked into the browser bundle. Use only
non-privileged client-safe values there.

## Manual fallback

From the repo root:

```bash
railway link \
  --project c7f26b12-f812-4785-bbaf-a49b9caeb228 \
  --service the-brain \
  --environment production

railway up brainsnn-r3f-app \
  --path-as-root \
  --service the-brain \
  --environment production \
  --detach
```

Then verify:

```bash
curl -L https://www.brainsnn.com/healthz
```

Use `www.brainsnn.com` for curl checks. The apex
`https://brainsnn.com/healthz` currently follows to a 404 in strict curl checks.

## Confirm the friendly build

The Vite `dist/index.html` file only references the built JS bundle. The friendly
landing copy lives in the built app chunk. Check local output:

```bash
npm ci
npm run build
npm run verify:friendly-build
```

Check production:

```bash
html="$(curl -L -sS https://www.brainsnn.com/)"
asset="$(printf '%s' "$html" | sed -n 's/.*src="\([^"]*\/assets\/index-[^"]*\.js\)".*/\1/p' | head -1)"
curl -L -sS "https://www.brainsnn.com${asset}" | grep 'Feel what you read'
```

## Rollback

Use the Railway dashboard deployment history, or:

```bash
railway redeploy --previous
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Workflow fails before deploy | Add `RAILWAY_TOKEN` as a GitHub repository secret. |
| Workflow deploys but healthcheck fails | Check `BRAINSNN_HEALTH_URL`; `www.brainsnn.com/healthz` is the known-good curl URL. |
| Crumb LLM URL/key is blank in the app | Set the `VITE_CRUMB_LLM_*` values as Railway service variables, then redeploy. |
| Local tests fail after `npm ci` | Ensure `@testing-library/dom` is installed from the committed lockfile. |
