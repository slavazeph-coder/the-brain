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

## October 28 integration follow-up

The ZIP exactly matched PR253 source. Isolated integration checkout: `/Users/slavaz/the-brain-launch-integration`; original dirty checkouts preserved. Native capture JSON +3–11 original photos now enter the existing authenticated worker, supply fixed calibrated COLMAP cameras, and undergo checked post-solve ARKit alignment. No phone app or physical scale certification is implied. See docs/world-native-capture.md.

Production scene compiler now uses conservative surface-pair candidates instead of p90–p10 scatter falsely labeled measured. IFC/Rhino/quantity labels keep verification false; geometry edits discard stale evidence. Native Blender5.1 synthetic runs revealed invalid comma-separated USD customLayerData: fixed and independently reopened with usd-core25.8. Production Blender4.2 still requires its deployment check.

SimReady imports reject reset transform stacks including instance proxies, unsafe convex-hull overrides on instanced assets, and output paths inside source packages. Exact upstream NVIDIA library schema was checked. Real NVIDIA asset/Isaac physics qualification is still absent.

Working public URL is https://www.brainsnn.com/world/ (TLS valid, health and processing200, unauthenticated capabilities401). Apex brainsnn.com still points to GoDaddy and returns404 on deep links; GoDaddy browser access is signed out. Railway connector works but redacts passcode; local CLI is unauthorized. User was asked to refresh local railway login, never paste secrets. Authenticated live reconstruction remains pending.

Website follows main. Worker follows deploy/world-worker-20261027 with worker-specific root railway.toml; preserve that config and WORLD_WORKER_HOST=0.0.0.0. Do not merge worker root config into main.


## October 28 follow-up — browser capture and real NVIDIA composition

User requested finishing the launch through the Railway and GoDaddy plugins. Both production deployments from PR #253 remain healthy. Railway OAuth still redacts variable values; local CLI is unauthorized. GoDaddy plugin exposes only domain search, and Safari is at sign-in. The user was asked to sign in to GoDaddy and run `railway login`; no credentials were replaced and no DNS changed.

The browser now recognizes native capture metadata, offers a calibrated-capture picker, checks exact original image hashes locally before uploading, and sends JSON plus photos through existing capabilities/consent/authentication. Missing/changed inputs send zero uploads. Chromium and WebKit mobile-sized flows passed against a real authenticated local worker and actual COLMAP with the synthetic known-camera room. All 139 JS tests, app typecheck and production build passed. These are synthetic software tests, not physical phone qualification.

The native submission CLI requires source-bound native evidence, a consistent fold check, nonempty finite sparse geometry and a valid camera ledger, with matching original sources and hashes. A failed submission keeps a credential-free receipt and last observed job ID/status; cancellation is requested on timeout. Focused review caught and closed absent geometry, lost timeout receipt and invalid camera source-index acceptance.

The real pinned NVIDIA IV_pole_a01 package contains 16 enabled colliders inside instance proxies (the old inspection counted zero). All 118 files / 421,351,635 bytes were checked against the immutable upstream tree. Two relocated placements preserve 32 colliders, 32 rigid bodies and 30 joints; their active dependencies stay in the portable package. The qualifier checks requested placement, source containment before writes, unchanged package bytes and attribution. Independent artifact rehash/reopen passed. No Isaac/PhysX dynamics were run; physics readiness and metric verification remain false.

A read-only preflight reached the existing RTX 4090 and confirmed its expected identity; it is idle with ample space but has no Isaac/Omniverse runtime or NVIDIA Vulkan ICD in this container. It remains separate from the working private CPU production worker. Native phone app, real captures with held-out dimensions, apex routing and Isaac simulation remain open; do not call the full launch physically qualified.


### Measurement-view regression found during PR #256 release checks

The first Linux CI head timed out in the dimensional point-picking browser test. That exact timing failure did not reproduce locally; a deterministic layout regression did: expanding the new capture controls grew the desktop canvas from about 2,809 to 3,036 px. Desktop stage alignment and a 425–680 px viewport now prevent sidebar forms from resizing/reprojecting the cloud. Starting scale/dimension picking scrolls the canvas into view once; the second pick brings the distance input into view, and the inline canvas hint explains selection.

Browser tests now assert stable canvas dimensions and position after the first pick, recompute visible point targets for each tap, verify both selections and product-driven scrolling, and retain failure geometry/screenshots. No test-driven canvas scroll masks the user flow. Full scene matrix passed Chromium desktop/phone and WebKit; standalone real-to-sim passed four desktop/phone contexts; all 139 JS tests, typecheck and production build passed. Recheck the new remote CI head before merging.
