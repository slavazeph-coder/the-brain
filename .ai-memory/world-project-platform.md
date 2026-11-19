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
  source bytes are limited to512KiB each and16MiB/project in this first release.
  The full export includes retained bytes; a worker job ID alone is not retention.
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
not add public signup, billing, large-object retention, webhooks, SSO, or a
certified autonomous robot deployment service.
