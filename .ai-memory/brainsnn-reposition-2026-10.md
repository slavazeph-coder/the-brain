---
type: project
description: Arena-led lobby and unified Review implementation following PR 186; route and capability boundaries
---

# BrainSNN repositioning, October 2026

Owner approved an Arena-led lobby rather than making the simulator the homepage.
Implementation branch `codex/arena-review-consolidation` builds on open PR #186 (`lobby-home`). Do not describe the branch as deployed without deployment evidence.

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
