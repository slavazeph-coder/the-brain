---
type: project
description: Durable World Projects API, evidence/review ledger and dedicated processing access
---

# World Projects platform — November 19, 2026

The founder requested a deep implementation of the missing B2D/API foundation,
following the source/evidence/change/outcome research. This work is additive to
the robot playground and preliminary Project Review from PRs315/318.

- `brainsnn-r3f-app/src/server/worldProjectService.js` and `worldProjectStore.js`
  implement `/api/world/v1` with PostgreSQL, operator-provisioned named API keys,
  roles/scopes, exact retained source bytes, immutable revisions, evidence review,
  change decisions, physical/simulation trial records, audit events and export.
- `WORLD_PROJECT_DATABASE_URL` takes precedence over `DATABASE_URL`.
  `WORLD_PROJECTS_ENABLED=0` disables the new API. Missing/unavailable storage
  fails closed; there is no deployed memory or SQLite fallback for projects.
- Project keys are hashed in the database, expire and can be revoked. Their
  principals are explicitly provisioned identities, not verified legal identity
  or SSO. `world-project-admin.mjs` provisions or rotates credentials. Rotation
  must reuse the principal ID to preserve independent-review checks.
- Project writes require Idempotency-Key and expected_version. Compact durable
  receipts return the original action resource and current project on replay.
  Named reviewers cannot approve their own proposed changes. Changing the
  as-is baseline or rejecting relevant evidence makes dependent decisions stale.
- `/world/projects.html` uses keys only in page memory. World Builder can hand
  over a bounded map snapshot; original capture media is not included. Exact
  inline source bytes are limited to512KiB each and16MiB/project. PR321's
  follow-up adds separately configured private S3 chunk storage for larger files.
  A worker job ID alone is not retention.
- `projectProcessingBridge.js` mounts `/api/world/v1/processing` before the
  project router. It maps project tenant IDs to dedicated worker credentials
  configured in `WORLD_PROJECT_WORKER_TOKENS_JSON`, verifies worker owner identity
  on every operation and never uses shared website/operator tenant credentials.
  Worker-side `WORLD_PROJECT_WORKER_TENANTS_JSON` contains hashed entries and
  explicit engine/limit grants. `world-project-worker-tenant.mjs` prepares both.
- Worker create-upload/create-job/start support seven-day durable idempotency
  in the existing SQLite transaction. A retry returns current resource state,
  deleted/expired resources yield410, and cancelled work never restarts. Worker
  restart still records interrupted execution as failed; no automatic GPU rerun.
- Existing passcode/visitor sessions and self-reported Project Review decisions
  remain separate. A field trial is an attributed operator report, not a measured
  accuracy benchmark. `physical_validated` and `certified` remain false.
- Docs: `docs/world-project-platform.md`; public developer guide and OpenAPI;
  universal JS client `public/world/projects-client.mjs`; runnable Node example.
- Tests use production HTTP handlers and PostgreSQL SQL with PGlite locally,
  plus PostgreSQL17 and the full browser flow in `world-project-platform.yml`.
  `tests/world/project-processing-e2e.mjs` also exercises one named key through
  the real Python inspect worker, exact artifact retention, and both service
  restarts; a retry preserves one job. Its source data is an authored PNG.
  Local Chromium startup is blocked by this execution environment's UNIX socket
  policy; do not mistake that for an application result or disable the policy.

Before enabling customer access, provision production database backups and named
credentials, deploy the worker changes separately, assign dedicated worker
tenants, and qualify the intended robot/task at real sites. This release does
not add public signup, billing, webhooks, SSO, or a
certified autonomous robot deployment service.

## Large-source extension in PR321

- The owner requested that the next build go into the existing PR321.
- `worldProjectObjectStore.js` uses pinned AWS SDK v3 and a private configurable
  S3-compatible bucket. There is no production memory/disk fallback. The only
  in-memory adapter is in the test helpers.
- `worldProjectMedia.js` persists transfer reservations and parts in PostgreSQL,
  then stores immutable4MiB chunks under tenant/upload/part/hash keys. Lost
  acknowledgements and service restarts can resume by reading stored progress.
  Full client SHA256 is required before creation. Server verification reads every
  chunk and the entire-file SHA256 before atomically publishing one source,
  project version, event and idempotency receipt.
- Defaults:2GiB/source,8GiB/project,32GiB/tenant,4 active uploads,24h transfer
  lifetime and512 parts maximum. Smaller per-tenant limits are allowed. Hourly
  source-read reservations default to8GiB/tenant and include full verification,
  downloads and failed attempts; this is admission accounting, not billing.
- Upload creation reserves capacity but does not change project version. Final
  retention uses expected_version. A concurrent edit after verification leaves a
  ready upload for an explicit fresh-version retry. Incomplete/cancelled uploads
  cannot be used as project evidence.
- Authenticated content downloads stream through the application, verify every
  chunk, and hold the final chunk until the complete hash passes. Download
  ceiling is1hour with30s stalled backpressure; verification is bounded to5min.
  SDK sink downloads verify before close and abort a failed partial destination.
- Export schema is now `brainsnn.project-export.v2`: inline source bytes are
  embedded; large-source bytes are referenced by authenticated download paths.
  `includes_all_source_bytes` and `external_source_count` make completeness
  explicit. Neither bucket names nor internal object keys appear in the export.
- Configure `WORLD_PROJECT_S3_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`,
  `_SECRET_ACCESS_KEY`, optional `_ENDPOINT`, `_FORCE_PATH_STYLE`, `_SESSION_TOKEN`.
  An HTTPS endpoint and private access are required. Existing Railway preference
  is preserved; no production bucket, credentials or billing was changed.
- `npm run world:projects:storage` reports abandoned uploads; `-- --apply` cleans
  only expired/cancelled unretained chunks after10min grace. Schedule it hourly
  with the same private configuration. Exact key binding is checked before
  deletion. Coordinate PostgreSQL and object backups; provider durability,
  lifecycle/versioning and live restore behavior are not inferred from tests.
- SDK/browser hash support is a bundled local pinned `@noble/hashes` module;
  no external CDN and no full-file browser buffer. The workspace supports
  progress, Pause/Cancel, reselect-and-resume, and a bounded download fallback
  when the browser cannot stream to a chosen local file.
- Example: `examples/world-project-large-source.mjs`; guide:
  `docs/world-project-platform.md`. New media integration tests cover actual
  HTTP, PostgreSQL semantics, exact5MiB bytes, restart/transaction uncertainty,
  stale-version and cancellation races, isolation, corruption, quota and cleanup.
  Provider protocol qualification is a separate CI test; actual customer bucket
  provisioning and operational restore still precede launch.
