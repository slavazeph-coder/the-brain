# World Builder — remote build progress (GB10)

Last updated: 2026-10-22T14:55Z
Mode: GB10 local (build/verification only; 4090 GPU tasks alternate on separate branch)

## Current status

- Repo: `/workspace/hermes-gb10/repos/the-brain` (branch `hermes/world-builder-gb10`)
- **Run 42 (this run): DELETE-semantics tests — COMMITTED, GREEN**
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

## Blockers

- None. Real HTTP UI smoke gate PASSED (chromium, run 36). Cancellation
  coverage now complete (queued, running, source re-hash, 504 slot,
  post-IO re-auth, completed-job non-interruption).

## Next bounded action

- Run 43: 4090 MapAnything held-out-frame inference smoke test — short
  authenticated SSH to `root@ssh2.vast.ai:23990` (key `/root/.ssh/gb10-rebuild`),
  confirm hostname + GPU before running. Reuse verified pinned weights from
  GB10; do not replace base conda env. No permanent tunnel.
- Later: webkit UI smoke; 4090 parity check.

## Guardrails

- No force-push, no merge, no deploy. GB10 build/verification only this run
  (4090 GPU work on its separate branch/config).
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
