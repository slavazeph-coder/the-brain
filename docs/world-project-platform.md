# Durable World Projects and the developer API

World Projects connects the existing World Builder tools to durable, tenant-scoped site records. It stores source evidence, immutable revisions, explicit review decisions, and reported trial outcomes so the next deployment can reuse an accountable workflow.

This document describes the repository implementation. It does not establish that production is configured, a processing engine is available, or an actual site has passed a physical trial. Check the deployed service and complete the rollout exercises below before making those claims.

## What this release provides

- A PostgreSQL-backed project aggregate with monotonic versions and recorded actors.
- Exact retained source bytes, bounded to 512 KiB per source, with server-computed SHA-256.
- Immutable as-is and proposed revisions bound to retained source IDs, a robot profile, and a task.
- Evidence claims with a source locator, uncertainty, and separate review state.
- Change proposals with approval, implementation, and verification decisions. A new as-is baseline or rejection of dependent evidence makes earlier changes stale.
- A trial ledger that keeps physical and simulation records distinct and retains pass, fail, and inconclusive outcomes alongside the original prediction.
- Named, scoped, expiring API keys. Actor identity and permissions come from the server, not editable browser fields.
- A browser/Node SDK, OpenAPI 3.1 document, and runnable example.
- An optional authenticated processing bridge to an explicitly configured owner-scoped worker. Processing output keeps the worker's native schema and qualification limits.

It is a private operator-provisioned service. Public signup, browser session login, subscriptions, invoices, a general job scheduler, independently verified identities, and production field qualification are not supplied by these records.

## Entry points

| Surface | Location |
| --- | --- |
| Saved project workspace | `/world/projects.html` |
| API | `/api/world/v1` |
| SDK | `/world/projects-client.mjs` |
| OpenAPI contract | `/world/projects-api.openapi.json` |
| Node quickstart | `examples/world-project-api.mjs` |
| API implementation | `brainsnn-r3f-app/src/server/worldProjectService.js` |
| Durable store and schema | `brainsnn-r3f-app/src/server/worldProjectStore.js` |

The API returns server-assigned `X-Request-Id` headers. Failures use:

```json
{
  "error": {
    "code": "stale-version",
    "message": "The project changed. Reload it before submitting this action.",
    "request_id": "server-generated-id"
  }
}
```

`GET /status` is public and returns `available:false` when durable storage is not configured or cannot be reached. A 200 response alone does not mean storage is available. There is no production fallback to a process-local memory map.

The browser integration is same-origin; Node/server integrations use an absolute HTTPS API URL. A permissive third-party browser CORS policy is not part of this release. Do not put a project credential in a public webpage to work around cross-origin access.

## Configure and provision

Use a supported PostgreSQL service and configure `WORLD_PROJECT_DATABASE_URL`, falling back to `DATABASE_URL` when the dedicated variable is absent. `WORLD_PROJECTS_ENABLED=0` disables the service. Keep database credentials in the deployment's secret configuration.

The application and admin CLI initialize the namespaced `brainsnn_world_*` tables with idempotent `CREATE TABLE IF NOT EXISTS` statements. The configured database role therefore needs the necessary schema-creation permissions for this release. Initialization is not a general schema-version migration framework. Deployments that separate schema migrations from application credentials must arrange initialization before removing DDL permission and verify that the runtime initialization path succeeds with their chosen grants.

Do not assume that another product's existing database schema contains these tables. Take a backup before first initialization against an existing production database, then verify the new tables in a non-production database before rollout.

From `brainsnn-r3f-app`, provision the first tenant and named administrator:

```bash
npm run world:projects:admin -- --tenant-name 'Partner pilot' --actor-name 'Named administrator' --role admin
```

The CLI must run with the same database configuration as the application. It returns workspace/principal/key metadata and the one-time token to the operator terminal. Handle that output as a secret, move the token into the intended secret manager or private delivery channel, and avoid terminal/session recording. Do not paste a real token into a URL, issue, test fixture, repository file, or screenshot.

No email invitation is sent and no verified legal identity is established. A named principal represents the holder of the provisioned credential. Independent change review requires a different principal, but administrators can create principals; this is an auditable workflow control rather than external identity verification.

### Roles and scopes

| Role | Default scopes |
| --- | --- |
| `reader` | `project:read`, `processing:read` |
| `editor` | Reader scopes plus `project:write`, `processing:write` |
| `reviewer` | Editor scopes plus `review:decide` |
| `admin` | Reviewer scopes plus `keys:manage` |

An issued key can have a smaller scope set than its role. It cannot have scopes outside that role. Keys default to a 30-day expiry; the maximum explicit expiry is 366 days. A processing scope alone does not configure a worker or grant an engine.

### Issue, rotate, and revoke keys

1. Use `POST /keys` with a named actor, role, and optional narrower scopes/expiry, or the admin CLI.
2. Save the newly returned token securely. Key lists contain metadata, never the raw token or its digest.
3. When rotating an existing principal, provide its `actor_id` and the identical `actor_name`/role. The CLI uses `--tenant-id` and `--actor-id` for this purpose.
4. Verify the replacement with `GET /me` before revoking the old key.
5. Revoke the old key with `POST /keys/{key_id}/revoke` and an empty JSON body.
6. Confirm that the old key receives 401 and the replacement still works.

Key creation returns the secret only on the first successful response. Its idempotency record retains metadata and `token_available:false`, not the token. If that first response is lost, replay to identify the created key, revoke it using another valid administrator credential, and issue a replacement. Do not keep retrying in the expectation that plaintext will be recovered.

The browser SDK retains its key only in an instance closure. The workspace connection is memory-only; reloading requires reconnecting. Same-origin application code can still act with the connected user's permissions, so memory-only storage is not a substitute for ordinary application security.

## API workflow

All project mutations use POST, `Content-Type: application/json`, and an `Idempotency-Key` of 16–128 characters from `[A-Za-z0-9:_-]`. Every mutation of an existing project includes its current `expected_version`. A successful mutation increments that version and returns `{project, resource, applied_version}`. Creating a project returns `{project, applied_version}`. The resource is a compact action receipt; complete review/decision history is in the project aggregate.

| Action | Request | Scope |
| --- | --- | --- |
| Inspect identity | `GET /me` | Valid key |
| List/read project | `GET /projects`, `GET /projects/{id}` | `project:read` |
| Create project | `POST /projects` | `project:write` |
| Retain source | `POST /projects/{id}/sources` | `project:write` |
| Retrieve source bytes | `GET /projects/{id}/sources/{source_id}` | `project:read` |
| Create revision | `POST /projects/{id}/revisions` | `project:write` |
| Record evidence | `POST /projects/{id}/evidence` | `project:write` |
| Review evidence | `POST /projects/{id}/evidence/{evidence_id}/review` | `review:decide` |
| Propose change | `POST /projects/{id}/changes` | `project:write` |
| Decide change | `POST /projects/{id}/changes/{change_id}/decisions` | `review:decide`; implementation uses `project:write` |
| Record a trial | `POST /projects/{id}/trials` | `project:write` |
| Export aggregate and sources | `GET /projects/{id}/export` | `project:read` |
| Inspect usage | `GET /usage` | `project:read` |
| Manage key metadata/lifecycle | `GET/POST /keys`, `POST /keys/{id}/revoke` | `keys:manage` |

The current API lists at most 100 projects and does not accept pagination/query parameters on project routes. The processing bridge has its own native offset query for chunk upload.

### Retained evidence is exact and bounded

Supply exactly one of `content_text` or `data_base64`. Text becomes UTF-8 bytes; base64 must be canonical standard base64. The server computes the hash from the decoded bytes. If a `sha256` is supplied, it must match. Source retrieval returns `{source, data_base64}` so a client can recompute the digest and compare exact content.

This release stores source payloads as base64 in PostgreSQL. Current service caps are:

| Resource | Default service cap |
| --- | --- |
| Source | 512 KiB decoded bytes; nonempty |
| Sources per project | 128 |
| Total source bytes per project | 16 MiB |
| Total source bytes per workspace | 128 MiB |
| Projects per workspace | 100 |
| Revision/evidence/change/trial records per project | 1,000 combined |
| Project events | 2,000 |
| Retained key records | 100 |
| Authenticated requests | 1,200/hour per key |
| JSON request body | 1 MiB |
| Retained idempotency entries | 20,000 per workspace |
| Retained idempotency receipt bytes | 64 MiB per workspace |
| Reviews of one evidence item | 32 |

An operator can provision lower caps. Read `/status` and authenticated `/usage` instead of hard-coding entitlement assumptions. Usage counts are not an invoice or payment system. Exhausted limits return 429; they do not silently discard evidence.

Full walkthrough videos, dense meshes, and large point clouds do not fit the durable source endpoint. A small manifest is useful evidence of a processing result, but retaining that manifest does not retain the original video or make worker storage durable. Do not label temporary worker files as permanently saved project media.

### Revision and review meaning

A revision records `kind: as_is|proposed`, source IDs, a robot model/profile, and a task. A proposed revision must identify an existing as-is revision through `parent_revision_id`; a change proposal must use the current as-is baseline. A new as-is revision becomes the current baseline; earlier changes that depend on the previous baseline become stale. Existing revisions and trials remain available as history.

New evidence is `unreviewed`. Its `kind` is `measured`, `observed`, or `inferred`; this classification is an operator assertion. Measured evidence requires a finite numeric `value` and a nonempty `unit`. A locator must contain a page, frame, timestamp, or explanatory note. Record uncertainty and the independent measurement method in the source/claim where relevant. A confirmed label records a review decision; it does not cause the API to measure the world.

Change review follows these available transitions:

- `pending` → `approved` or `rejected`.
- `approved` → `implemented` or `rejected`.
- `implemented` → `verified`.
- A new baseline or rejected dependent evidence can make a change `stale`; make a new rebased proposal for further decisions.

Approval/rejection/verification requires a reviewer other than the proposer. Approval and verification also require every referenced evidence item to be confirmed. Verification additionally references the latest passing **physical** trial on the exact proposed revision, with confirmed measured evidence on that same revision and retained trial sources. That trial must have both occurred at or after the implementation decision and been recorded at a later project version. Simulation passes and pre-implementation trials cannot satisfy this condition.

Even then, the API keeps `physical_validated:false` and records the result as a credential-holder attestation. No physical trial is executed by storing a record. Readiness reports record completeness and unresolved reviews, not a robot safety decision. `trial-recorded` is not a certification.

Trial records require `kind: physical|simulation`, `prediction: pass|fail|unknown`, and `outcome: pass|fail|inconclusive`. Both `robot_model` and `task` must exactly match the immutable revision's robot model and `task.goal`. Record a new revision if the task changes. Records retain failures and inconclusive observations. `prediction_agreed` is null when the prediction is unknown or the outcome inconclusive; that is not counted as a successful prediction.

Readiness uses the latest physical outcome for the current revision, ordered by `occurred_at` and then recorded project version. An earlier pass cannot hide a later failure or inconclusive result. The latest pass also needs linked, confirmed measurement evidence for that revision. A later failed/inconclusive physical trial can make an earlier verified change stale. Trial records expose `recorded_project_version`; change decisions expose `project_version` so the sequence is inspectable.

### Explicit retries and conflicts

Use the same idempotency key and unchanged body for a retry after a lost response. The project service binds that key to the tenant, actor, HTTP method, path, and canonical body, and persists a compact action receipt in the same transaction as the mutation. The same key with different intent returns 409. Do not generate a new key just because a request timed out: the first action may already have committed.

A replay returns the original compact resource and `applied_version`, together with the **current** project aggregate. Those versions may differ because another action happened after the original submission. Inspect the current state before preparing new work. A stale `expected_version` requires a fresh read and a consciously rebuilt action with a **new** key; the SDK does not silently overwrite or increment the version.

```javascript
import { createProjectsClient } from '/world/projects-client.mjs';

const client = createProjectsClient({ apiKey: keyEnteredForThisSession });
const { project } = await client.getProject(projectId);
const submission = client.prepareMutation('addEvidence', [project.id, {
  expected_version: project.version,
  revision_id: revisionId,
  source_id: retainedSourceId,
  kind: 'observed',
  claim: 'The source shows the entrance with the door closed.',
  locator: { frame: 42 },
  uncertainty: 'Clear width still needs independent measurement.'
}]);

const saved = await submission.run();
// If the response was lost, a user-triggered retry may call submission.run()
// again. Its body/key stay fixed even if the original form was edited.
// After a stale-version conflict: refresh, rebuild, and prepare a NEW action.
```

Direct methods also accept `{idempotencyKey, signal, timeoutMs}` after their body. If the caller omits a key, the SDK creates one for that invocation; it cannot infer that a later separate method call is intended as a retry. Prefer `prepareMutation` for UI submissions. `ProjectsApiError` exposes `code`, `status`, `requestId`, and `idempotencyKey`. There are no automatic retries, credential logs, or key-bearing URLs. JSON responses default to a 64 MiB ceiling to accommodate bounded project exports; callers can configure a smaller `maxResponseBytes`.

## Optional processing bridge

Configure both `WORLD_WORKER_INTERNAL_URL` and `WORLD_PROJECT_WORKER_TOKENS_JSON`. The latter is a secret JSON object mapping project tenant IDs to dedicated owner-scoped worker bearer tokens. Project tenant IDs are opaque IDs, not necessarily UUIDs. Do not use a shared legacy/operator credential. The bridge verifies the worker owner ID against the authenticated project tenant and refuses mismatches.

Explicitly grant the intended engines and quotas in the worker tenant registry. Possessing `processing:write` does not bypass worker engine grants. Before permitting writes, deploy the worker revision that supports persistent idempotency; the bridge rejects writes to older workers. The website and worker are separate deployables.

From `brainsnn-r3f-app`, `npm run world:projects:worker -- TENANT_ID ENGINE[,ENGINE] STORAGE_BYTES` generates a website mapping named `WORLD_PROJECT_WORKER_TOKENS_JSON` and a worker mapping named `WORLD_PROJECT_WORKER_TENANTS_JSON`. Its output contains a website-side secret; capture it only through a private operator workflow. The worker mapping contains the credential hash and explicit engine/limit grants. Merge mappings with existing entries rather than replacing other tenants. The worker deployment helper merges this additional registry with its existing site owners. Inspect and verify the actual worker capability response after rollout.

| Route relative to `/api/world/v1/processing` | Methods |
| --- | --- |
| `/capabilities` | GET |
| `/uploads` | POST |
| `/uploads/{id}` | GET, PUT with `?offset=…`, DELETE |
| `/jobs` | GET, POST |
| `/jobs/{id}` | GET, DELETE |
| `/jobs/{id}/start` | POST |
| `/jobs/{id}/ticket` | POST |
| `/jobs/{id}/artifacts` | DELETE |
| `/download/{ticket}` | GET, HEAD |

The OpenAPI contract includes these processing routes and the bounded native upload/job/ticket request schemas. Successful worker responses remain extensible native objects; engine names and available features come from the capabilities response. Check capabilities before choosing an engine. Upload creation, job creation, and start requests use stable idempotency keys; worker entries are retained for seven days. A conflicting replay returns 409; replaying a deleted resource returns 410. A replay does not restart a failed job. Read its current status and make an explicit decision about any new work.

Upload chunks use the native offset contract. A lost PUT response should be resolved by reading the upload offset before explicitly sending remaining bytes. The SDK does not automatically resend chunks. Processing rate/concurrency bounds and owner quotas are operating controls, not durable subscription billing.

The bridge allows at most 16 active processing requests across the site process,
four per tenant, and 120 requests per minute per tenant. These process-local
admission limits supplement the durable API-key hourly quota and worker storage,
engine and active-job limits. Each downloaded artifact must declare its exact
length; incomplete streams are terminated. The SDK also verifies its manifest hash.

```javascript
const capabilities = await client.processingRequest('/capabilities');
// Select only an engine marked available and explicitly permitted to this owner.

const bytes = await client.processingDownload(ticket.url, {
  sha256: artifact.sha256,
  expectedBytes: artifact.size,
  maxBytes: 512 * 1024
});
```

`processingRequest(path, options)` accepts native JSON and raw PUT upload bytes. `processingDownload` keeps the request inside the configured API origin/base path, sends the project key in a header, enforces a byte bound, and checks the required artifact SHA-256. Its default maximum is 512 KiB; callers can explicitly raise it to at most 64 MiB. The server's streaming bound can be larger; the SDK intentionally does not load gigabyte files into browser memory. Downloads still need authentication; do not expose worker token URLs as public share links.

The bridge does not extend the worker's existing upload/artifact retention time. Only a source explicitly retained through the project endpoint becomes part of this durable evidence store.

## Run the example

From the repository root, use a named editor/reviewer/admin project key and the running API URL:

```bash
export WORLD_PROJECT_API_URL='http://127.0.0.1:3000/api/world/v1'
read -rsp 'Project API key: ' WORLD_PROJECT_API_KEY
export WORLD_PROJECT_API_KEY
node examples/world-project-api.mjs
unset WORLD_PROJECT_API_KEY
```

The example creates an explicitly authored fixture project, retains and re-downloads exact source bytes, creates an immutable revision, records an unreviewed claim, adds an inconclusive simulation-labelled example record, and exports the aggregate. It deliberately performs no physical measurement or simulator execution and cannot qualify the site. Running it again creates a new labelled example project; it is not a hidden production data import.

## Verification before a partner rollout

Run focused repository tests for project persistence/authorization, the SDK, the workspace UI, and the processing bridge. The SDK test entry is:

```bash
node --test tests/world/projects-client.test.mjs
```

For deployment acceptance, exercise a real PostgreSQL service through the actual application process:

1. Create two tenants and multiple named principals. Confirm that keys cannot read, mutate, export, or infer another tenant's project/source records.
2. Save a source containing non-ASCII text and arbitrary binary bytes. Re-download and compare both exact bytes and SHA-256.
3. Submit an action, drop its response, and retry with its original key/body. Confirm one record/event and a replayed result. Confirm that changing the body with that key returns 409.
4. Make concurrent changes from the same starting version. Confirm exactly one succeeds and the stale action cannot overwrite it.
5. Stop the application, restart it against the same database, and verify the project, sources, decisions, trial failures, and idempotency result survive. Repeat a read after a database service restart. A local in-process database test alone does not establish deployment persistence.
6. Disconnect PostgreSQL. Confirm `available:false` and failed authenticated writes, with no apparent success or new local store.
7. Exercise least-privilege reads/writes, expired/revoked keys, independent change review, stale proposals, and the difference between a simulated and physical verification record.
8. If processing is enabled, verify distinct owner credentials, an actual granted engine, chunk resume after a lost response, idempotent job creation/start, and an authenticated hash-checked artifact download.
9. Check that ordinary server/proxy/access logs, browser storage, exports, and error diagnostics contain no raw API or worker keys.

### Backup, restore, and retention

Use database-managed backups and a restore procedure for the `brainsnn_world_*` tables. Treat source content, operator notes, and key digests as tenant data when deciding access and retention. This feature does not configure backups, retention automation, erasure requests, point-in-time recovery, or disaster-recovery objectives for the operator.

Restore a backup to an isolated database and verify project versions, source hashes, audit history, key revocation state, and idempotency entries together. Restoring an older snapshot can restore older authorization state; keep access closed until current revocations and expirations are reconciled. Record the recovery point and outcome. Never treat a downloaded project export alone as a full database/security-state backup.

The export includes exact retained sources and an unsigned canonical content hash. That can reveal modified bytes. It does not prove the original actor's identity, the truth of a claim, or survey accuracy.

## Next product milestones

The release needs a paid field pilot using a real capture, independently checked dimensions, a specific robot, and observed deployment outcomes. Track analyst minutes, failed captures, prediction errors, repeated customer use, and per-assessment operating cost. A complete record is useful evidence for that pilot; it is not its result.

The next storage improvement should be owner-scoped object storage for large originals, with resumable upload, declared length/hash checks, retention and deletion policy, source-to-revision links, private retrieval, restore verification, and versioned manifests. Do not raise the database payload limits to accommodate whole walkthroughs.

The next developer improvements should follow actual partner use: a pinned example with a supported engine, schema compatibility tests, controlled job cancellation/recovery, reliable webhook or polling behavior, and one downstream integration that the chosen OEM supports. Scope a public self-service account/billing system after the private workflow produces repeat usage.
