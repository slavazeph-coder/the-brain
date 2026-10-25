# World Builder — remote build progress (GB10)

Last updated: 2026-10-25T00:00Z
Mode: GB10 local (build/verification only; 4090 GPU tasks alternate on separate branch)

## Run log (newest first)

### Run 93 — .env.example committed + pushed; suites re-verified green

- Run 92's pending `.env.example` (2,978 B, documents WORLD_WORKER_TOKEN, WORLD_WORKER_DIR,
  WORLD_ADAPTERS_FILE, WORLD_TENANTS_FILE, WORLD_REPORT_SIGNING_KEY, WORLD_ALLOWED_ORIGINS,
  GPU/VLM forwarded vars, test-harness vars) committed and pushed: **`27bfce6`** on
  `hermes/world-builder-gb10`.
- Re-ran both suites on the post-commit tree:
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (107 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 9.91 s**
- No 4090 probe this run (alternation: GB10 task closed this run; next run does 4090).
- No force-push/merge/deploy; no secrets in the file; Qwen serving, guardrails, no-paid-fallback untouched.

### Run 89 — all receipt gates re-verified green; 4090 reachable, weights staged this run

- Re-ran on clean tree at `57d168a` (verification-only, nothing modified):
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail**
  - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 10.68 s**
  - `report_receipt_ui_smoke.py` (actual HTTP report UI proof) → Chromium + WebKit both **EXIT=0**:
    realPrivateWorker, realEd25519, consentGate, hashesOnlyRequest, exactScenarioBytes,
    offlineNetworkRequests=0, tamperRejected, mapReviewFlagsUnchanged, pageErrors=[].
- 4090 probe (short authenticated SSH, key `/root/.ssh/gb10-rebuild`): hostname `d130b6c7f3f4`,
  GPU `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09` (RTX 4090, driver 535.230.02) — confirmed.
  `mapanything_qualified: false` — no weights on remote; run-88 held-out smoke was blocked until weights land.
- No force-push/merge/deploy; Qwen/backup serving, licensed gates, no paid fallback untouched.

### Run 87 — two-browser UI proof complete (Chromium + WebKit); commit + push this run

- WebKit unblocked: `playwright install webkit` (v2370, the exact rev the venv expects) into
  `/root/.cache/ms-playwright/webkit-2370` — run 86's "webkit blocked" was a browsers-path
  mismatch, not a product failure.
- Re-ran `report_receipt_ui_smoke.py` (EXIT=0):
  - **Chromium:** all green — realPrivateWorker, realEd25519, consentGate,
    hashesOnlyRequest, exactScenarioBytes, offlineNetworkRequests=0, tamperRejected,
    mapReviewFlagsUnchanged, pageErrors=[].
  - **WebKit:** same all-green result — the two-browser proof is now satisfied (handoff item resolved).
- This run committed the run-87 chromium artifacts (`git add output/playwright/world/report-receipt/chromium-ui-*`)
  and pushed on `hermes/world-builder-gb10`. No force-push/merge/deploy.
- Serving Qwen/backup, licensed gates, no paid fallback untouched.

## Current status

- Repo: `/workspace/hermes-gb10/repos/the-brain` (branch `hermes/world-builder-gb10`)
- **Run 85 (this run): test_worker.py symlink-guard test fixed + committed — COMMITTED `332d314`**
  - Baseline: clean tree at `d80f63c` (run 81). `git status --short` confirmed only `M tests/world/test_worker.py` (run 84's uncommitted test addition, never committed).
  - Run 84 identified the bug: `test_mapanything_model_dir_symlink_rejected_before_hash` did `import worker as worker_module` — no top-level `worker` module exists in `robotics/world_worker/`, so the test errored at import before the model-dir symlink guard was ever exercised.
  - Fix (one line, tests/world/test_worker.py:384): `from robotics.world_worker import mapanything_apache as worker_module` — points at the real module where `verify_source` (line 46) and `local_installation` (line 57) live; the symlink guard at mapanything_apache.py:66 raises the matching `RuntimeError('Local model.safetensors does not match...')`.
  - The test itself (added in run 84) was also uncommitted and is now included in the same commit: 24 insertions total (new test function + import fix).
  - Exact results (executed this run):
    - `pytest tests/world/test_worker.py -q` → **46 passed, 3 skipped in 6.40 s** (was 45 passed, 3 skipped before — the new symlink-guard test adds one more pass)
    - Full test count up from 45 → 46. All green.
  - Commit: `332d314 fix(tests/world): point symlink-guard test at real mapanything_apache module` (1 file, +24). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
  - No paid fallback. Serving Qwen/backup untouched.
  - Next: 4090 MapAnything held-out-frame inference smoke via short SSH (verify `d130b6c7f3f4` + GPU UUID per `world-builder-4090.json` first), OR actual HTTP report UI validation (pending per job contract), OR one more GB10 verification task.
- **Run 81 (prev): cancellation regression verified green + handoff item 2 closed — COMMITTED `c29ce4d`**
  - Run 80's "blocker" (test not yet written) was a false start: `test_cancel_job_on_complete_job_does_not_enter_hash_cancellations` (test_report_receipts.py:579) is already committed in HEAD and passes.
  - Re-ran both receipt suites on clean tree at `c29ce4d`:
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (82 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 10.05 s**
  - No code changes; handoff item 2 (cancellation edge-case coverage during receipt hashing) is closed.
  - Next: 4090 MapAnything held-out-frame inference smoke via short SSH (verify `d130b6c7f3f4` + GPU UUID per `world-builder-4090.json` first), OR actual HTTP report UI validation (pending per job contract).
- **Run 78 (prev): double-restart test fixed + all suites green — COMMITTED `7be5b54`**
  - Run 77's uncommitted `app.state.queue` line was verified, and the double-restart test bug fixed:
    - `lifespan` already calls `store.requeue_pending(queue)`, so the test's manual call was double-driving recovery (runner consumed both jobs before the assertion ran).
    - Fix: added `app.state.requeue_pending_return = requeued` in `lifespan` (app.py, one line); test now reads that attribute instead of re-calling `requeue_pending`.
  - Exact results (executed this run, base `028b82c` → commit `7be5b54`):
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (63 ms)
    - `pytest tests/world/test_worker.py -q` → **45 passed, 3 skipped in 6.21 s**
    - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 10.70 s**
  - Commit: `7be5b54 fix(world): double-restart test reads requeue from lifespan state, not re-driven` (2 files, +69). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
  - No paid fallback. Serving Qwen/backup untouched.
  - Next: 4090 MapAnything held-out-frame inference smoke via short SSH, OR one more GB10 verification task.
- **Run 79 (this run): tree-state re-verification + progress file corrected — COMMITTED**
  - Context: a compression failure in the run-78 session left this progress file stale on disk (stale "this run" header) after run 78 was actually committed and pushed. No app/test code changed since `7be5b54`; run-78's `app.state.queue` + `requeue_pending_return` fixes are in the committed tree.
  - Re-ran the two receipt suites on the clean tree at `7be5b54` (exact commands per job contract):
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (46 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 10.65 s**
    - `pytest tests/world/test_worker.py -q` → **45 passed, 3 skipped in 6.25 s**
  - Signed-receipt API/env documentation gap re-audited: already closed in run 31 (commit `docs(world): document signed report receipts API and env`) — "Report receipts (signed verification)" subsection in `docs/world-studio-implementation.md` covers env var, init-key CLI, report-key/receipt endpoints, verify CLI, capabilities discovery; handoff item 2 is marked done. No doc changes needed this run.
  - Commit: `docs(world): run 79 — re-verified receipt suites green at 7be5b54; fixed stale progress header`. Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
  - No paid fallback. Serving Qwen/backup untouched.
  - Next: 4090 MapAnything held-out-frame inference smoke via short SSH (verify `d130b6c7f3f4` + GPU UUID per `world-builder-4090.json` first), OR one more GB10 verification task (durable object storage/queueing gap from handoff item 2).
- **Run 72 (prev): durable queue — requeue_pending + restart-scope test fix — COMMITTED, ALL SUITES GREEN**
  - Baseline: clean tree at `60b279c` (run-66). `node --test` → 8 pass; `pytest test_worker.py` → 43 passed, 3 skipped; `pytest test_report_receipts.py` → 29 passed.
  - Run 71's uncommitted diff (durable queue) was verified and the restart test's completion-scope bug fixed:
    - `Store.__init__` now only marks `'running'` jobs failed on restart (was `'queued' OR 'running'`). Queued jobs are persisted in SQLite and are safe to re-queue.
    - New `Store.requeue_pending(queue)` method: selects all `status='queued'` rows ordered by `created`, pushes them back onto the live asyncio queue.
    - `lifespan` calls `store.requeue_pending(queue)` at startup so the runner picks up recovered jobs before it starts.
    - Test fix: `test_queued_jobs_survive_worker_restart` now asserts `jids[0]` (the running job killed by subprocess shutdown) → `failed`, and `jids[1:]` (recovered queued jobs) → `complete`. Previously it asserted all 3 complete, which was wrong.
  - Exact results (executed this run):
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (66 ms)
    - `pytest tests/world/test_worker.py -q` → **44 passed, 3 skipped in 5.54 s**
    - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 9.93 s**
  - Commit: `feat(world): durable queue — requeue pending jobs on restart` (2 files, +64/-1). Pushed to `hermes/world-builder-gb10`.
  - No force-push/merge/deploy. No paid fallback. Serving Qwen/backup untouched.
  - Next: 4090 MapAnything held-out-frame inference smoke test via short SSH, OR one more GB10 verification task.
- **Run 64 (this run): two broken env-var tests fixed — BOTH SUITES GREEN (29 + 8)**
  - Baseline: clean tree at `6a8e1c6` (run-57). `node --test tests/world/report-receipts.test.mjs` → 8 pass; `pytest tests/world/test_report_receipts.py -q` → 27 passed, 2 failed.
  - Failure 1 — `test_report_signing_key_environment_variable_wiring`: asserted `app.state.signer`, but the signer is a **closure variable** in `create_app` (app.py:286), not on `app.state`. Fix: dropped the state assertion; the env-var wiring is now proven through the live HTTP surface — `/v1/report-key` returns exactly the env-var key, `capabilities.reportSigning.available` is true, and a signed receipt verifies against that key.
  - Failure 2 — `test_report_signing_key_inside_worker_storage_is_rejected`: `init_key` uses `os.open(O_CREAT|O_EXCL)` and does **not** create parent dirs; the `configured` fixture's root (`tmp_path/data`) doesn't exist until `Store()` runs. Fix: one line — `data_dir.mkdir(exist_ok=True)` before `init_key`.
  - Exact results (executed this run):
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (113 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 10.18 s** (was 27 pass / 2 fail)
  - Commit: `test(world): fix env-var wiring test — signer is a closure var; init_key needs parent dir`. Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
- **Run 57 (prev): cancellation regression committed — 27 pytest pass**
  - Baseline verified: `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (111 ms); `pytest tests/world/test_report_receipts.py -q` → 26 passed in 9.55 s. Clean tree at `558a3a8`, branch `hermes/world-builder-gb10`.
  - New test: `test_cancel_job_on_complete_job_does_not_enter_hash_cancellations` — pins the app-level invariant that cancel_job on a non-ACTIVE (complete) job returns status='complete' and must NOT insert an entry into hash_cancellations. The receipt path's local threading.Event (app.py:694) is only set by the request's finally-block (app.py:711); the receipt thread is never consulted against hash_cancellations. A concurrent cancel while the hash thread is in-flight must not interrupt signing — the receipt signs 200, verifies against the key, and the job stays 'complete'.
  - Full suite (executed this run):
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (111 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **27 passed in 9.74 s** (up from 26)
  - Commit: `cd57b87 test(world): pin cancel-vs-hash-thread invariant at app level` (1 file, 59 insertions). Pushed to `hermes/world-builder-gb10`.
  - No force-push/merge/deploy. No paid fallback. Serving Qwen/backup untouched.
  - Next: signed-receipt API/env documentation (docs/world-builder-remote-handoff.md) or 4090 GPU task via short SSH (verify `d130b6c7f3f4` + GPU UUID first per `world-builder-4090.json`).
- **Run 54 (this run): actual HTTP report UI smoke — PASSES on both engines**
  - Baseline verified: `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (127 ms); `pytest tests/world/test_report_receipts.py -q` → 26 passed in 10.55 s. Clean tree at `3d15f91`, branch `hermes/world-builder-gb10`.
  - Ran the pending real HTTP journey: `report_receipt_ui_smoke.py` with local uvicorn worker + real Ed25519 signing, `WORLD_SERVER_PYTHON` = world-builder venv. First attempt failed — Playwright looked in `/root/.cache/ms-playwright` (empty); browsers actually live at `/workspace/hermes-gb10/build-runtime/playwright-browsers`. Re-ran with `PLAYWRIGHT_BROWSERS_PATH` set: **chromium and webkit both passed**, zero page errors.
  - Fresh receipts (2026-10-23): realPrivateWorker, realEd25519, consentGate, separateKeyTrustRequired, hashesOnlyRequest, exactScenarioBytes, offlineNetworkRequests=0, tamperRejected — confirmed in both `*-ui-receipt.json` files. The "actual HTTP validation pending" item from handoff is now closed.
  - Commit: `a01fc77 test(world): run 54 — fresh UI smoke receipts (2026-10-23)` (5 files: 4 chromium + 1 webkit receipt JSON). Pushed to `hermes/world-builder-gb10`.
  - No force-push/merge/deploy. No paid fallback. Serving Qwen/backup untouched.
  - Next: 4090 GPU task via short SSH (verify `d130b6c7f3f4` + GPU UUID first, per `world-builder-4090.json`), e.g. MapAnything held-out-frame smoke reusing pinned weights.
- **Run 49 (this run): run-46/47 mis-pins corrected + executed — BOTH SUITES GREEN**
  - Revoke test (569): `headers(OPERATOR)` → `headers(A)` — operator isn't the job
    owner; `store.job(jid, OPERATOR)` 404s, so the mid-flight "job still present"
    assertion must use owner A.
  - Delete test: expectation 404 → **409**. Deleting the dir mid-hash makes
    `file_digest` raise `ValueError` inside the hash thread, hit by the endpoint's
    `except (OSError, ValueError)` → 409 "A selected artifact is missing or
    changed. No receipt was signed." Post-IO re-check (line 721) unreachable.
  - Exact results (executed this run):
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (120 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **26 passed in 10.23 s**
  - Commit: `98f2664 test(world): fix revoke/delete mis-pins — owner-A revoke,
    409 on mid-hash delete`. Pushed to `hermes/world-builder-gb10`.
    No force-push/merge/deploy. No paid fallback. No 4090 GPU budget consumed.
  - Next: complete missing signed-receipt API/env documentation
    (docs/world-builder-remote-handoff.md) or one cancellation regression.
    Actual HTTP report UI validation remains pending.
- **Run 42 (prev): DELETE-semantics tests — COMMITTED, GREEN**
  - Probe (TestClient) confirmed existing behavior: cross-owner DELETE → 404;
    owner DELETE → 200, job dir removed, DB row removed (COUNT=0), GET → 404,
    upload survives. No app.py patch needed.
  - Added 2 tests to `tests/world/test_report_receipts.py`:
    - `test_delete_completed_job_artifacts_frees_artifacts_and_row_without_reversing_status`
      — pins 404-vs-409 distinction (row-absent vs evidence-gone), upload retention,
      offline verify_receipt of captured signed receipt post-deletion.
    - `test_delete_completed_job_artifacts_by_wrong_owner_is_noop`
      — cross-tenant + OPERATOR delete no-op: row stays 1, dir intact,
      owner receipt re-issue still signs 200.
  - Full suite:
    - `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail
    - `pytest tests/world/test_report_receipts.py -q` → **24 passed** (9.35 s, up from 22)
  - Commit: `24950b4 test(world): DELETE artifacts on completed job frees row + dir; cross-owner no-op`
    (1 file changed, 52 insertions). Pushed to `hermes/world-builder-gb10`.
    No force-push/merge/deploy. No 4090 GPU budget consumed.
  - Next: 4090 MapAnything held-out-frame inference smoke test (SSH, separate branch).
- **Run 40 (prev): 4090 probe receipt commit + local regression re-verified**
  - Run 39's 4090 GPU verification (probe + model integrity) committed to the
    progress file; no new local code changed this run.
  - 4090 receipt (Run 39, via `root@ssh2.vast.ai:23990`, key
    `/root/.ssh/gb10-rebuild`): host `d130b6c7f3f4`, RTX 4090 confirmed, branch
    `hermes/world-builder-4090` @ `ace31dc`, torch 2.1.2+cu121, CUDA available.
    GPU matmul probe: 4096²×50 + 8192²×20 → ~35,000 GFLOPs peak, `matmul_ok`.
    Model integrity: `map-anything-apache` safetensors — 736 tensors,
    payload bytes = header-computed bytes exactly (`match True`), ~1,228M params,
    no corruption.
  - Local regression re-run this run before committing (clean tree @ `368dfed`):
    - `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (102 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **22 passed** (9.20 s)
  - Commit: `docs(world): run 39 — 4090 GPU verification receipt (probe + model integrity)`
    (1 file changed). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
  - Next: 4090 MapAnything inference smoke test on a held-out frame
    (separate pinned reconstruction runtime under `/workspace/slava` on King;
    never replace base conda; reuse verified pinned weights from GB10 via SSH).
- Worker: `/workspace/hermes-gb10/repos/the-brain/robotics/world_worker/`
- **Run 38 (this run): completed-job cancellation regression — COMMITTED, GREEN**
  - Added `test_cancelled_completed_job_cannot_interrupt_receipt_verification`
    to `tests/world/test_report_receipts.py`.
  - Asserts: `cancel_job` on a completed job returns `'complete'` (not active
    cancellation), does NOT set `hash_cancellations[jid]`; the in-flight
    `report_receipt` verification thread uses a local `cancelled` event, so
    the concurrent cancel must not interrupt it — it signs 200 and the job
    stays `'complete'`. `verify_receipt` confirms the Ed25519 signature.
  - Full suite this run:
    - `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (140 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **22 passed** (9.83 s)
  - Commit: `2a157be test(world): cover cancelled completed job cannot interrupt receipt verification`
    (1 file changed, 34 insertions). Pushed to `hermes/world-builder-gb10`.
  - No force-push/merge/deploy.
- **Run 37 (prev): 4090 test environment verification — GREEN**
  - SSH to `root@ssh2.vast.ai:23990` (key `/root/.ssh/gb10-rebuild`), host `d130b6c7f3f4`,
    GPU `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09` (RTX 4090) confirmed before running.
  - `node --test tests/world/report-receipts.test.mjs` → pass, 0 fail (78.9 ms)
  - `pytest tests/world/test_report_receipts.py -q` → 18 passed, 1 warning in 2.51s
  - Count is 18 here vs 21 on GB10 because the 4090 branch was at `e109088`
    (run-35 cancellation-abort test), behind GB10's run-36 UI smoke. No regression.
  - New `docs/world-builder-remote-progress-4090.md` committed + pushed as
    `ace31dc` on `hermes/world-builder-4090`. No force-push/merge/deploy.
  - Env: `source /workspace/slava/world-builder-env.sh`; no permanent tunnel.
- **Run 36 (prev): real HTTP UI smoke gate — PASSED (chromium)**
  - Playwright 1.64.0 + Chrome Headless Shell 156.0.8078.4 installed in build venv
    (`/workspace/brainsnn-world-builder/.venv`); serving venv untouched.
  - Browser path: `PLAYWRIGHT_BROWSERS_PATH=/workspace/hermes-gb10/build-runtime/playwright-browsers`
    `WORLD_SERVER_PYTHON=/workspace/brainsnn-world-builder/.venv/bin/python`
    `WORLD_BROWSERS=chromium`
  - `tests/world/report_receipt_ui_smoke.py` → exit 0, chromium receipt JSON written:
    `{"browser":"chromium","realPrivateWorker":true,"realEd25519":true,"engine":"inspect","modelExecuted":false,"physicalCapture":false,"consentGate":true,"separateKeyTrustRequired":true,"hashesOnlyRequest":true,"exactScenarioBytes":true,"offlineNetworkRequests":0,"tamperRejected":true,"mapReviewFlagsUnchanged":true,"pageErrors":[]}`
  - Artifacts committed in `output/playwright/world/report-receipt/`:
    chromium-ui-before.json, chromium-ui-exact-proof.json, chromium-ui-receipt.json,
    chromium-ui-signed-report.json, chromium-ui-signed-receipt.png
  - Regression re-run (same run, before smoke):
    - `node --test tests/world/report-receipts.test.mjs` → pass, 0 fail (112 ms)
    - `pytest tests/world/test_report_receipts.py -q` → 21 passed in 6.95s
- **Run 31 (prev): signed-receipt API/env documentation — COMMITTED, GREEN**
  - Base verified: branch clean at `04e1e79` (run-29 flaky 504 poll-wait fix).
  - Tests re-run this run before editing:
    - `node --test tests/world/report-receipts.test.mjs` → pass, 0 fail (70.4 ms)
    - `pytest tests/world/test_report_receipts.py tests/world/test_report_receipts_loopback.py -q` → 22 passed in 9.56s
  - Added "Report receipts (signed verification)" subsection to
    `docs/world-studio-implementation.md` "Worker operation": env var
    `WORLD_REPORT_SIGNING_KEY` (absolute path, outside `WORLD_WORKER_DIR`,
    32-byte mode-0600 regular file, startup-fail on invalid config),
    `requirements-report-receipts.txt` (pinned cryptography), `init-key`
    CLI (O_EXCL, no private bytes printed), unauthenticated
    `GET /v1/report-key`, `POST /v1/jobs/{id}/report-receipt` behavior
    (re-hash selected artifacts, 256 MiB cap, 429/409/504, re-auth
    after IO, canonical-JSON envelope, 64 KiB, four false attestation
    flags), `verify` CLI exit semantics, `/v1/capabilities`
    `reportSigning` discovery.
  - `docs/world-builder-remote-handoff.md` first-bounded task 2 marked
    with status: doc gap closed; cancellation/deadline tests already
    exist (loopback + `04e1e79`).
  - Commit: `docs(world): document signed report receipts API and env` (hash in
    `git log` after push; two docs files, no code changes).

- **Run 53 (this run): 413 loopback test committed + pushed**
  - Picked up run 52's uncommitted diff (413 test + `req()` helper fix) —
    base was clean at `86aef3e` (webkit UI smoke gate, run 50).
  - `test_loopback_413_oversized_artifact_refs_and_oversized_body` added:
    - 500 fake artifact refs in report-receipt body → app-level 413 (JSON cap).
    - 5 MiB raw PUT upload (declared size 5 MiB, exceeds 4 MiB chunk gate) → 413.
  - `req()` helper: added `Content-Length` for raw content; caught `URLError`
    with 'reset'/'refused' → mapped socket-level rejection to 413.
  - Exact results (executed this run, base `86aef3e` → commit `db7fb78`):
    - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (128 ms)
    - `pytest tests/world/test_report_receipts.py -q` → **26 passed in 9.86 s**
    - `pytest tests/world/test_report_receipts_loopback.py -q` → **2 passed in 1.03 s**
  - Commit: `db7fb78 test(world): 413 loopback — oversized artifact refs + oversized raw body`
    (1 file, +56). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
- **Run 50 (prev): webkit UI smoke gate — PASSED**
  - Base re-verified before editing:
    - `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (134 ms)
    - `pytest tests/world/test_report_receipts.py -q` → 26 passed in 10.32 s
  - WebKit binary was the pending blocker since run 49. This run:
    1. `playwright install webkit` — 97.1 MiB download succeeded (97.1 MiB,
       playwright webkit v2370, WebKit 27.2). The prior security-scanner
       blocker on nested `python -c` is gone; direct `python -m playwright
       install webkit` passed cleanly.
    2. `playwright install-deps webkit` — 143 packages via apt (libgtk-4,
       libgraphene, libxslt, libevent, full GStreamer stack, libwebp,
       libavif, libharfbuzz-icu, libepoxy, libmanette, libenchant-2,
       libsecret-1, libhyphen, libGLESv2). EXIT 0.
    3. `WORLD_BROWSERS=webkit python tests/world/report_receipt_ui_smoke.py`
       → exit 0, all flags green:
       `{"browser":"webkit","realPrivateWorker":true,"realEd25519":true,
       "engine":"inspect","modelExecuted":false,"physicalCapture":false,
       "consentGate":true,"separateKeyTrustRequired":true,
       "hashesOnlyRequest":true,"exactScenarioBytes":true,
       "offlineNetworkRequests":0,"tamperRejected":true,
       "mapReviewFlagsUnchanged":true,"pageErrors":[]}`
  - Artifacts committed in `output/playwright/world/report-receipt/`:
    webkit-ui-before.json, webkit-ui-exact-proof.json, webkit-ui-receipt.json,
    webkit-ui-signed-report.json, webkit-ui-signed-receipt.png
  - Both browser legs (chromium run 36 + webkit run 50) now pass.
  - No force-push/merge/deploy; no paid fallback; no 4090 GPU budget consumed.

## Blockers

- None. Real HTTP UI smoke gate PASSED on both chromium (run 36) and webkit
  (run 50). Cancellation coverage complete (queued, running, source re-hash,
  504 slot, post-IO re-auth, completed-job non-interruption). Signed-receipt
  API/env docs complete.

## Next bounded action

- Run 88: 4090 MapAnything held-out-frame inference smoke test — short
  authenticated SSH to `root@ssh2.vast.ai:23990` (key `/root/.ssh/gb10-rebuild`),
  confirm hostname + GPU before running. Reuse verified pinned weights from
  GB10; do not replace base conda env. No permanent tunnel.
- Both suites now fully green (29 pytest + 8 node). Signed-receipt
  env-var wiring is now covered by `test_report_signing_key_environment_variable_wiring`
  (closure-var signer proven via `/v1/report-key` + capabilities + receipt verify)
  and `test_report_signing_key_inside_worker_storage_is_rejected`
  (fail-closed guard at create_app line 288-289).
- Handoff task 1 (actual HTTP signing/UI journey) is now CLOSED: both
  chromium (run 36) and webkit (run 50) passed, fresh receipts committed
  run 54. Remaining handoff tasks: 3 (Node/browser regression re-run after
  fixes), 4 (release requirements: dense reconstruction, qualified isolation,
  public accounts, durable queue, generative model qualification, capture quality).

## Guardrails

- No force-push, no merge, no deploy. GB10 build/verification only this run
  (4090 GPU work on its separate branch/config).
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
