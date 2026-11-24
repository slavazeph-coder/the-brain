---
type: project
description: November 21 audit of whether the World Builder API can be sold — what works, what blocks paying customers, fixes shipped
---

# API sell-readiness audit — 2026-11-21

Owner asked: get brainsnn.com running smoothly enough to sell the API, and check
every layer is working and built. The product being sold is the one on
`/world/api.html`: the World Projects API (`/api/world/v1`) plus its processing
bridge (`/api/world/v1/processing`). The text-analysis endpoints are not it.

## Verified working (this session)

- Typecheck, 1,115 unit tests, 73 paid-analysis tests, 651 World JS tests,
  1,329 Python worker/scene-compiler tests, MCP smoke (103 layers),
  Neural Mirror CPU self-test: all pass.
- Production bundle (`vite build` + server bundle) builds and boots against
  Postgres 16; the SDK quickstart `examples/world-project-api.mjs` passes end to
  end with an operator-provisioned key (project, source, revision, evidence,
  trial, export v2).
- Live: Railway project `wonderful-charisma`, service `the-brain`; 7-day 5xx
  rate 0.02% (7 of 32,405). `/api/world/v1/status` is available on Postgres.
  Only the owner's IP and test agents have called it: no external API users yet.

## Fixed in this PR

- Processing hangs: the site proxy and the project bridge used a single
  120-second limit for every worker call. During worker redeploys,
  `/api/world/worker/v1/capabilities` hung 120 s then returned 502 (Nov 14,
  18, 18, 20). Now control calls fail in 15 s (site) / 10 s preflight + 30 s
  (bridge) with a retryable 504 `worker_timeout`; transfers keep 120 s, and
  bridge downloads use a 30 s stall timer instead of a wall clock (a 1 GiB
  artifact over a slow link was being cut at 120 s).
- Latent key leak: `import.meta.env?.VITE_ANALYTICS_URL` made Vite inline every
  `VITE_*` variable into the client bundle. A canary build proved it. The live
  bundle is clean only because the Dockerfile does not pass Railway variables
  into the build. Fixed to a static read; `scripts/check-env-exposure.mjs` now
  runs in `npm test`.

## Still blocking a paid customer (owner / ops decisions)

1. No `WORLD_PROJECT_WORKER_TOKENS_JSON` in production: every customer
   processing call returns 503 `processing_unconfigured`. Provision per tenant
   with `world-project-worker-tenant.mjs` (website + worker sides).
2. No `WORLD_PROJECT_S3_*`: project sources cap at 512 KiB, smaller than one
   phone video. Needs a private bucket.
3. No billing for the API: keys are CLI-provisioned, `/usage` is admission
   accounting, not invoicing. For first customers, invoice manually.
4. Production database backups were a stated launch precondition; not verified.
5. `VITE_GEMINI_API_KEY` is set on Railway. **Correction Nov 23:** `GEMINI_API_KEY` references it and the server reads that, so do not delete it as-is; move the value into `GEMINI_API_KEY` first (dashboard).
6. Builds download MoveNet from kaggle.com on every clean build; a kaggle outage
   blocks deploys. **Fixed Nov 23:** the build now falls back to `MOVENET_MIRROR` and then to the copy brainsnn.com serves, enforcing the same pinned SHA-256s.

## Product-quality caution (text endpoints)

`/api/firewall` and `/api/affect` are public, unauthenticated keyword
heuristics. "Act NOW before it is too late. Everyone is already switching and
you will regret missing out." scored pressure 0.28 and dominant affect
"clarity". Do not sell these as an accuracy-backed API without a benchmark.

## Second pass (same day): audit and fixes

- Error sweep: all 50 studio tools and 14 standalone pages open with zero page
  errors, console errors or missing files (Chromium). Accessibility: zero axe
  WCAG 2.1 A/AA violations on the playground, chapter panel, missions board and
  workbench at 1440 and 390 px.
- Production sent no compression and revalidated hashed assets every visit.
  `src/server/staticDelivery.js` adds `compression` (Brotli/gzip) for GET/HEAD
  outside `/api/` and a one-year immutable cache for Vite `name-HASH.ext`
  assets. Showcase poster re-encoded 229 → 67 KB. First load: 1,568 → 550 KB
  transferred.
- Billing meter: `brainsnn_world_usage_monthly` counts api_requests,
  processing_jobs_started (not idempotent replays), processing_upload_bytes and
  processing_artifact_bytes per workspace per UTC month. `/usage` returns
  `billing` (OpenAPI 1.2.0); `npm run world:projects:usage -- --month YYYY-MM`
  exports CSV for invoicing. Meter failures never fail the customer request.
- Still owner/ops: worker tenant tokens, S3 bucket, DB backups, deleting unused
  `VITE_GEMINI_API_KEY`, and the build's kaggle.com MoveNet download (vendor the
  checksummed weights or add a verified mirror; not reachable from the sandbox).
