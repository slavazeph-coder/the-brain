---
type: project
description: Private worker release of reviewed IFC jobs with a bounded hosted deployment acceptance
---

Deployment branch only. Integrates reviewed website main through PR #299 (f1f79214bd9d3038f6d3613bca8e4569c36a16ab) into deploy/world-worker-20261027. Preserve the worker-specific root Railway Dockerfile/startup/G1 readiness check, one replica, healthcheck, WORLD_WORKER_HOST=0.0.0.0, existing volume and pinned MoGe model. Do not merge this branch's root Railway configuration back into website main.

Includes the previously merged coarse registered-scan correction (#294), equipment overlay (#297), prior IFC review (#298), and actual private IFC/photo engines (#299). The source changes have their own main-branch CI; qualify the final deployment integration too.

The worker-only asbuilt_acceptance.py runs a bounded synthetic deployment check in the background after any enabled legacy smoke check. It reuses the existing shared site credential in memory, never retrieves/publishes it, and logs only bounded identifiers, hashes/counts and outcomes. A directly compiled authored cloud plus one freestanding box is sent through the actual site proxy and scene compiler, a 25 cm authored prior translation is corrected through the real IFC writer, originals/download hashes are checked, and missing photo evidence must remain unavailable. Report: /data/asbuilt-acceptance.json, ASBUILT_HOSTED_ACCEPTANCE log marker. A successful same-deployment and same-commit report prevents rerunning on container restart; a new deployment must recheck its environment even with unchanged code. Failure replaces an older success and logs only the exception type.

This is software/deployment execution on synthetic points. It is not a phone capture, independent dimensional/survey test, actual source-photo production qualification or physical robot validation. Actual retained raster/pose behavior was exercised with labelled authored captures in local and CI Chromium/WebKit tests. Check the exact new Railway deployment reaches SUCCESS and read its own acceptance marker before reporting hosted execution verified. A healthcheck alone does not establish the acceptance result.
