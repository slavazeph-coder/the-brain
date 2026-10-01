---
type: project
description: BrainSNN playground toys (Sept 2026) — poke-the-brain homepage hero plus three toy routes; where the code lives and the rules it follows
---

# BrainSNN playground toys (2026-09)

- Deployed package is `brainsnn-r3f-app` (Railway Dockerfile copies only it). `ui/brainsnn-site` is NOT deployed — build site features in r3f-app.
- Homepage `/` = Poke the Brain hero (jelly shell + seven-region model), then More toys, the tools section (#tools), evidence note, BrainSNN strip (Sponsor `/sponsor/gt3/`, Enterprise `/arcade#brief`).
- Toy routes: `/toys/fool-the-detector` (toy2), `/toys/draft-duel` (toy3), `/toys/defend-the-brain` (toy4, wraps BrainGameLab via new optional `onRunComplete`).
- Registry: `src/features/toys/toyConfig.js` — hooks, `?src=toyN-share` tags, `SPONSORS` (empty; one edit fills chip, clip outro, card footer).
- Jelly: closed-form springs in the vertex shader; tune `JELLY` in `poke/jellyPhysics.js`; mesh in `poke/brainShell.js` (procedural, no GLB). Only `PokeBrainScene.jsx` imports three (allowlisted in check-three-imports, React.lazy only).
- `attribution.js` reads `src` as an alias of `s`. Toy analytics events are in both allowlists (analytics.js + eventSink.js).
- OG cards: `npm run og:toys` against a running build writes `public/og/toy-*.png`; routeMeta test fails if one is missing.
- Copy rules: brain is a simulation, never "neural data"/EEG; keep Defend disclaimers verbatim; detector's paraphrase blind spot is stated, not hidden. Colours: bh tokens only (cyan #68eaff / violet #947cff on #05070b).
- Docs: repo-root `BUILD-NOTES.md` (engineering) and `CONTENT-PLAYBOOK.md` (clip scripts, cadence, link tags).
