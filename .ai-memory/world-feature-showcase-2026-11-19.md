---
type: project
description: World Builder local feature showcase, verified targets, original shareable film and preview release boundaries
---

# World Builder feature showcase

Emerson Standish's November 19 LinkedIn reference announced Dirac Robotics CAD-to-URDF. The owner asked to showcase the existing World Builder. The implementation uses original BrainSNN footage. It makes no claim that BrainSNN provides Dirac's converter. [Reference](https://www.linkedin.com/posts/emerson-standish-330203171_your-robots-keep-evolving-your-simulation-ugcPost-7529030524158349312-xu0o)

The hero links to #showcase in the existing playground. Six chapters cover 45 activities across robots, captures, 3D scenes, buildings, movement and exports. Each of the 11 film steps opens its corresponding tool. Same-page return restores focus and existing map/scan edits. Other workbenches open in separate tabs. Review-branch stereo and room editing are labelled Preview.

The original captioned film is 59 seconds, 1080 × 1350, H.264 yuv420p at 30 fps, 1,984,257 bytes. Its SHA-256 is 932e5594cb5e4c2d10902e2865120a29129eb578a0f6b00767de73213f859528. The shareable MP4, poster, WebVTT and capture proof are under /Users/slavaz/brainsnn-research/2026-11-19/world-showcase. Distinct authored examples include route replay, chair reuse, calibration walk and a 12-sheet drawing set from a local adapter.

Branch codex/world-feature-showcase extends the reviewed room editor and stereo work. Local preview uses http://127.0.0.1:60643/world/index.html?nosw=1#showcase. The World Builder Node suite, TypeScript check, production build and Chromium/WebKit browser verification cover the updated site. Public deployment and social posting are separate.

Product commit `75672367`. All 525 World Builder Node tests passed. The actual MP4 and all 45 launch actions were exercised on Chromium and WebKit, with 17 in-page destinations, 10 standalone pages and 11 timed shortcuts. Both a static range-capable host and Express passed. At 320 px an enlarged-text screen had no horizontal overflow and no scoped automated axe violations.
