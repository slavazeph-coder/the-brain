# World Builder — remote build progress (GB10)

Last updated: 2026-10-22T00:00Z
Mode: GB10 local (build/verification only; 4090 GPU tasks alternate on separate branch)

## Current status

- Repo: `/workspace/hermes-gb10/repos/the-brain` (branch `hermes/world-builder-gb10`)
- Worker: `/workspace/hermes-gb10/repos/the-brain/robotics/world_worker/`
- **Run 31 (this run): signed-receipt API/env documentation — COMMITTED, GREEN**
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

- None. Actual HTTP report UI validation (browser-level, real app,
  `tests/world/report_receipt_ui_smoke.py`) remains the only remaining
  gate before release work is complete; handoff task 1 still open.

## Next bounded action

- Run 32: alternate to a 4090 GPU task — short authenticated SSH to
  `root@161.184.224.50:50242`-family endpoint per
  `/workspace/hermes-gb10/home/context/world-builder-4090.json`,
  confirm hostname + GPU, run one bounded experiment/config check on
  `hermes/world-builder-4090`. Preserve existing 4090 experiments and
  GPU budgets. No permanent tunnel.
- Later: real HTTP report UI validation; 4090 parity check.

## Guardrails

- No force-push, no merge, no deploy. GB10 build/verification only this run
  (4090 GPU work on its separate branch/config).
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
