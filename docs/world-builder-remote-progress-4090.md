# World Builder — remote build progress (4090)

Last updated: 2026-10-22T12:30Z
Mode: 4090 GPU (separate branch `hermes/world-builder-4090`); GB10 build/verification alternates on its own branch.

## Current status

- Repo: `/workspace/slava/the-brain` (branch `hermes/world-builder-4090`)
- Host: `d130b6c7f3f4` (RTX 4090, UUID `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09`)
- **Run 37 (this run): 4090 test environment verification — GREEN**
  - `node --test tests/world/report-receipts.test.mjs` → pass, 0 fail (78.9 ms)
  - `pytest tests/world/test_report_receipts.py -q` → 18 passed, 1 warning in 2.51s
  - Note: 18 passed here vs 21 on GB10 — the 4090 branch is at `e109088` (run-35
    cancellation-abort test), behind GB10's run-36 (real HTTP UI smoke). No
    regression; the count difference is purely the branch being at an earlier commit.
  - Env: `source /workspace/slava/world-builder-env.sh` (node + worker-tests python)
  - Hostname + GPU confirmed before running. No permanent tunnel.

## Blockers

- None. 4090 test environment is verified and green.
- 4090 branch is behind GB10 by run-36 (UI smoke); can be synced when owner wants
  the 4090 to have the full UI-smoke gate.

## Next bounded action

- Run 38: alternate back to GB10 — webkit UI smoke (browser not yet installed)
  or a further verification gate. 4090 GPU experiment if a specific bounded
  experiment is warranted; otherwise preserve experiments and GPU budgets.

## Guardrails

- No force-push, no merge, no deploy. 4090 GPU work on its separate branch/config.
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
- Preserve existing 4090 experiments and GPU budgets. No permanent tunnel.

## Run 95 — libx264 fixed, test_worker green (2026-10-21)

- Root cause: `/opt/conda/bin/ffmpeg` (4.3, no libx264) shadowed `/usr/bin/ffmpeg` (4.2.7, has libx264) via shell-profile `conda activate` PATH prefix.
- Fix: `apt install ffmpeg` → `/usr/bin/ffmpeg` 4.2.7-0ubuntu0.1.
- Test: `PATH=/usr/bin:$PATH pytest tests/world/test_worker.py -q` → **44 passed, 2 skipped in 4.53 s** (was 43/1/2).
- Commit: `ace31dc` (pre-existing), progress file updated.
- Next: provision `WORLD_MAPANYTHING_SOURCE_DIR` / `WORLD_DINOV2_SOURCE_DIR` / `WORLD_MAPANYTHING_MODEL_DIR` (4.9 GB checkpoint) for held-out GPU inference smoke.
