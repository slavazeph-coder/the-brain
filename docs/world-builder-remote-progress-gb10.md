# World Builder — remote build progress (GB10)

Last updated: 2026-10-21T21:52Z
Mode: GB10 local (build/verification only; 4090 GPU tasks alternate on separate branch)

## Current status

- Repo: `/workspace/hermes-gb10/repos/the-brain` (branch `hermes/world-builder-gb10`)
- Worker: `/workspace/hermes-gb10/repos/the-brain/robotics/world_worker/`
- Test baselines re-verified at `d505bd1` (clean tree):
  - Node: `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (105.7 ms)
  - Python: `/workspace/brainsnn-world-builder/.venv/bin/python -m pytest tests/world/test_report_receipts.py -q` → 19 passed in 6.45s
- **Run 17 (this run): loopback HTTP end-to-end signed-receipt driver — COMPLETE, GREEN**
  - Driver: `/workspace/hermes-gb10/home/cache/scratch/wb_loopback_driver.py` (throwaway; not committed)
  - Fixes applied this run:
    1. `uvicorn 0.54` stores bound sockets on `Server.servers`, not `config.servers` → changed port line from `SERVER.config.servers[0].sockets[0]` to `SERVER.servers[0].sockets[0]`.
    2. Receipt envelope uses `payloadText`/`payloadSha256`, not `payload` → assertion corrected to check `payloadText` and `payloadSha256` (envelope is `['schema','algorithm','keyId','payloadText','payloadSha256','signature']`).
  - Full HTTP sequence verified:
    - `GET /healthz` → 200
    - `GET /v1/capabilities` → `reportSigning.available=True`, algorithm `Ed25519`, real keyId printed
    - `GET /v1/report-key` → keyId matches capabilities; publicKey served
    - `POST /v1/uploads` → 201; `PUT /v1/uploads/{id}?offset=0` → 200, 70 bytes
    - `POST /v1/jobs` (inspect engine, `consent=true`) → 201; `POST start` → 200
    - `GET /v1/jobs/{id}` polled → `complete`; artifact `capture-integrity.json` sha256 recorded
    - `POST /v1/jobs/{id}/report-receipt` → 200, Ed25519 signature issued
    - Tampered `artifactRefs` (wrong sha256) → HTTP 409 `"Artifact references do not match the completed job."`
    - Offline verify (`receipt verify --receipt … --trusted-public-key … --scenario …`) → exit 0, claim: "Worker receipt and exact scenario hash verified. Measurements, model truth and host independence remain unverified."
    - Tampered scenario bytes → rejected exit 2
  - Worker dir cleaned up after test; no residual state.

## Blockers

- None. All signed-receipt API gates pass on loopback. HTTP report UI validation (browser-level, real app) remains the only remaining gate before release work can be considered complete.

## Next bounded action

- Run 18: 4090 GPU task (alternation per task prompt) — short authenticated SSH, confirm hostname + GPU, then a bounded experiment or config check on `hermes/world-builder-4090` branch. Preserve existing 4090 experiments and GPU budgets. No permanent tunnel.

## Guardrails

- No force-push, no merge, no deploy. GB10 build/verification only this run (4090 GPU work on its separate branch/config).
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
