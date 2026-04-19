# Good first issues

Eight contributor-friendly starting points. Each links to the layer it
touches and gives you the code entry point so you can open a PR without
a deep repo tour.

## 1. Add a manipulation category to the Cognitive Firewall

**Layer 4** — `brainsnn-r3f-app/src/utils/cognitiveFirewall.js`

Add a new pattern category (e.g. `tribalism`, `scarcity`, `socialProof`)
with 6–10 regex patterns, expose it via `DEFAULT_RULES`, and add matching
attack samples to the red team corpus so evolution can grade it.

Files to touch:
- `src/utils/cognitiveFirewall.js` (add the patterns)
- `src/utils/redTeam.js` (add 5–8 attack samples + benign controls)
- `src/components/CognitiveFirewallPanel.jsx` (add the score field if
  you want it visualized)

## 2. Add a neurotransmitter preset to the Neurochemistry Sandbox

**Layer 30** — `brainsnn-r3f-app/src/utils/neurochemistry.js`

Add a named preset (e.g. `ketamineMicrodose`, `propofol`,
`melatonin`) with a 6-NT signature. Presets are objects of the form
`{ dopamine, serotonin, cortisol, oxytocin, norepinephrine,
acetylcholine }` on a 0–1 scale.

## 3. Add an affect class to the 12-affect taxonomy

**Layer 29** — `brainsnn-r3f-app/src/utils/affectiveDecoder.js`

Add a new 13th affect (e.g. `envy`, `contempt`, `gratitude`) with its
Russell circumplex coordinate (valence × arousal), evidence keywords,
and per-region glow profile.

## 4. Add a pre-seeded demo tile to the landing page

**DemoTiles** — `brainsnn-r3f-app/src/components/DemoTiles.jsx`

Add an extra tile (e.g. `AI-generated political ad`, `viral product
launch`, `scam DM`, `grief-bait headline`) to the `TILES` array with
a short example text + emoji + hint label.

## 5. Write unit tests for the STDP update rule

`brainsnn-r3f-app/src/utils/sim.js`

No test runner yet — add Vitest (`npm i -D vitest`), add an `npm test`
script, and cover:
- weights strengthen when pre fires before post
- weights weaken when post fires before pre
- bursts increase activity on downstream regions
- reset() returns the initial state shape

## 6. Add reduced-motion support to the 3D scene

`brainsnn-r3f-app/src/components/BrainScene.jsx`

Respect `prefers-reduced-motion: reduce` by damping particle speed,
disabling camera auto-rotate, and reducing pulse wave amplitude.
Already a partial hook in `src/styles.css` — extend it into the R3F
scene.

## 7. Write a mobile camera gesture polish

`brainsnn-r3f-app/src/components/BrainScene.jsx`

Improve pinch-to-zoom sensitivity, add a two-finger pan, and debounce
the quality auto-switch so iOS Safari doesn't thrash between tiers on
scroll.

## 8. Add a pre-computed scenario pack to the TRIBE v2 server

**Layer 3** — `brainsnn-r3f-app/server/scenarios/`

Drop in a new scenario (e.g. `musical_improv`, `dreaming`, `argument`)
as a `.pkl` or JSON of per-region activity frames over time. Wire it
into `api.py` `/scenarios` endpoint so the SPA can select it.

## Conventions

- Small PRs. One issue per PR.
- Follow the existing regex / scoring function style — deterministic
  pure functions where possible.
- If you change a scoring rule, add a matching red team corpus entry so
  Brain Evolve can grade it.
- No new heavy dependencies without discussion — the repo's appeal is
  that it runs browser-first.
