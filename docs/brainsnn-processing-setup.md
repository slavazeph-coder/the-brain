# BrainSNN processing: current operations and launch acceptance

The CPU worker is already deployed and configured behind <https://www.brainsnn.com/world/>. Use **Process on BrainSNN**
with the owner's passcode. Do not create a second worker or repeat the original PR #248 provisioning instructions.
This guide records the October 28, 2026 deployment and the checks still needed to finish launch acceptance.

## Verified deployment

Read-only checks at **2026-10-28 01:49 UTC** found both services live, with no staged Railway changes:

| Item | Current value |
|---|---|
| Railway project / environment | `wonderful-charisma` / `production` |
| Project ID | `c7f26b12-f812-4785-bbaf-a49b9caeb228` |
| Environment ID | `96828263-a5d4-442f-ae6f-df7bff99aab8` |
| Website | `the-brain`, service `924291ad-28bb-4a28-91d4-1d639739550f`; branch `main`, source root `brainsnn-r3f-app` |
| Website revision / deployment | `05a9cea0fd05eec95267ffc506463af62408ca3e` / `2187c1c4-153c-4b4d-b6a0-deff0116e3c8` (`SUCCESS`) |
| Worker | `world-worker`, service `8980d2e7-a8d5-4332-84c7-3407dd99e31a`; branch `deploy/world-worker-20261027`, repository root |
| Worker revision / deployment | `20c55b4df1d8c029b9caedab691eafc10cf31f37` / `e97417c3-fac8-4bdd-bece-5595302a0d60` (`SUCCESS`) |
| Worker capacity | One replica, 4 CPU / 8 GB RAM; 10 GB volume at `/data`; no public domain or TCP proxy |
| Worker startup | Application startup complete, listening on `0.0.0.0:8080`, Railway health probe 200 at 01:36 UTC |
| Website startup | New deployment started at 01:40 UTC; fresh public checks passed afterward |

The worker deployment branch keeps a **worker-specific root `railway.toml`**. Its root config must not be merged into
website `main`. Preserve the working `WORLD_WORKER_HOST=0.0.0.0` override: the earlier IPv6 listener failed its health
check in this environment.

```text
browser → HTTPS www.brainsnn.com
          /api/world/session       passcode → temporary browser session
          /api/world/worker/...    uploads, jobs, tickets and downloads
                    ↓ private Railway network
          http://world-worker.railway.internal:8080/
          colmap-sparse + scene-usd, CPU
          /data volume, uploads/results retained up to 24 hours
```

## Public checks and their limits

These unauthenticated requests were verified at the time above:

| URL on `https://www.brainsnn.com` | Expected and observed response |
|---|---|
| `/healthz` | 200, `{"status":"ok"}` |
| `/world/` | 200, World Builder HTML over valid TLS |
| `/api/world/processing` | 200, `{"available":true,"passcode":true,"visitors":false,"visitorJobsPerDay":null}` |
| `/api/world/worker/v1/capabilities` without a session | 401, reconnect-session message |

`available:true` reflects the site's configuration; it does **not** ping the worker or prove a job completed. Railway's
worker health check proves startup, not COLMAP/Blender execution. The 401 is the expected authentication boundary.
Visitor processing is disabled.

For a quick read-only repeat:

```sh
curl --fail --silent --show-error https://www.brainsnn.com/healthz
curl --fail --silent --show-error https://www.brainsnn.com/api/world/processing
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://www.brainsnn.com/world/
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://www.brainsnn.com/api/world/worker/v1/capabilities
```

## Remaining acceptance checklist

Retain the revision, deployment IDs, input hashes, job IDs, timings and downloaded evidence for each actual run.
Outputs belong in a fresh private directory outside the checkout. Never include passcodes or session tokens in a receipt.

- [x] Website and private worker deployments succeeded; public health, page, configuration and authentication boundary
  were checked as above.
- [ ] **Authenticated live capability check.** Run the setup check below and confirm the deployed worker advertises
  the required available engines. It has not yet been verified in the live launch receipt.
- [ ] **Actual live reconstruction and unscaled scene.** Run the video command below on an approved capture; require
  completed jobs, matching artifact SHA-256 values, and a `consistent` reconstruction fold screen. Preserve
  `check-results.json` with `passed:true`. Missing or unconfirmed fold evidence is not a pass.
- [ ] **Native capture through the live site.** Use the native submission CLI below with a valid sidecar and original
  photos. Retain `native-capture.json`, `reconstruction.json`, the camera-frame ledger and submission receipt. Confirm
  their source hashes and alignment evidence. A synthetic fixture must remain labelled synthetic.
- [ ] **Metric scene and export.** In the browser, reconstruct an actual permitted room capture, enter one measured
  calibration span, record at least three held-out readings, review an opening and download the scene/IFC/CAD outputs.
  Retain the original readings and `scene-measurements.json`; keep failures visible. Follow
  [demo acceptance](world-demo-release-checklist.md) for target-application opening, editing and reopening checks.
- [ ] **Physical browser/device receipt.** Exercise the actual phone browser with upload consent, reconstruction,
  scale/review/export and cancellation. Desktop and phone-sized Chromium/WebKit fixtures do not satisfy this gate.
- [ ] **Apex routing.** Repair `brainsnn.com`, then verify valid HTTPS and deep-link/query preservation as described below.

The first two unchecked items establish live processing. Metric/physical acceptance is separate: native pose scale,
synthetic truth scores, model-to-point fit and library asset dimensions do not certify a captured room. The native input
adapter is not a native phone app. Asset composition and any Isaac Sim execution have their own qualification in
[launch extensions](world-simready-launch-20261027.md).

## Run the authenticated checks

Use Python 3.10+ for `site_processing_check.py`; it needs only the standard library. The script prompts for the passcode
without echo, or reads an already securely supplied `BRAINSNN_PASSCODE` environment variable. Do not put the passcode
in a command argument, shell history, chat, source file or screenshot. The Railway connector currently redacts values;
refresh authorized local Railway access or use the owner's password manager to obtain it privately.

```sh
python3 scripts/world-demo/site_processing_check.py --site https://www.brainsnn.com

mkdir -p "$HOME/brainsnn-launch-receipts"
python3 scripts/world-demo/site_processing_check.py \
  --site https://www.brainsnn.com \
  --video /absolute/path/to/approved-walkthrough.mov \
  --scene --timeout 1800 \
  --out "$HOME/brainsnn-launch-receipts/video-20261028-01"
```

Without `--video`, exit 0 means configuration, passcode session and available engine checks passed. With `--video`, the
script uploads the file, executes reconstruction, downloads artifacts with SHA-256 checks and requires the fold status
`consistent`. `--scene` then uploads the same video for a **separate unscaled** `scene-usd` job. It does not enter a metric
scale, exercise held-out checks or validate metric IFC/CAD exports. Exit 1 means failure; exit 2 means site processing is
not configured. A timeout or transport failure after job creation requests cancellation and reports whether cancellation
was accepted. Keep that job ID if cancellation could not be confirmed.

Choose a new `--out` for every run. The script's default output is relative to the current directory, so explicitly use
an outside-checkout path as above. Do not mistake downloaded files alone for a passing receipt.

For an existing calibrated native capture, install the dependencies in [native capture](world-native-capture.md), then:

```sh
python scripts/world-demo/native_capture_submit.py \
  --site https://www.brainsnn.com \
  --bundle /absolute/path/to/capture/capture.json \
  --root /absolute/path/to/capture \
  --out "$HOME/brainsnn-launch-receipts/native-20261028-01" \
  --consent
```

This requires 3–11 original calibrated JPEG/PNG images and the matching sidecar, not an arbitrary video or a ZIP.
Check the native guide for current evidence requirements. Physical dimensions remain unverified.

## Repair the apex domain without disturbing the working site

Use `www.brainsnn.com` for launch links now. On October 28 the apex resolved to GoDaddy addresses `3.33.251.168` and
`15.197.225.128`; `/world/`, `/healthz` and both tested API paths returned 404. Railway's apex status was:

- required traffic target: `brainsnn.com` CNAME → `tnoamdbj.up.railway.app` (unset / requires update);
- domain ownership verified, but Railway certificate still `ISSUING`.

Re-read Railway's current target before changing DNS. Its [domain guide](https://docs.railway.com/networking/domains/working-with-domains)
requires root flattening/ALIAS and lists GoDaddy as unsupported for that method; a static A record is not a supported
replacement. GoDaddy's newer [HTTPS/SVCB AliasMode announcement](https://www.godaddy.com/resources/news/beyond-cname-flattening)
does not establish compatibility with Railway routing and certificate validation.

[GoDaddy HTTPS forwarding](https://www.godaddy.com/help/forward-my-godaddy-domain-12123) to the canonical `www` origin is a
possible route, but do not declare it fixed until actual deep paths and query strings survive the redirect. If forwarding
cannot preserve them, use a DNS arrangement that Railway explicitly supports. Any nameserver change needs a complete
record inventory and a separately reviewed migration; this handoff does not authorize one by itself.

Keep existing `www`, mail and unrelated records. After the selected change, verify apex HTTPS, `/world/`,
`/healthz`, `/api/world/processing` and a harmless query such as `/world/?launch-check=1`. Either serve the correct site
or preserve the full path/query when redirecting to `www`; a root-only redirect with deep-link 404s fails acceptance.
Also verify `www` remains healthy. A GoDaddy-owned forwarding certificate and a Railway-served apex certificate are
different routing arrangements; check the certificate for the route actually selected.

## Release and recovery procedure

1. Require the appropriate checks at the exact release head: `World Builder contracts`, `World launch extensions`
   and, when relevant, `World Omniverse qualification`. Their current workflow files contain the full commands. Browser
   fixture passes establish software behavior, not a physical capture. The Omniverse inspection job alone is not physics.
2. Merge checked application changes to `main`; wait for the website deployment to succeed, then repeat the public checks.
3. In the separate worker deployment checkout, merge the checked main revision forward into
   `deploy/world-worker-20261027`. Preserve its worker-specific root `railway.toml`, one replica, `/data` volume and
   working host override. Review the resulting diff; the release recorded here differs from main only in root
   `railway.toml`. Do not merge that file back to website main.
4. Inspect active jobs before rollout when authenticated operator visibility is available. Health and low CPU alone
   cannot prove the queue is empty. A restart ends in-memory site sessions, so reconnect before a new check.
5. Wait for the worker deployment and its `/healthz` probe, then repeat authenticated capability and actual job checks.
   A website release does not automatically advance the worker's separate branch.

For recovery, compare existing settings rather than replacing all service variables:

| Service | Required configuration |
|---|---|
| Website | `WORLD_WORKER_INTERNAL_URL=http://world-worker.railway.internal:8080/`; the same `WORLD_SITE_PASSCODE` as the worker; visitors remain off unless intentionally enabled |
| Worker | Dockerfile `robotics/world_worker/deploy/railway/Dockerfile`; start script `/app/robotics/world_worker/deploy/railway/start.sh`; `PORT=8080`, `WORLD_WORKER_HOST=0.0.0.0`, `WORLD_CPU_THREADS=4`, persistent `/data`, no public domain |
| Worker storage | Budget below the mounted volume size: `WORLD_STORAGE_BYTES=9000000000` is the recommended target for a 10 GB volume; verify the live value privately before changing it |
| Credentials | Keep the existing shared passcode arrangement. Rotation requires updating both services and redeploying both; it is not part of a routine code release |

The generic [Railway kit](../robotics/world_worker/deploy/railway/README.md) describes provisioning from scratch. Its
config-file-path approach must not replace this already working deployment-branch arrangement without a separately
verified migration. If logs show `vite build` or `node dist/server.cjs` for the worker, the website root config was selected.

## Troubleshooting and retention

| Observation | Check or next action |
|---|---|
| `/api/world/processing` is 404 | Confirm canonical `www` and the website deployment; the apex currently fails this way |
| Processing says `available:false` | Check site variable names, internal URL and passcode configuration; this is not a worker health response |
| Unauthenticated capabilities is 401 | Expected; use the passcode session for the authenticated check |
| Authenticated capabilities is 502 | Inspect private worker startup/health, port 8080 and the site's internal URL |
| Authenticated capabilities is unauthorized | Verify both services use the same existing credentials privately |
| Worker cannot bind | Preserve `WORLD_WORKER_HOST=0.0.0.0` for this environment |
| Upload quota reached | Inspect retained uploads/jobs and wait for normal expiry; do not delete the entire `/data/worker` tree while jobs or evidence may be needed |
| Job fails, times out or returns inconsistent/unconfirmed geometry | Retain the failure receipt, inspect its logs and source coverage, then retry or recapture only with an explicit reason |
| Session ended after deployment | Reconnect; site sessions live in memory and are invalidated by a site restart |

Worker job logs live at `/data/worker/jobs/<id>/operator.log`. Uploads/results normally expire after 24 hours; retain
needed acceptance evidence privately before expiry. Sessions are scoped to their own uploads and jobs; job listing is
refused by the public proxy. Artifact tickets last 60 seconds. Visitor processing remains disabled, and changing that
policy requires a separate operational decision with retention, quota and cost limits reviewed.
