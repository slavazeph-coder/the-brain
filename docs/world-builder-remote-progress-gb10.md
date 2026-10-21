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

## Run 2026-10-21 (9th) — report-receipt cancellation/deadline test
Baseline re-run at `d026274` (clean tree):
- Node: `PATH=/workspace/hermes-gb10/build-runtime/node/bin:$PATH node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (84.4 ms).
- Python (before new test): `pytest tests/world/test_report_receipts.py -q` → **18 passed in 2.91s** (previously verified at d026274).

New test added: `test_report_receipt_exceeding_wait_budget_returns_504_and_releases_slot`
- Monkeypatches `REPORT_HASH_SECONDS=1`, `REPORT_WAIT_SECONDS=3` so the hash thread overruns its deadline.
- Proves: first request → 504 (overrun); concurrent request while thread still holds slot → 429; after release → 200 (slot released, signing works).
- Full suite after: **19 passed in 6.09s**.

4090 re-probe (short SSH, no tunnel): hostname `d130b6c7f3f4`, GPU `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09`, branch `hermes/world-builder-4090` clean at `e109088` — no GPU work this run (GB10 test slot).

No force-push, no merge/deploy. GB10 serving Qwen/backup and guardrail gates untouched.

## Re-verification 2026-10-21 (after HTTP UI commit) — checkpoint
Mac worktree fast-forwarded `8bc5d77` → `3cc2068` (no force; local `.ai-memory/` dirty files untouched and not committed). Re-ran at `3cc2068`:
- Node baseline: `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (71.4 ms).
- Python baseline: `pytest tests/world/test_report_receipts.py -q` → 18 passed in 2.89s.
- Mac Chromium UI smoke: PASS. Receipt identical to run above: `{realPrivateWorker, realEd25519, consentGate, separateKeyTrustRequired, hashesOnlyRequest, exactScenarioBytes, offlineNetworkRequests:0, tamperRejected, mapReviewFlagsUnchanged, pageErrors:[]}`.
- Mac WebKit UI smoke: PASS, identical receipt shape.
- 4090 re-probe (short SSH, no tunnel): hostname `d130b6c7f3f4`, GPU UUID `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09`, branch `hermes/world-builder-4090` clean in sync with origin; `build-runtime/` already has node v22.23.3 + `worker-tests` runtime — pinned reconstruction runtime is the next item, GPU untouched this run (GB10/Mac slot).

No force-push, no merge/deploy. GB10 serving Qwen/backup and guardrail gates untouched.

## Run 2026-10-21 (11th) — 4090 recon-venv dependency gap closure

GB10 baseline re-run (repo clean at `54b1bcc`):
- `PATH=/workspace/hermes-gb10/build-runtime/node/bin:$PATH node --test tests/world/report-receipts.test.mjs` → **8 pass, 0 fail** (66.3 ms).
- `/workspace/brainsnn-world-builder/.venv/bin/python -m pytest tests/world/test_report_receipts.py -q` → **19 passed in 6.17s**.

4090 re-probe (short SSH, no tunnel): hostname `d130b6c7f3f4`, GPU `GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09`, branch `hermes/world-builder-4090` clean at `e109088`.

recon-venv dependency audit (before):
- OK: einops 0.8.2, sklearn 1.7.2, hydra 1.3.7, uniception, torch 2.5.1+cu121, cv2 4.10.0
- MISSING: easydict, ftfy, regex, transformers, kornia, scenedetect, moviepy, imageio, pycocotools, ninja, pycolmap

Installed (pip, no base-conda replacement):
`easydict ftfy regex einops kornia scenedetect moviepy imageio scikit-learn pycocotools ninja hydra-core pycolmap==4.2.1`

recon-venv dependency audit (after):
- ALL OK: easydict, ftfy 6.3.1, regex 2026.9.29, einops 0.8.2, kornia 0.8.2, scenedetect 0.7.2, moviepy 2.1.2, imageio 2.38.0, sklearn 1.7.2, pycocotools, ninja 1.13.2, hydra 1.3.7, uniception, torch 2.5.1+cu121, cv2 5.0.0, pycolmap 4.2.1, PIL 11.3.0
- Note: transformers NOT required by worker (only depth_small.py uses it); not installed.

Worker module import verification:
- `from robotics.world_worker import sparse_colmap, geometry, mapanything_apache` → **OK**
- `mapanything_apache.py` only requires: torch, uniception 0.1.7, mapanything (from uniception), numpy, PIL
- `sparse_colmap.py` requires: pycolmap 4.2.1, PIL, numpy
- All now present in recon-venv.

No GPU work this run (env closure is the bounded step). No force-push, no merge/deploy. GB10 serving Qwen/backup and guardrail gates untouched.

## Blocker
None. recon-venv now has all worker dependencies. Worker modules import successfully.

## Next bounded action
4090 slot: run first bounded GPU qualification via `qualify_child.py` (or equivalent) on the pinned MapAnything Apache-2.0 weights with 20 GiB experiment cap. Confirm hostname/GPU before running.
