# World Builder: remote build handoff

Owner instruction, October 20, 2026: continue the build on GB10 and the RTX 4090 around the clock using Hermes and local inference, avoiding recurring paid Codex work.

## Source and ownership

- Repository: `https://github.com/slavazeph-coder/the-brain` (public; anonymous clone works).
- Reviewed development baseline: `feature/world-builder-flagship` at `c82e2baa81701f704cc53af327d0565d8c8f8e2d`; draft PR [198](https://github.com/slavazeph-coder/the-brain/pull/198).
- This checkpoint preserves the unfinished report-signing slice on `handoff/world-builder-remote-20261020`. It is not a release or evidence that every integration check passed.
- GB10 working clone: `/workspace/hermes-gb10/repos/the-brain`; its progress branch is `hermes/world-builder-gb10`. Give the 4090 a separate clone and `hermes/world-builder-4090` branch. Never have both hosts push the same working branch.
- Commit and push small, tested changes with exact validation results. Do not force-push, merge into main, deploy, enable public processing, or alter production model services as part of the background build.

## Start from actual source

Read `docs/world-studio-implementation.md`, `docs/world-reconstruction-validation.md`, `docs/world-generative-qualification.md` and `.ai-memory/world-builder-2026-10.md` selectively. The repo already contains a web UI, worker jobs, tested MapAnything dictionary-view inputs, and real GB10 inference receipts. Older Hermes summaries saying those pieces are absent or blocked by repository privacy are stale. Preserve its separate experiments and compare their files and receipts before importing anything. Point density does not establish metric accuracy; experimental depth results do not qualify real measurements.

## First bounded tasks

1. Finish report-receipt integration. Backend checkpoint: 144 tests passed with two explicit dataset-dependent skips; 83 Node contracts passed. Real Python/native-browser Ed25519 interoperability passed in Chromium and WebKit. The actual HTTP signing/UI journey is still being diagnosed; rerun `tests/world/report_receipt_ui_smoke.py` and record its actual outcome before calling this slice complete.
2. Add report-signing configuration to the API guide and `.env.example`; add HTTP cancellation/deadline tests retaining the one-hash-task slot until its thread stops, plus cancellation while final source hashes are checked. Signing stays disabled without a separately provisioned persistent Ed25519 key. Embedded public keys never establish trust. **Status 2026-10-22:** the signed-receipt API/env documentation is now the "Report receipts (signed verification)" subsection in `docs/world-studio-implementation.md` "Worker operation"; cancellation/deadline behavior is already covered by `tests/world/test_report_receipts.py` (loopback) and the flaky 504 poll-wait fix `04e1e79`.
3. Run the relevant Node/backend checks and production/browser regression after fixes. Install dependencies in a dedicated build environment. Do not modify the serving model's environment to satisfy project dependencies. If browsers cannot run on a host, leave that validation explicitly pending or use the existing CI workflow.
4. Continue the full release requirements in `docs/world-studio-implementation.md`: dense reconstruction/geometry review, qualified isolation, public accounts/key issuance, durable queue/storage and metered compute, generative model qualification, and capture quality. Pick one independently verifiable change per run. Keep physical iPhone, measured-site and supervised-cleaner validation pending until real inputs exist.

## Operation

Hermes primary is the existing local `qwen3.8:27b` service; preserve the primary, local backup and phone/API responsiveness. Use no paid provider fallback. Use bounded CPU tasks first and schedule GPU work only under the existing memory/timeout/health guards. Never unload the serving model to make an experiment fit. Keep model checkpoints hash-pinned and preserve license/guardrail gates.

Use the native Hermes scheduler with local-only delivery and continuity. Each run must read its durable progress log, inspect the branch, make or verify one bounded change, then write the commit, exact commands/results and next action. A repeated blocker must lead to a different useful task instead of repeated downloads, research or status-only output. Stop the background build when the owner cancels or when all release work is verified; do not fabricate physical evidence.

The 4090 is intermittently rented and its endpoint can change. Verify its current authenticated identity and GPU before each work window. Keep a host-local checkout and use short SSH sessions; do not create a permanent tunnel or shared mount. If it is inaccessible, record the failure once and continue useful GB10 work.
