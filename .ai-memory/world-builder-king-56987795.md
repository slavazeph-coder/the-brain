---
type: project
description: Verified replacement King RTX4090 worker, restored source and local Hermes continuation
---

# King56987795 — October21,2026 UTC

- Owner's replacement: root@ssh2.vast.ai:23990, /workspace/slava. Strict Mac Slava-key and GB10 gb10-rebuild-key logins both passed using the existing trusted pin. Host d130b6c7f3f4; RTX4090 UUID GPU-3390c2ec-628e-16e5-defd-e8bb95d5bb09;24,564MiB GPU;751,619,276,800bytes disk(700GiB). GPUpriority is owner-reported. Old stopped container/data untouched.
- Base Python3.10.13, Torch2.1.2, CUDA12.1, driver535.230.02. Actual four-element CUDA test returned4. GPU reconstruction on this new image remains unqualified; create a separate pinned environment rather than replacing base conda or GB10 serving packages.
- Repo /workspace/slava/the-brain, branch hermes/world-builder-4090, at e109088973e6a27333b172780c3ebc3be20662f6. Actual GitHub push passed with new repo-only deploykey167135000; its private key remains under /workspace/slava/.repository-keys/. No personal private keys copied.
- Snapshot /workspace/slava/source-snapshots/e109088973e6a27333b172780c3ebc3be20662f6/the-brain: all955committed paths/hashes verified; repeated sync safely reused it. Archive21,647,360bytes; SHA256 e69c81f868d418b8bf98935dff7a3afa288182ca4c0d4154cf4c262ab2611f40. Active GB10 edits preserved/excluded. Temporary SSH connections closed.
- GB10 helper /workspace/hermes-gb10/bin/world-builder-sync-4090 now targets King. Private context/world-builder-4090.json updated with old-route backup. Transfer receipt: /workspace/hermes-gb10/home/context/world-builder-source-snapshot-receipt.json. Earlier outage receipts remain historical; no new endpoint question is needed.
- Isolated CPU test runtime /workspace/slava/build-runtime/worker-tests/bin/python:47receipt/tenant tests passed using exact repo base/signing requirements plus pytest9.1.1,httpx0.28.1,test-only Pillow12.2.0. Private official Node22.23.3 x64:8receipt tests passed. This does not qualify the complete reconstruction/observation/browser suites.
- Run . /workspace/slava/world-builder-env.sh first. Bootstrap evidence: /workspace/slava/world-builder-bootstrap-receipt.json and build-runtime logs. No production services or model environments changed.
- Hermes current handoff now starts with verified King details and removes the stale current-outage block. Native job dc490fdac994 remains active every20minutes using local Qwen; existing03:31UTC run was preserved without duplication. Next work: checkpoint existing GB10 edits, prepare King's reconstruction runtime, reuse verified GB10 weights, then realGPU qualification under existing20GiB/time/health and license/guardrail gates. Mac SSH/SFTP remains available for browser checks.
- Full flagship remains draft PR198. No merge/deployment/public processing activation. Do not revive unrelated oldGPUjobs or confuse this new container with the historical unverified slava SSH2223 host.
