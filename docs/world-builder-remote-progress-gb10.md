# World Builder — remote build progress (GB10)

Last updated: 2026-10-21T21:52Z
Mode: GB10 local (build/verification only; 4090 GPU tasks alternate on separate branch)

## Current status

- Repo: `/workspace/hermes-gb10/repos/the-brain` (branch `hermes/world-builder-gb10`)
- Worker: `/workspace/hermes-gb10/repos/the-brain/robotics/world_worker/`
- Test baselines re-verified at `0ab6caa` (clean tree):
  - Node: `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (106.5 ms)
  - Python: `/workspace/brainsnn-world-builder/.venv/bin/python -m pytest tests/world/test_report_receipts.py -q` → 19 passed in 6.21s
  - New: `/workspace/brainsnn-world-builder/.venv/bin/python -m pytest tests/world/test_report_receipts_loopback.py -q` → 1 passed in 0.73s
- **Run 20 (this run): CI loopback HTTP signed-receipt driver — COMMITTED, GREEN**
  - Commit: `0ab6caa test(world): add CI loopback HTTP driver for signed receipts`
  - Test: `tests/world/test_report_receipts_loopback.py` (169 lines, single module-scoped fixture + one test)
  - What it does: real `uvicorn` on `127.0.0.1:0`, full HTTP sequence —
    health → capabilities (auth) → report-key → upload create+put → inspect job →
    signed receipt → tamper 409 → offline verify (exit 0, verified=True) →
    tampered-scenario reject (non-zero exit, no stdout)
  - Fixes found this run: `/v1/capabilities` requires the Bearer token (401 without it);
    `uvicorn 0.54` port lives on `server.servers[0].sockets[0]`; receipt envelope fields
    are `payloadText`/`payloadSha256` (not `payload`)
  - The run-17 scratch driver was never commit-able (scratch-only, no fixture); this
    test is the CI-reproducible replacement.

## Blockers

- None. All signed-receipt API gates pass on loopback. HTTP report UI validation
  (browser-level, real app) remains the only remaining gate before release work
  can be considered complete.

## Next bounded action

- Run 21: 4090 GPU task (alternation per task prompt) — short authenticated SSH,
  confirm hostname + GPU, then a bounded experiment or config check on
  `hermes/world-builder-4090` branch. Preserve existing 4090 experiments and
  GPU budgets. No permanent tunnel.

## Guardrails

- No force-push, no merge, no deploy. GB10 build/verification only this run (4090 GPU work on its separate branch/config).
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
