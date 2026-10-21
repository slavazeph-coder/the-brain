# World Builder — GB10 durable progress (branch `hermes/world-builder-gb10`)

Updated 2026-10-21. Each scheduled run appends/updates this file, commits, and pushes only its own branch.

## Status
- **Signed-receipt slice: COMPLETE.** Backend, contracts, and the real HTTP report UI journey all verified.
- `docs/world-builder-remote-handoff.md` item 1 (finish report-receipt integration) is satisfied; item 2 (signing config in API guide + `.env.example`) done via `8bc5d77`.
- 4090 (King 56987795) stays on its own branch `hermes/world-builder-4090` for reconstruction/GPU work.

## Run 2026-10-21 (this run) — HTTP report UI validation finished
Baseline re-run this run (repo clean at `8bc5d77` before work):
- `PATH=/workspace/hermes-gb10/build-runtime/node/bin:$PATH node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (duration 68.996 ms).
- `/workspace/brainsnn-world-builder/.venv/bin/python -m pytest tests/world/test_report_receipts.py -q` → **18 passed in 2.88s**.

Mac UI validation (repo worktree `/Users/slavaz/the-brain-world-builder`, branch `hermes/world-builder-gb10` @ `8bc5d77`; `/tmp/world-server-venv` = Python 3.14.7, deps ok: fastapi/uvicorn/cryptography/playwright/PIL; system Google Chrome 155 used as the playwright chromium executable):
- Chromium: `WORLD_BROWSERS=chromium WORLD_SERVER_PYTHON=/tmp/world-server-venv/bin/python /tmp/world-server-venv/bin/python tests/world/report_receipt_ui_smoke.py` → PASS. Receipt:
  `{"browser":"chromium","realPrivateWorker":true,"realEd25519":true,"engine":"inspect","modelExecuted":false,"physicalCapture":false,"consentGate":true,"separateKeyTrustRequired":true,"hashesOnlyRequest":true,"exactScenarioBytes":true,"offlineNetworkRequests":0,"tamperRejected":true,"mapReviewFlagsUnchanged":true,"pageErrors":[]}`
- WebKit: same command with `WORLD_BROWSERS=webkit` → PASS, identical shape:
  `{"browser":"webkit","realPrivateWorker":true,"realEd25519":true,"engine":"inspect","modelExecuted":false,"physicalCapture":false,"consentGate":true,"separateKeyTrustRequired":true,"hashesOnlyRequest":true,"exactScenarioBytes":true,"offlineNetworkRequests":0,"tamperRejected":true,"mapReviewFlagsUnchanged":true,"pageErrors":[]}`

Both journeys: real local uvicorn worker signed an Ed25519 receipt over the exact authored scenario bytes; approval gate required separate key trust; signing request carried hashes only; tampered bundle rejected offline with zero network requests; post-receipt map edit invalidates the signed report.

4090 re-verified this run via short authenticated SSH (no tunnel): hostname `d130b6c7f3f4`, GPU UUID `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09`, branch `hermes/world-builder-4090` clean at `e109088` — no commits, no GPU work on 4090 this run (GB10/Mac validation slot).

No force-push, no merge/deploy. GB10 serving Qwen/backup and guardrail gates untouched.

## Blocker
None. `docs/world-builder-remote-progress-gb10.md` created and committed this run.

## Next bounded action
Alternate to a 4090 slot: build the separately pinned reconstruction runtime under `/workspace/slava` (never replacing base conda) and run the first bounded GPU qualification on the pinned MapAnything weights, with 20 GiB experiment cap and hostname/GPU re-check before running.
