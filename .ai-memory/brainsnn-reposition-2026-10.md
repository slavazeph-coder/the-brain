---
type: project
description: Arena-led lobby and unified Review implementation following PR 186; route and capability boundaries
---

# BrainSNN repositioning, October 2026

## Latest owner correction — October 17

The owner rejected the restrained Arena: “I like the previous arcade style
better it seemed more interactive and fun. You could pick desired robot and
LLM to test.” This supersedes the original rule below that hid controls until
the first completed run. Robot/model selection, starter profiles, challenges,
camera and world controls should be available immediately. Preserve selected
pairs and truthful worker readiness; do not silently substitute a scripted arm.
Replay and inspection still depend on actual recorded evidence. The follow-up
is developed on `codex/restore-arena-selection`, with release marker
`arena-arcade-selection-2026-10-17-v1`.

The restoration also adds five visible practice challenge chips, an accessible
Run/Pause control above the scene, a desktop setup column and compact mobile
tool strips. Worker readiness, exact profile validation, native recording and
the disabled paid-analysis release remain intact. Browser contracts cover
1280px and 390px startup choices, selection persistence, mismatched-profile
refusal, explicit worker requests and separately labeled scripted practice.
`npm run lint`, 1,068 application checks, 73 analysis checks, Arena logic,
selection/inspection/paid-analysis browser flows and ten HTTP route checks
passed locally. CI retains the startup screenshots as an artifact.

## Earlier approved implementation

Owner approved an Arena-led lobby rather than making the simulator the homepage.
Implementation was developed on `codex/arena-review-consolidation` atop PR #186
(`lobby-home`). PR #187 was merged into `lobby-home` as `6f62616c` on October17 UTC.
PR #186 merged into main as `8240173c` on October17 UTC after all CI checks passed.
Its GitHub deployment was cancelled during build when late review findings
identified duplicate task chrome and the hidden practice action for restored
named robot selections. A follow-up fixes those before rollout; check the
deployment workflow for live status. The final Arena marker is
`2026-10-16-arena-review-2`.

- Public navigation: Arena, Review, Evidence; Lab in overflow. Near-black/cyan/violet identity retained.
- `/office?tab=passage|drafts|claims|video` is the Review workbench. `/app`, `/engine`, `/reconstruct` redirect there. The previous Reconstruct route was a separate project landing page; Claim split now identifies source-anchored wording cues, not factual verification.
- `/lab` is the index; powder is `/lab/powder`; legacy `/lab?grid=...` links redirect with the grid intact. Jelly brain and its share links are `/play`.
- `/missions` redirects to `/arena/`. Existing deterministic tasks and published task links live under `/arena/tasks`, carved out before the standalone Arena static router. APIs remain unchanged.
- Arena starts paused with one Run action. Controls unlock only after a completed run; scripted runs are local practice and never a named-model score. Internal worker wire value `benchmark` stays for protocol compatibility, while visible UI calls it a locked run.
- Source findings must match actual spans or supplied/measured timestamps. No inferred timestamps for untimed captions. Video supports pixel/audio/caption cues, not object recognition.
- A named model execution is still the gate for new capture/monetization. No new email capture or pricing table was introduced.

## Verification

- `npm test`: 1,068 passing checks; TypeScript lint and production build pass.
- Full browser run: 113 passed, one intentional mobile WebGL skip; 14 initial failures were stale selectors, native-share interference, or production-only metadata checks run against dev. All 14 passed after correction in a 22-case production rerun; four additional desktop/mobile task migration checks pass.
- `scripts/test-arena-route.mjs`: 10 HTTP checks pass. `robotics/arena/scripts/check-arena.cjs`: complete suite passes, including first-run restraint and worker failure behavior.
- Saved reviews, versions, manual approvals, JSON downloads, suggested edits/undo and sentence-move diffs remain inside Review. Existing local data keys are unchanged.
- The prior Coherence pilot is now a Lab research preview; its real fixture and failed-gate evidence remain, while the price and capture form are removed.

## Merge authorization and release gates

- Owner authorized merging when ready on October16. Combine #187 into its
  parent `lobby-home` first, then merge the complete #186 into main after its
  checks pass. This avoids deploying #186's intermediate review findings.
- The three #186 review findings (poke registry/share route, obsolete toy nav,
  and homepage browser expectations) are addressed by the consolidation.
- Pre-merge review found stale deployment checks: old Sapient homepage title,
  old Arena release marker and post-deploy links to /app and /engine#api.
  Updated to the lobby title, `2026-10-16-arena-review-1`, and Arena/Review/Evidence
  with Lab overflow/footer. Production boot/redirect checks and desktop/mobile
  navigation assertions pass. Sponsor gates now cover LobbyHome/PublicNav/nav.
- The TViz/inspection document is research only; merging it does not implement
  the proposed inspection layer or establish a named-policy GPU run.
- A late automated review found that AppShell's passive title effect can
  overwrite nested Review-tab and Arena-task titles during hydration. Fixed
  with a query-aware layout-effect fallback before child title effects. The
  two regression cases fail on the old compiled build and all four desktop/
  mobile cases pass on the corrected production build, including task-index
  and unavailable-task fallback titles.
- Final navigation follow-up: restored URL/storage robot selections expose an
  explicit local-practice choice before connecting a worker. Switching modes
  preserves the selected robot/model/task/seed and cannot manufacture a policy
  score. New visitors still see one paused mission and one Run button.
- Arena task children accept an embedded mode that omits legacy navigation,
  footers and nested site wrappers. Curated tasks, builder and published task
  loading/ready/error states now share one public shell. The previous CSS-only
  hiding rule was removed; DOM-count regressions prevent duplicates returning.
