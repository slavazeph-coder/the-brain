---
type: project
description: SimReady/capture evidence utilities and Railway worker deployment status, with explicit remaining integration gaps
---

# World Builder launch work — October 27, 2026

PR #253 adds operator-side SimReady Central package inspection/review/portable USD additions, a source-bound ARKit capture-bundle validator and conservative paired-wall-surface candidates. These are not yet connected to public upload, reconstruction solving or the production scene compiler. They do not fix the existing production thicknessMeasured heuristic. No native phone app, dense GPU inference, automatic MEP fitting or Isaac Sim stress test was completed in this slice.

At code commit 9c3790bbb8a803b0e71e5db957f0530728f1ed82, local tests ran 34 cases (31 passed, 3 skipped for absent pxr). GitHub Actions World launch extensions run 40610500369 passed its mandatory pxr import and capture/evidence/USD-roundtrip tests. World Builder contracts were still running when this note was written. Recheck PR checks before merging.

Railway's private world-worker reached SUCCESS at deployment 76606b5c-34e9-477f-8016-a59de47a2977 after WORLD_WORKER_HOST=0.0.0.0 corrected its failed IPv6-only healthcheck. One replica, 4-vCPU/8-GB limits, 10-GB /data volume; no public worker domain. Worker source remains deploy/world-worker-20261027, website main. Do not merge the deployment branch's worker-specific root railway.toml into the website main branch.

Public browser verification on the Railway website hostname observed healthz=200, processing available=true/passcode=true/visitors=false, and unauthenticated capabilities=401. No authenticated video reconstruction or metric export was run. Secrets remain in Railway, never in source or this note.

Railway domain-status says brainsnn.com traffic DNS requires tnoamdbj.up.railway.app and its certificate is issuing. Resolve via the actual DNS provider; preserve unrelated DNS and mail records. The temporary website hostname is the-brain-production.up.railway.app.

Full commands, schema and limitations: docs/world-simready-launch-20261027.md. Do not report library assets as observed capture geometry or promote tests/scale priors to physical qualification.
