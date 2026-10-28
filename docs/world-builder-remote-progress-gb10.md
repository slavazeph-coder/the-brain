# World Builder — remote build progress (GB10)

Last updated: 2026-10-28T20:55Z
Mode: GB10 local (build/verification only; 4090 GPU tasks alternate on separate branch)

## Run log (newest first)

### Run 152 — 2026-10-28 (inter-chunk abort regression: upload() relays caller signal to each chunk PUT; both suites green)

- 4090 skipped this run (6 consecutive connection refused; per "if blocker repeats, choose another useful task").
- Picked up run 150's committed state; verified `upload()` at `brainsnn-r3f-app/public/world/worker-client.mjs` already relays `this.request({...,signal})` — the fix from `0e4aafc` is correct; only the regression test was missing.
- **Bounded improvement (GB10, branch `hermes/world-builder-gb10`):**
  - `tests/world/worker-client.test.mjs`: added inter-chunk-abort regression test. Stubs `client.request`, drives a real in-flight chunk PUT, aborts the owner `AbortController` mid-upload, asserts: (a) the PUT received the caller's exact signal, (b) the promise rejects with `AbortError`, (c) no later request outlives the signal, (d) no chunk was acked past offset 0.
- **Verified (exact, GB10, post-commit):**
  - `node --test tests/world/worker-client.test.mjs` → **10 pass / 0 fail** (123 ms, up from 9)
  - `node --test tests/world/report-receipts.test.mjs` → **12 pass / 0 fail** (104 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** (20.4 s)
- **Commit:** `724e976` `test(world): inter-chunk abort regression - upload() relays caller signal to each chunk PUT, rejects AbortError mid-upload` (1 file). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
- **Actual blocker:** 4090 GPU unreachable (connection refused, 6 consecutive). HTTP report-UI (browser) validation still pending (loopback only).
- **Next bounded action:** complete signed-receipt API/env documentation; then 4090 MapAnything held-out dense-inference smoke once reachable (confirm hostname `d130b6c7f3f4` + GPU `GPU-3390c2ec…` first).
- **Guardrails:** no force-push, no merge/deploy, no paid fallback. Serving Qwen/backup and licensed model/guardrail gates untouched. 4090 branch `hermes/world-builder-4090` untouched.

### Run 150 — 2026-10-28 (post-await abort guards in request() + reportReceipt(): signed receipt discarded after caller aborts; both suites green)

- 4090 skipped this run (was down last run; not re-testing the same blocker per "if blocker repeats, choose another useful task").
- Picked up run 149's dirty tree at `ac39b05` (two files: `worker-client.mjs`, `report-receipts.test.mjs`).
- **Bounded improvement (GB10, branch `hermes/world-builder-gb10`):**
  - `worker-client.mjs`: added two post-await `signal?.aborted` guards:
    1. In `request()` immediately after `fetch()` resolves: if the caller's signal fired while `fetch` was in flight (response already buffered by the browser), throw `AbortError` before consuming the body. Without this guard, a caller who aborts during the fetch's network phase can still receive the full signed receipt body.
    2. In `reportReceipt()` immediately after `this.request()` resolves: same guard at the `reportReceipt` call-site, so even if `request()`'s internal guard is bypassed by a future refactor, the signed receipt is never returned to a caller who has aborted.
  - `report-receipts.test.mjs`: added `aborted report-receipt signal is still discarded when the worker already returned a receipt` (+26 lines). The mock models the exact race: `fetch`'s signal contract resolves (body delivered) in the same tick the caller's abort fires, so the receipt is "returned" before the abort is observed. The client must still reject with `AbortError`. The mock uses `await new Promise(r => requestSignal.addEventListener('abort', r, {once: true}))` to wait for the caller's abort before delivering the receipt — the old `setImmediate` mock resolved before the test's 5 ms poll loop could call `abort.abort()`, so `signal.aborted` was still false at the post-await check.
- **Verified (exact, GB10, post-commit):**
  - `node --test tests/world/report-receipts.test.mjs` → **12 pass / 0 fail** (96.3 ms) (was 11)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 21.03 s
- **Commit:** `0e4aafc` `fix(world): post-await abort guards in request() and reportReceipt() discard signed receipt after caller aborts` (2 files, +31/−2). Pushed to `hermes/world-builder-gb10`; `git ls-remote` = `0e4aafc`. No force-push/merge/deploy.
- **Actual blocker:** none this run. 4090 GPU still unreachable (connection refused, 5 consecutive). MapAnything dense-inference smoke still gated on 4090 reachability. HTTP report-UI (browser) validation still pending (loopback only).
- **Next bounded action:** 4090 MapAnything held-out dense-inference smoke once reachable (confirm hostname `d130b6c7f3f4` + GPU `GPU-3390c2ec…` first; pinned weights, 20 GiB watchdog, no base conda replacement); else next GB10 receipt/queue integration-gap item.
- **Guardrails:** no force-push, no merge/deploy, no paid fallback. Serving Qwen/backup and licensed model/guardrail gates untouched. 4090 branch `hermes/world-builder-4090` untouched.

### Run 146 — 2026-10-28 (Node non-UTF-8 scenario regression: prepare/verify fail closed; both suites green)
- Clean tree at `1f9c08f` before editing.
- 4090 probe: `ssh2.vast.ai:23990` connection refused (instance down for a 3rd consecutive run since 144). No 4090 GPU work.
- Baseline (pre-edit, exact):
  - `node --test tests/world/report-receipts.test.mjs` → **9 pass / 0 fail** (103 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.53 s
- Added `non-UTF-8 scenario text fails closed instead of silently mismatching the receipt hash` to `tests/world/report-receipts.test.mjs` (+21 lines):
  - The receipt chain hashes the **UTF-8 bytes** of the scenario (`reportSHA256(encode(scenarioText))`). If any layer (proofPack, reportSHA256, the verify byte-hash) round-tripped non-UTF-8 bytes through a lossy encode/decode, the scenario hash would silently disagree between prepare and verify.
  - Pins that `prepareReportRequest` rejects non-UTF-8 scenario text (bytes `0x00,0xFF`, lone `0x80`, and `0x24,0xFF,0x24`) with a distinct error — never a silent pass.
  - Pins that `verifySignedReport` fails closed at the top-level verify entrypoint (which re-hashes the bytes) for the same input, rather than falling through to a `Exact scenario file bytes do not match` mismatch.
- Verified (exact, post-commit):
  - `node --test tests/world/report-receipts.test.mjs` → **10 pass / 0 fail** (70 ms) (was 9)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.53 s
- Commit: **`6bab8ea`** `test(world): non-UTF-8 scenario text fails closed — receipt hash chain never silently mismatches` (1 file, +21). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
- Next bounded action: 4090 bounded GPU/reconstruction task once instance is reachable (confirm hostname+GPU first). If 4090 remains down, continue GB10 receipt work or integration-gap review (signed-report receipt files + Hermes queue continuation absent from main per WORLD_BUILDER_CURRENT.md).

### Run 145 — 2026-10-28 (Node cancellation regression: verifySignedReport status gate; both suites green)
- Tree clean at `f2f5123` before editing (run 144 left no uncommitted changes).
- 4090 probe: `ssh2.vast.ai:23990` connection refused (instance still down since run 144). No 4090 GPU work.
- Baseline (pre-edit, exact):
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail** (69 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.47 s
- Added `verifySignedReport rejects cancelled or running expectedJob even when the signature is valid` to `tests/world/report-receipts.test.mjs` (+23 lines):
  - Pins the `checkedJob` status gate (report-receipts.mjs:38): `job.status !== 'complete'` → `fail('A completed worker job is required.')`.
  - Parametrised over `cancelled` and `running` — both rejected with `/completed worker job/`.
  - Tampered-but-validly-signed receipt (ownerId unchanged, payload re-signed) against a `cancelled` job → rejected at the status gate, proving the gate is independent of signature validity.
  - Same tampered receipt against a `complete` job → passes (signature valid, payload valid), confirming the gate is the status check, not the signature.
- Verified (exact, post-commit):
  - `node --test tests/world/report-receipts.test.mjs` → **9 pass / 0 fail** (68 ms) (was 8)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.43 s
- Commit: **`74a51a8`** `test(world): Node cancellation regression — verifySignedReport status gate independent of signature validity` (2 files, +43). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
- Next bounded action: 4090 bounded GPU/reconstruction task once instance is reachable (confirm hostname+GPU first). If 4090 remains down, continue GB10 receipt work or integration-gap review (signed-report receipt files + Hermes queue continuation absent from main per WORLD_BUILDER_CURRENT.md).

### Run 144 — GB10 build task (4090 unreachable; Vast instance down, port 23990 refused, no new endpoint). No commits this run.

### Run 143 — 2026-10-28 (fixed tampered-bundle assertion in offline-bundle test; both suites green)
- Picked up run 143's uncommitted diff (two new assertions in `tests/world/report-receipts.test.mjs` for the offline-bundle test). The tree was dirty since the prior run.
- One of the two new assertions was wrong: tampering `scenarioText` by replacing `"schema"` with `"schemaX"` produces valid JSON with a wrong schema value, so `parseScenario` hits the schema check (`fail('Use the exact exported BrainSNN proof JSON.')`) rather than the JSON-parse check. The assertion expected `/not valid JSON/` which never matches.
- Fix: changed the expected regex to `/exact exported BrainSNN proof JSON/` (one line). The other new assertion (missing `publicKey` field → `/fields/`) was correct and passed.
- Exact suites (post-fix, clean tree at `faa50f4`):
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail** (69 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.41 s
- Commit: **`faa50f4`** `test(world): fix tampered-bundle assertion — schema mutation hits schema check, not JSON parse` (1 file, +3). Pushed to `hermes/world-builder-gb10`. No force-push/merge/deploy.
- 4090 probe this run: `ssh2.vast.ai:23990` **reachable again** — hostname `d130b6c7f3f4`, GPU `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09`, 0 % util, 28 MiB. (Was connection-refused at ~06:00 UTC in run 142.) No 4090 GPU work performed this run (GB10 build task closed first).
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
- Next bounded action: 4090 bounded GPU/reconstruction task (e.g. single-view consistency check on the 11-frame held-out set, or a second independent MapAnything run to confirm reproducibility). Confirm hostname+GPU before running.

### Run 142 — 2026-10-28 (GB10 baseline re-verified at `96a0ea7`; progress entry for run 96a0ea7 written)
- Clean tree at `96a0ea7` (`hermes/world-builder-gb10`).
- Exact suites:
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail** (63 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.49 s
- Wrote the missing progress entry for commit `96a0ea7` (per-request images dir isolation guard + idempotent staging test) — this entry documents that run's work.
- Next bounded action: 4090 1-frame held-out MapAnything GPU inference (confirm hostname `d130b6c7f3f4` + GPU UUID first).
- **4090 note (this run):** `ssh2.vast.ai:23990` connection refused (2 attempts, ~06:00 UTC). Instance may have been stopped or port changed. No 4090 work performed this run.

### Run 141 — 2026-10-28 (4090 11-frame held-out MapAnything GPU inference: PASSED, receipt captured)
- GB10 baseline re-verified at `0122035` (clean tree):
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail** (111 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.74 s
- 4090 confirmed live: host `d130b6c7f3f4`, GPU `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09` (idle 28 MiB, 0%).
- The 11-frame held-out MapAnything GPU inference launched at 05:23:23 UTC (run 140) **completed exit=0** at ~05:23:45 UTC (~22 s wall).
- Artifacts on 4090: `/workspace/slava/qualification-mapanything-receipt-11f/`
  - `reconstruction.json` (SHA `fb9619bd…d9803d`), `dense-preview.ply` (4,254,237 B, SHA `9c386e2f…c85`), `manifest.json` (385 B)
- Key metrics from `reconstruction.json`:
  - `device: cuda`, torch 2.5.1+cu121
  - Model: `facebook/map-anything-apache` @ `00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a`, SHA256 `fa06c0fd…5201`
  - 11 source frames (0000–0010), all with SHAs recorded
  - `peak_cuda_allocated_bytes: 8385236992` (~8.4 GB — fits 24 GB card)
  - `elapsed_seconds: 14.027` (inference only)
  - `preview_points: 98,796` (vs 96,276 for 2-frame run — consistent)
  - `metric_verified: false`, `physics_ready: false` (correct for held-out smoke)
  - 11 camera poses + intrinsics written (OpenCV → right-handed y-up)
  - Per-view predicted_pixels: 181,300; valid_points: 138,894–145,006; preview_points: 8,681–9,063
- Comparison to 2-frame run (run 134, `509074c`): peak VRAM 7.7 GB → 8.4 GB (+9%), inference 12.68 s → 14.03 s (+11%), points 96,276 → 98,796 (+3%). Linear scaling confirmed.
- No force-push/merge/deploy; no GB10 code changes this run.
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
- Next bounded action: GB10 receipt work (e.g. one more cancellation regression or loopback test) or 4090 single-view consistency check.

### Run 137 — 2026-10-28 (baseline green; 401/409 re-check already covered; progress entries written)
- Clean tree at `509074c` (`hermes/world-builder-gb10`), no uncommitted changes.
- Exact suites:
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail** (123 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.95 s
- Re-read `robotics/world_worker/app.py` `report_receipt` handler (lines 690–754) and `report_receipts.py` to confirm the 401/409 post-verification re-check path:
  - Post-IO re-auth re-reads the registry; a revoked tenant → **401** (line 742–743).
  - Evidence re-check via `validate_evidence`; hash mismatch → **409** (line 749–750).
  - Both paths are already pinned by existing tests:
    - `test_rechecks_owner_and_job_after_expensive_verification` (line 240, parametrized `revoke`→401, `delete-job`→404; concurrent request during hash → 429).
    - `test_cancel_during_inflight_receipt_hash_does_not_interrupt_signature` (line 632, credential revocation during in-flight hash → 401).
    - `test_artifact_delete_during_inflight_receipt_hash_blocks_signature` (line 735, artifact delete during in-flight hash → 409, `missing or changed` detail).
  - No new regression needed; the 401/409 post-verification recheck is fully covered.
- This run's contribution: wrote the missing progress-file entries for runs 136+137 (previously the file ended at run 134; runs 136 and 137 had no entries despite their commits existing in the log).
- No force-push/merge/deploy; no 4090 work this run.
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
- Next bounded action: one useful 4090 GPU/reconstruction task via short authenticated SSH (confirm hostname+GPU first), e.g. extend the held-out MapAnything smoke to 11 frames or run a single-view consistency check.

### Run 136 — 2026-10-28 (tool-budget exhaustion; verification only, no commit)
- Ran both suites to confirm baseline green before writing progress entries (which was the pending task from run 134's next-action note).
- Exact suites:
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail**
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed**
- Tool budget exhausted before the progress-file write could be completed; no commit this run.
- No force-push/merge/deploy; no 4090 work this run.
- Next bounded action: write run 136+137 entries into `docs/world-builder-remote-progress-gb10.md`, commit, push.


### Run 134 — 2026-10-28 (4090 held-out MapAnything GPU inference: PASSED, receipt signed)
- 4090 host re-confirmed: `d130b6c7f3f4`, 24564 MiB / 0 %, torch 2.5.1+cu121 CUDA available.
- Local GB10 baseline (clean tree at `5a6dcc0`):
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail**
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed**
- **Held-out 2-image GPU smoke executed and PASSED** (driver `run_ma_heldout.sh`,
  launched via SSH from GB10, watchdog `timeout 3600`):
  - Host: `d130b6c7f3f4`, CUDA, 24564 MiB
  - Model: `facebook/map-anything-apache` @ `00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a`
  - SHA256: `fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201`
  - Inputs: `qualification-input/0000.png` (SHA `5ad005e5…`), `0001.png` (SHA `d19bd9a0…`)
  - Output: `dense-preview.ply` (4.1 MB, 96,276 points), `reconstruction.json`, `manifest.json`
  - Wall time: ~90 s end-to-end; `elapsed_seconds: 12.68` (inference only)
  - `peak_cuda_allocated_bytes: 7725528064` (~7.7 GB, 24 GB card → comfortable margin)
  - `device: cuda`, `metric_verified: false`, `physics_ready: false` (correct for 2-frame)
  - Exit code 0; GPU returned to 0 % / 28 MiB after run
- Artifacts on 4090: `/workspace/slava/qualification-mapanything-receipt/`
- No commits this run (receipt is on 4090, not in the GB10 repo tree).
- No force-push/merge/deploy; Qwen/backup, license & no-paid-fallback gates untouched.
- Next bounded action: extend to 11-frame full held-out set or single-view consistency check;
  commit signed receipt JSON into `docs/world-builder-remote-progress-gb10.md` if owner wants
  the full artifact in-tree.

### Run 128 — 2026-10-27 (concurrent DELETE of receipt-target job during in-flight receipt: no-op, receipt still signs)
- Baseline exact (clean tree at `b09131c`): `pytest tests/world/test_report_receipts.py -q` → **32 passed in 20.43 s**; `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail (102 ms)**.
- Added `test_delete_receipt_target_job_during_inflight_receipt_is_noop_and_receipt_still_signs` to `tests/world/test_report_receipts.py` (+48 lines):
  - Grounding from source: `cancel_job` (app.py:670-679) only sets `hash_cancellations[jid]` when `status in ACTIVE`; a `complete` job is not ACTIVE → cancel is a no-op (200, status stays `complete`, no row deletion). The receipt path uses its own local `threading.Event` (app.py:722), never `hash_cancellations`, so the concurrent cancel cannot interrupt in-flight hashing.
  - Scenario: complete job → receipt hash thread parked via monkeypatched `file_digest` → concurrent `DELETE /v1/jobs/{jid}` → assert 200/status `complete`/row still in DB → release hash thread → assert receipt signs 200, `verify_receipt` passes, job status still `complete`.
  - Distinct from `test_artifact_delete_during_inflight_receipt_hash_blocks_signature` (run 42, DELETE /artifacts → 409/row removed) and `test_cancel_during_inflight_receipt_hash_does_not_interrupt_signature` (632, credential revocation → 401).
- Verified (exact, post-commit):
  - `pytest tests/world/test_report_receipts.py -q` → **33 passed in 20.88 s** (was 32)
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail (70 ms)**
- Commit: **`668adea`** `test(world): concurrent DELETE of receipt-target job during in-flight receipt is no-op; receipt still signs 200` (1 file, +48). Pushed to `hermes/world-builder-gb10`; `git rev-parse --short HEAD` = `668adea`. No force-push/merge/deploy.
- No 4090 probe this run (alternation: GB10 build task closed this run).
- Serving Qwen/backup, licensed model/guardrail gates, no-paid-fallback untouched.

### Run 125 — malformed ReportBody 422 schema rejection tests
- Baseline exact: `pytest tests/world/test_report_receipts.py -q` → **31 passed in 20.55 s**; `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail (103 ms)** at `e569568`.
- Added `test_report_receipt_malformed_body_is_rejected_422` to `tests/world/test_report_receipts.py` (+54 lines):
  parametrised schema-level `ReportBody` rejects over HTTP —
  `scenarioSha256` (63/65-char, non-hex), `geometrySha256` (wrong len, non-hex),
  `artifactRefs` name (empty, >256, `../evil`), `artifactRefs` sha256 (62-char,
  non-hex), >32 refs, extra top-level field, non-object body, null body.
  All must 422 without touching the job slot; a valid request still signs 200.
- Verified (exact):
  - `pytest tests/world/test_report_receipts.py -q` → **32 passed in 13.85 s**
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail (103 ms)**
- Commit: **`a7966d5`** `test(world): add malformed ReportBody 422 schema rejection tests`
  (1 file, +54). Pushed to `hermes/world-builder-gb10`; `git ls-remote` = `a7966d5`.
  No force-push/merge/deploy.
- Remaining pending: HTTP report UI browser-journey validation (live signed
  endpoint UI); 4090 MapAnything single-held-out-frame `infer()` smoke.
- Serving Qwen/backup, licensed model/guardrail gates, no-paid-fallback untouched.

### Run 122 — tenant job-quota regression: completed rows consume quota, only row-removing DELETE frees slot
- Tree verified clean at `d57d0cd` on `hermes/world-builder-gb10` before editing
  (run 121's drafted quota test was never written to disk — confirmed by
  `git status` empty + reading `tests/world/test_tenant_isolation.py`).
- This run's bounded task (chosen per run 121's "next bounded action"): a
  tenant job-quota regression in `tests/world/test_tenant_isolation.py`.
- Grounding verified from source before writing:
  - `check_owner_jobs` (app.py:336-340) counts every owned row **incl.
    completed** (`SELECT id,status FROM jobs WHERE owner_id=?`), and 429s when
    `len(owned)+adding > job_count` or `active+adding > active_jobs`.
  - `DELETE /v1/jobs/{jid}/artifacts` (app.py:681-689) is refused while
    `status in ACTIVE or jid in running` (409), else `DELETE FROM jobs` (row
    removed → quota freed) and returns `{'deleted': True}`.
  - `cancel_job` (app.py:669-679) sets status `cancelled` but **keeps** the row.
- New test `test_owner_job_quota_counts_completed_rows_and_delete_frees_slot`:
  `job_count: 2, active_jobs: 5`. j1 prepared→started→complete; 3rd `prepare`
  → **429** (completed row still counts); `DELETE /artifacts` on j1 → frees slot
  → new `prepare` → 201 (j3). Cancelling j3 (row kept) → 3rd `prepare` → **429**
  again (queued/cancelled rows block). Foreign owner B: upload ok, `DELETE
  /artifacts` on j2 → **404** (cannot free another owner's row).
- Verified (exact):
  - `pytest tests/world/test_tenant_isolation.py -q` → **30 passed in 2.03 s**
  - Baseline (stash the change) → **29 passed in 1.96 s** (delta = exactly +1 test)
  - Re-verified post-stash-pop → **30 passed in 2.11 s**; tree restored clean.
- Commit: **`1ca9588`** `test(world): owner job-quota regression — completed
  rows consume quota, only row-removing DELETE frees the slot` (1 file, +23).
  Pushed to `hermes/world-builder-gb10`; `git ls-remote origin` = `1ca9588`
  = HEAD; `git status --porcelain` empty. No force-push/merge/deploy.
- No 4090 probe this run (alternation: GB10 build task closed this run).
  4090 was confirmed idle at run 121 (`d130b6c7f3f4`, 0% util); MapAnything
  single-held-out-frame `infer()` smoke still pending.
- Serving Qwen/backup, licensed model/guardrail gates, no-paid-fallback
  untouched.
- Next bounded action: 4090 MapAnything single-held-out-frame `infer()` smoke
  as ONE bounded SSH command to `root@ssh2.vast.ai:23990` (key
  `/root/.ssh/gb10-rebuild`), confirm hostname+GPU first, 20 GiB watchdog,
  pinned weights at `fa06c0fd…5201`, no permanent tunnel, preserve 4090
  experiments + GPU budget.

### Run 101 — cancellation regression: hold command needs {input_manifest} placeholder
- Picked up previous run's uncommitted draft `test_cancel_queued_job_cancels_receipt_slot`
  in `tests/world/test_report_receipts.py` (working tree dirty since run 100).
- Root cause confirmed by reading source + running the failing test:
  - The draft hold-adapter command was `[sys.executable, '-c', hold_script]` with
    **no** `{input_manifest}` placeholder.
  - `app.py:448` substitutes `{input_manifest}` → request-file path into each
    command arg. Without the placeholder, the substituted command is
    `[sys.executable, '-c', hold_script]` → `sys.argv[1]` is empty.
  - The hold script does `json.load(open(sys.argv[1]))` → `FileNotFoundError`
    → subprocess exits 1 → `app.py:462` raises `ValueError('Adapter failed.
    Check operator logs…')` → job status `failed`.
  - Test error before fix: `job … status=failed detail=Adapter failed. Check
    operator logs; no successful output was claimed.` (1 failed, 30 passed).
- Fix: add `'{input_manifest}'` as the last command arg so the worker
  substitutes the request-file path into `sys.argv[1]`. The hold script then
  reads the manifest, writes `hold-artifact.json` + `manifest.json` under
  `output_dir`, and the job completes.
- Verified:
  - `pytest tests/world/test_report_receipts.py -q` → **31 passed in 20.10 s**
    (was 30 passed + 1 failed).
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (104 ms).
- Commit: **`03f84bc`** `fix(world): cancellation regression — hold command
  needs {input_manifest} placeholder` (1 file, +121). Pushed.
  No force-push/merge/deploy.
- No 4090 probe this run (alternation: GB10 build task closed this run).
  Serving Qwen/backup, licensed gates, no-paid-fallback untouched.
- Next bounded action: 4090 MapAnything held-out-frame inference smoke —
  short SSH to `root@ssh2.vast.ai:23990` (key `/root/.ssh/gb10-rebuild`),
  confirm hostname + GPU before running. Reuse verified pinned weights from
  GB10; do not replace base conda env. No permanent tunnel.

### Run 100 — cancellation regression fix: settle loop now waits for operator.log + cancelled
- Picked up previous run's drafted (uncommitted) fix to
  `tests/world/test_report_receipts.py` — the settle loop in
  `test_delete_artifacts_is_refused_while_job_is_running`.
- Root cause confirmed from source: `cancel_job` (app.py:678) awaits
  `stop_process(jid)` and returns 200 with DB status `cancelled`, but the
  execution thread's `finally` block (app.py:477-481) has not yet run
  `running.discard(jid)`. The test's old loop only waited for
  `status != 'running'` (immediately true after DB update), then fired
  `DELETE /artifacts` while `jid` was still in the `running` set → 409.
- Fix: mirror the reaped-adapter test's settle condition — poll until
  `operator.log` is gone AND DB status is `cancelled`. By then the
  `finally` block has completed and the `running` guard is clear.
- Verified:
  - `pytest tests/world/test_report_receipts.py::test_delete_artifacts_is_refused_while_job_is_running -q` → **1 passed in 4.76 s**
  - `pytest tests/world/test_report_receipts.py -q` → **30 passed in 14.77 s**
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (127 ms)
- Commit: **`f2ccaf4`** `fix(world): settle loop waits for operator.log gone +
  status cancelled in delete_artifacts test` (1 file, +43/−4). Pushed.
- No 4090 probe this run (alternation: GB10 build task closed). Serving
  Qwen/backup, licensed gates, no-paid-fallback untouched.
- Next bounded action: 4090 MapAnything held-out-frame inference smoke —
  short SSH to `root@ssh2.vast.ai:23990` (key `/root/.ssh/gb10-rebuild`),
  confirm hostname + GPU before running. Reuse verified pinned weights from
  GB10; do not replace base conda env. No permanent tunnel.

### Run 99 — live smoke CORS fix: worker and page bind separate reserved ports; chromium live PASS
- Picked up previous run's uncommitted CORS fix to
  `tests/world/report_receipt_ui_smoke_live.py` (working tree was dirty
  since run 98).
- Fix: `start_live_server` now takes `worker_port` (reserved via probe
  server **before** `create_app()`), sets `WORLD_ALLOWED_ORIGINS` to the
  full page origin URL, and uvicorn binds that exact reserved port.
  `main()` reserves **both** worker and page ports up front; the page
  `ThreadingHTTPServer` binds the reserved `page_port`, so the page's
  real origin equals the one baked into the allowed list — cross-origin
  `fetch()` passes real CORS on the wire (same-port binding would be
  `EADDRINUSE`). `run_browser_journey` gained the `page_port` param.
- Base verified green before running live smoke:
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (64 ms)
  - `pytest tests/world/test_report_receipts.py -q` → **29 passed in 10.19 s**
- Live smoke (this run, `WORLD_BROWSERS=chromium`):
  - `tests/world/report_receipt_ui_smoke_live.py` → worker uvicorn live on
    127.0.0.1:39641, CORS origin 127.0.0.1:39973, job complete
    (c9b06417…), signed receipt keyId=193bd492…,
    **chromium: PASS**, **ALL PASS: 1 browser(s)**.
  - Receipt on disk (`chromium-live-ui-receipt.json`): `liveHttp: true,
    realEd25519: true, realPrivateWorker: true, pageErrors: [],
    failed: false` + screenshot `chromium-live-receipt.png` (Oct 26 10:55).
- Commit: **`e61cb5e`** `fix(world): live smoke CORS — worker and page bind
  separate reserved ports` (3 files, +44/−17). Pushed. No force-push/merge/deploy.
- No 4090 probe this run (alternation: GB10 build task closed this run).
  Serving Qwen/backup, licensed gates, no-paid-fallback untouched.
- Next bounded action: 4090 MapAnything held-out-frame inference smoke —
  short SSH to `root@ssh2.vast.ai:23990` (key `/root/.ssh/gb10-rebuild`),
  confirm hostname + GPU before running. Reuse verified pinned weights from
  GB10; do not replace base conda env. No permanent tunnel.

### Run 98 — loopback 413 wire test verified green; run log synced; 4090 idle confirmed
- Previous run's `1ecfb3c` (loopback 413 wire test, `tests/world/test_report_receipts_loopback.py`)
  verified **pushed** (HEAD == origin after `git fetch`). Re-ran both suites on this tree:
  - `node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (79.9 ms)
  - `pytest tests/world/test_report_receipts.py tests/world/test_report_receipts_loopback.py -q`
    → **32 passed in 10.89 s**
- Real-HTTP loopback checks (uvicorn on real socket, 413 tamper path, offline verify) confirmed
  passing on live code — the previous run's commit had never been recorded in this progress file.
- 4090 probe (short SSH, key `/root/.ssh/gb10-rebuild`): hostname `d130b6c7f3f4`, GPU
  `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09` **0% util, 28/24564 MiB, 30C** — idle.
  4090 branch `hermes/world-builder-4090` at `24cf8fb` (run 95: libx264 fixed,
  test_worker 44 passed 2 skipped); `robotics/experiments/` untracked, preserved.
- No 4090 GPU work this run (alternation: GB10 verification closed). No force-push/merge/deploy.
  No paid fallback. Serving Qwen/backup, licensed gates untouched.
- Next bounded action: run the full signed-receipt UI smoke (`report_receipt_ui_smoke.mjs`)
  against a live uvicorn instance to close the "actual HTTP report UI validation" gate —
  or fold the 413 loopback result into the progress doc as a run-94+ record first.

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

## Run 103 — 2026-10-27 (checkpoint encoder fix, verify receipt suites)

**Checkpoint:** committed run 102's still-uncommitted encoder-probe fix → **63fd739** `fix(tests/world): encoder probe uses -f null for non-seekable pipe; discover encoders` (1 file, +29/-3). Pushed `3b51d3f..63fd739` to `hermes/world-builder-gb10`. No force-push, no merge/deploy.

**Verified (exact):**
- `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail** (duration_ms 69.8)
- `pytest tests/world/test_report_receipts.py -q` → **31 passed** in 20.52s

**Both "first run" items confirmed done:**
- Signed-receipt API/env docs → "Report receipts (signed verification)" subsection in `docs/world-studio-implementation.md` (Worker operation), env keys documented. Verified present via grep.
- Cancellation regression → 5 cancellation tests in `test_report_receipts.py` (rehash-abort, exact-file-reader deadline, queued-never-starts+no-restart, completed-no-interrupt, running-adapter-reaped) all passing; plus `test_worker.py` cancellation tests.

**Actual blocker:** none this run. HTTP report UI (browser) validation still pending (loopback only). 4090 untouched this run (GB10 verification pass); 4090 has its own branch per world-builder-4090.json.

**Next bounded action:** one useful 4090 GPU/reconstruction task via short authenticated SSH (confirm hostname+GPU first), e.g. re-verify a held-out control render or run a bounded colmap/encoder smoke there. Alternate back to GB10 receipt work.

## Run 112 — 2026-10-27 (4090 COLMAP sparse reconstruction smoke: PASSED)

- Host `d130b6c7f3f4`, GPU `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09` confirmed idle before run (28 MiB, 0 %).
- `qualification-input/` present (11 PNGs + fountain-clip.mp4); `recon-venv` intact at `/workspace/slava/build-runtime/recon-venv` (torch 2.5.1+cu121 cuda=True, pycolmap 4.2.1, cv2 5.0.0).
- Ran `sparse_colmap.run()` on all 11 qualification frames, 20 GiB budget untouched (CPU path):
  - **11/11 images registered**, **6,047 reconstructed points**, **mean reprojection error 0.2754 px**, 1 model, elapsed **14.92 s**.
  - Evidence JSON: `metric_verified: false`, `model_weights_used: false` (correct — no model download), 11 camera poses written.
  - SHA256 of `reconstruction.json`: `2310a2b4…13c7a7`.
- GB10 suites at clean tree `853f650`: node 8/8, pytest 31/31.

**Blocker:** none — sparse COLMAP path proven end-to-end on held-out qualification input.
**Next bounded action:** 4090 MapAnything dense-inference smoke (held-out GPU run; pinned weights, 20 GiB watchdog).

## Run 113 — 2026-10-27 (GB10 base suites verified GREEN on clean tree `853f650`)

- 4090 confirmed idle before any work: `d130b6c7f3f4`, `GPU-3390c2ec…`, 28 MiB used, 0 % util.
- GB10 suites: `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail** (66 ms); `pytest tests/world/test_report_receipts.py -q` → **31 passed** in 20.65 s.
- Run 112's sparse COLMAP smoke receipt (11/11 registered, 6,047 pts, 0.2754 px reprojection, 14.92 s, `2310a2b4…13c7a7`) committed this run after being orphaned in prior notes.
- Signed-receipt docs already closed (run 31, "Report receipts (signed verification)" in `docs/world-studio-implementation.md`); 5 cancellation regressions already green.

**Blocker:** none this run.
**Next bounded action:** 4090 MapAnything dense-inference smoke (remaining held-out GPU qualification gate). No force-push/merge/deploy; serving Qwen/backup and licensed gates untouched.

## Run 148 — 2026-10-28 (GB10: in-flight abort of reportReceipt pins client cancellation contract)

**4090:** `ssh2.vast.ai:23990` connection refused — 4th consecutive down. No 4090 GPU work this run; not repeating the probe.

**Bounded improvement (GB10, branch `hermes/world-builder-gb10` @ a5a4574):** added the in-flight-abort regression to `tests/world/report-receipts.test.mjs`. `WorkerClient.reportReceipt` relays the caller's `AbortSignal` into a local `AbortController` that `fetch` consumes; aborting the signal while the worker is still streaming the signed receipt back must reject with an `AbortError` and discard the bytes — never silently complete with a half-read signed payload. The earlier cancellation tests only aborted *before* the request (capability gate); this one models `fetch`'s signal contract by having the mocked body read reject as soon as the relayed signal fires, then asserts the client rejects with `name==='AbortError'` and the signed receipt is never returned.

**Verification (exact, GB10):**
- `node --test tests/world/report-receipts.test.mjs` → **11 pass / 0 fail** (was 10, duration_ms 128)
- `pytest tests/world/test_report_receipts.py -q` → **33 passed** in 20.87s

**Actual blocker:** 4090 GPU unreachable (connection refused, 4 consecutive). MapAnything dense-inference smoke still gated on 4090 reachability. HTTP report-UI (browser) validation still pending (loopback only).

**Next bounded action:** 4090 MapAnything held-out dense-inference smoke once reachable (confirm hostname `d130b6c7f3f4` + GPU `GPU-3390c2ec…` first; pinned weights, 20 GiB watchdog, no base conda replacement); else next GB10 receipt/queue integration-gap item (signed-report receipt files + Hermes queue continuation absent from main).

**Guardrails:** no force-push, no merge/deploy, no paid fallback. Serving Qwen/backup and licensed model/guardrail gates untouched. 4090 branch `hermes/world-builder-4090` untouched.

## Run 110 — 2026-10-27 (4090 env-var wiring complete)

**4090 verification (short SSH, hostname d130b6c7f3f4, GPU UUID 3390c2ec… verified):**
- GPU idle at start: 28 MiB used, no active jobs.
- DINOv2 source: HEAD `7764ea0f912e53c92e82eb78a2a1631e92725fc8` (matches `DINOV2_REVISION`).
- MapAnything source: HEAD `3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9` (matches `SOURCE_REVISION`).
- model.safetensors: 4,914,062,480 bytes, SHA256 `fa06c0fd…5201` (matches `MODEL_SHA256`).
- config.json: 5,776 bytes, SHA256 `65701d09…b676c5` (matches `CONFIG_SHA256`).

**Change:** appended three reconstruction env vars to `/workspace/slava/world-builder-env.sh`:
```
export WORLD_MAPANYTHING_SOURCE_DIR=/workspace/slava/world-builder/sources/map-anything
export WORLD_DINOV2_SOURCE_DIR=/workspace/slava/world-builder/sources/dinov2
export WORLD_MAPANYTHING_MODEL_DIR=/workspace/slava/models/map-anything-apache/00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a
```
Verified with `cat` after append. Exit 0.

**GB10 suites (this run, exact):**
- `node --test tests/world/report-receipts.test.mjs` → **8 pass / 0 fail**
- `pytest tests/world/test_report_receipts.py -q` → **31 passed** in 20.36s

**Actual blocker:** none. 4090 env now fully wired; next bounded action is a held-out MapAnything inference smoke test on 4090 with the pinned runtime (separate venv, 20 GiB limit, no base conda replacement).

**Guardrails:** no force-push, no merge/deploy, no paid fallback. 4090 branch `hermes/world-builder-4090` untouched. Serving Qwen/backup untouched.
