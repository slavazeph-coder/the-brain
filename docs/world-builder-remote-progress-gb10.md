# World Builder — remote build progress (GB10)

Last updated: 2026-10-21T19:40Z
Mode: GB10 local (build/verification only; 4090 GPU tasks alternate on separate branch)

## Current status

- Repo: `/workspace/hermes-gb10/repos/the-brain` (branch `hermes/world-builder-gb10`)
- Worker: `/workspace/hermes-gb10/repos/the-brain/robotics/world_worker/`
- Test baselines re-verified at `a0e8ae0` (clean tree):
  - Node: `node --test tests/world/report-receipts.test.mjs` → 8 pass, 0 fail (66.0 ms)
  - Python: `/workspace/brainsnn-world-builder/.venv/bin/python -m pytest tests/world/test_report_receipts.py -q` → 19 passed in 6.03s
- **Run 13 (this run): signed-receipt API documentation — COMPLETE**
  - The worker API guide `brainsnn-r3f-app/public/world/api.html` documented no report-receipt endpoints at all.
  - Added to the endpoint table: `POST /v1/jobs/{id}/report-receipt` (Ed25519-signed verification receipt; signed-key-provisioned only).
  - Added full "Optional: sign completed-job receipts" section covering:
    - Key provisioning: `python -m robotics.world_worker.report_receipts init-key --private-key /operator/report-signing.key --public-key /operator/report-signing.pub` (32-byte private key, mode 0600, absolute path, must live outside `WORLD_WORKER_DIR` tree; deps in `requirements-report-receipts.txt`).
    - `WORLD_REPORT_SIGNING_KEY` requirement; public key served at `GET /v1/report-key` (schema `brainsnn.world.report-key.v1`: algorithm, keyId = SHA-256 of raw key, publicKey in canonical base64url) and advertised in `/v1/capabilities` under `reportSigning`.
    - Receipt request shape: `scenarioSha256`/`geometrySha256` (owner-declared linkage; `null` allowed) + `artifactRefs: [{name, sha256}]`; receipt never asserts measurements, safety, policy execution or independent host attestation (all such flags fixed to false).
    - Verification semantics: worker re-reads artifact bytes and verifies each against recorded SHA-256 before signing; refuses links and observed mutation; verification thread holds the single hash slot until it stops (no early free on disconnect). One verification at a time → concurrent request `429`; re-hash exceeding the time budget → `504` (slot released when the thread finishes). Signed envelope cap 64 KiB; selected artifact bytes capped at 256 MiB per receipt (`413` above). Request carries only digests/names, never source or artifact bytes; after IO the worker re-authenticates and re-checks job evidence → `401`/`409` with no new signature.
    - Offline verification: `python -m robotics.world_worker.report_receipts verify --receipt receipt.json --trusted-public-key /operator/report-signing.pub --scenario scenario.json`; verifier re-checks signature, exact schema, and exact local scenario file bytes against the signed owner declaration. Embedded public keys never establish trust.
  - HTML structure validated (tag balance check: no unclosed tags, no mismatches).
  - Baselines re-run after the edit: Node 8 pass / 0 fail; Python 19 passed in 6.03s.

## Blockers

- None. Next gate: actual HTTP report UI validation (out of scope for this run — needs live worker + signed key provisioning; remains pending).

## Next bounded action

- Commit + push this documentation commit (in progress this run).
- Follow-up runs: HTTP end-to-end report-receipt validation against a live worker instance; then continue the remaining implementation gates from `WORLD_BUILDER_CURRENT.md`.

## Guardrails

- No force-push, no merge, no deploy. GB10 build/verification only this run (4090 GPU work on its separate branch/config).
- Serving Qwen/backup, licensed model/guardrail gates, no paid fallback — untouched.
