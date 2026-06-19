# Deploying BrainSNN

BrainSNN.com is served by one Railway service from the repo root:

- `ui/brainsnn-site/` builds the public homepage at `/`.
- `brainsnn-r3f-app/` builds the scanner/product app at `/app/`.
- `brainsnn-r3f-app/server.js` serves both builds.
- The root `Dockerfile` is the full production build.

The production service is:

- Railway project: `wonderful-charisma`
- Project id: `c7f26b12-f812-4785-bbaf-a49b9caeb228`
- Service: `the-brain`
- Environment: `production`
- Required build context: repo root
- Healthcheck: `https://www.brainsnn.com/healthz`

## Railway dashboard setting

The Railway dashboard currently shows:

- Root Directory: `brainsnn-r3f-app`
- Auto deploys from GitHub: enabled
- Wait for CI: enabled

That native GitHub path is app-only. It cannot build `ui/brainsnn-site/`,
because Docker cannot copy files outside the `brainsnn-r3f-app` build context.

Use one of these production-safe configurations:

1. Recommended: disable Railway native auto-deploy and let GitHub Actions run
   the repo-root `railway up` deploy.
2. Alternative: keep Railway native auto-deploy, but clear Root Directory so it
   builds from the repo root with the root `Dockerfile` and root `railway.toml`.

Do not leave native auto-deploy enabled with Root Directory set to
`brainsnn-r3f-app`. With "Wait for CI" enabled, Railway can start an app-only
native deployment after the GitHub Actions deploy succeeds, overwriting the
homepage build.

## Normal deploy

1. Merge a PR into `main`.
2. Open GitHub Actions.
3. Watch `Deploy BrainSNN app to Railway`.
4. Green means the workflow built the homepage and app, deployed the repo root
   to Railway, and verified the live homepage + app markers.

The workflow runs when `main` changes any of:

- `brainsnn-r3f-app/**`
- `ui/brainsnn-site/**`
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
BRAINSNN_VERSION_URL
BRAINSNN_SITE_PREVIEW_URL
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

railway up \
  --project c7f26b12-f812-4785-bbaf-a49b9caeb228 \
  --service the-brain \
  --environment production \
  --detach
```

Then verify:

```bash
curl -L https://www.brainsnn.com/healthz
curl -L -s https://www.brainsnn.com/social-preview.svg | grep 'Read the Feed'
curl -L -s -o /dev/null -w '%{http_code}\n' https://www.brainsnn.com/app/favicon.svg
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
| Homepage changes do not appear | Confirm Railway native auto-deploy is disabled or Root Directory is repo root; `brainsnn-r3f-app` root builds cannot include `ui/brainsnn-site`. |
| Crumb LLM URL/key is blank in the app | Set the `VITE_CRUMB_LLM_*` values as Railway service variables, then redeploy. |
| Local tests fail after `npm ci` | Ensure `@testing-library/dom` is installed from the committed lockfile. |
