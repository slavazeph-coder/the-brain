# BrainSNN Playground — build notes

The playground toys live in **`brainsnn-r3f-app/`**, the package Railway deploys to www.brainsnn.com. `ui/brainsnn-site/` is **not deployed** (the Dockerfile copies only `brainsnn-r3f-app`). That is why the build prompt's "Phase 1 in `ui/brainsnn-site/src/App.jsx`" went into the deployed app instead. Everything below is client-side. There is no new backend route, no auth and no paid service.

| Toy | Route | Hook | Share tag |
|---|---|---|---|
| 01 Poke the Brain | `/` (homepage hero) | poke the brain and watch the signal travel | `?src=toy1-share` |
| 02 Fool the Detector | `/toys/fool-the-detector` | can you fool our AI detector? | `?src=toy2-share` |
| 03 Draft Duel | `/toys/draft-duel` | make two drafts fight | `?src=toy3-share` |
| 04 Defend the Brain | `/toys/defend-the-brain` | can you keep the brain from getting hijacked? | `?src=toy4-share` |

All four are registered in `src/features/toys/toyConfig.js`, which is the single source for route, hook, share tag and sponsor slot. Captions, cards, the "More toys" row and crawler previews all read from it, so a hook can't drift between them.

---

## 1. How the jelly works

Files: `src/features/toys/poke/`

| File | Role |
|---|---|
| `brainShell.js` | Procedural brain surface: silhouette, fissures, sulci, normals. Three-free and unit-tested. |
| `jellyPhysics.js` | Impulses, springs, squash, ring pulses, pathway cascade. Three-free and unit-tested. |
| `PokeBrainScene.jsx` | The only module that imports three: shaders, raycasting, pointer handling, render loop. |
| `PokeBrain.jsx` | The hero section: 2D fallback, HUD, Shake/Reset/Share, share sheet. |
| `pokeTier.js` | Chooses `high`, `low` or `2d` per device. |

No vertex is simulated on the CPU. Each frame the CPU writes a few `vec4` uniforms, and the vertex shader computes the deformation in closed form. That keeps the effect at 60 fps and makes the physics testable in bare Node.

1. **Impulses (the dent).**
   - A poke is a gaussian dent at the hit point: `p += dir · a · exp(-|x - origin|² / r²)`.
   - Up to 8 are live at once, as a ring buffer in `uImp[8]` / `uImpDir[8]`.
   - The shader also bends the normal by the dent's gradient, so the dent catches the light rather than just moving vertices.
2. **Springs (the wobble).**
   - On release, each impulse becomes a damped spring: `a(t) = a0 · e^(−ζωt) · cos(ω_d t)`, with `ω_d = ω√(1−ζ²)`.
   - It is under-damped (`zeta 0.15`), so it overshoots past flat and wobbles back.
   - That overshoot is the watermelon-jelly feel.
3. **Grab and stretch.**
   - Press on the brain and drag.
   - The pointer is unprojected to the grabbed point's depth and converted to object space.
   - The dent follows the pointer in the screen plane (`dragHeldVector`), capped at `maxPull`.
   - Letting go springs back along the stretch.
   - A tap with no real drag still gets a full `pokeAmplitude` wobble.
4. **Squash (the body).**
   - Every release also sets the whole mesh oscillating along the poke axis: stretch along it, thin across it, volume roughly kept.
   - This is what makes it read as one soft object instead of a rubber sheet.
5. **Signals.**
   - A ring pulse expands across the surface from the hit point (fragment shader, `uPulse[8]`).
   - The nearest of the seven regions fires down its outgoing `PATHWAYS` edges, hop by hop (`hopSeconds`), up to `cascadeDepth` hops.
   - Inhibitory pathways quench instead of propagating.
   - A first-hop arrival flashes the surface above its region.
   - The "signals fired" counter counts real hops through the graph.
   - It also drives the site's existing `useBrainSimulation` (`stimulate` + `triggerBurst`), so the model inside is the one the rest of the site runs.
6. **Raycasting.** Pointer rays hit a coarse invisible proxy shell (about 2k triangles), not the visible 37k-triangle mesh. Picking costs nothing per pointer move.

### Where to tune

| What | Where | Knobs |
|---|---|---|
| Wobble speed and length | `JELLY` in `jellyPhysics.js` | `omega` (stiffness, ~2.3 wobbles/s now) and `zeta` (damping; 0.15 means a long, satisfying tail, 0.3 means a quick settle) |
| Poke size | `JELLY` | `pokeAmplitude`, `pokeRadius`, `grabRadius` |
| Drag feel | `JELLY` | `dragGain`, `maxPull`, `maxPush` |
| Whole-body squash | `JELLY` | `squashGain`, `squashMax`, `squashOmega`, `squashDecay` |
| Spike rings | `JELLY` | `pulseSpeed`, `pulseWidth`, `pulseLife` |
| Cascade | `JELLY` | `hopSeconds`, `cascadeDepth` |
| Glow intensity | `FRAGMENT` in `PokeBrainScene.jsx` | `glow = 1.0 - exp(-glow * 1.3)` (saturating, so ten overlapping pulses don't white out), then `col += glowCol * glow * 1.25` |
| Colours | `PokeBrainScene.jsx` constants | `CYAN #68eaff`, `VIOLET #947cff`, `MINT #73efba`, `INHIBIT #fb7185`, the same tokens as `behaviour-home.css`. The shell blends cyan → violet front to back (`smoothstep(-5.4, 5.4, x)`). |
| Idle behaviour | `PokeBrainScene.jsx` | `IDLE_ROTATE_AFTER` (2.4 s), `AMBIENT_EVERY` (3.4 s; ambient flickers are not counted) |
| Framing | `PokeBrainScene.jsx` camera fit | `halfWidth 5.9`, `halfHeight 4.2` |
| Reduced motion | `motionConfig()` | Critically damped, no overshoot, no squash |

The unit tests pin the behaviour, not the exact numbers: overshoot exists, the wobble is mostly gone in 1 s and fully gone by 3 s, and the caps hold. Retune freely and run `npm test`.

### Swapping or reshaping the brain mesh

- **Reshape the procedural one.**
  - `SHELL.radii` and `SHELL.center` set the overall size.
  - `silhouette()` controls the fissures, temporal lobes, cerebellum and flat base.
  - `grooveAt()` controls the sulci pattern.
  - `SHELL_DETAIL` sets the tessellation per tier.
  - The test `every region node sits inside the shell` stops a change from leaving a node poking through the surface.
- **Swap in a GLB.**
  1. Load it in `PokeBrainScene.jsx` where `buildBrainShell(detail)` is called (drei `useGLTF`, lazy, same chunk).
  2. Give the geometry a per-vertex float attribute `aFold`: 1 on a gyrus, 0 in a sulcus, or all 1s if you have no fold data. The shader uses it for groove shading and glow.
  3. Scale and centre it so `BRAIN_REGIONS` positions (from `brain3d/brainRegions.js`) sit inside it, and keep `SHELL.center` as its centre so squash acts about the middle.
  4. Build the proxy from the same GLB at low detail (or a decimated copy) for raycasting.
  5. Keep it under about 40k triangles for the `low` tier.
  - The shaders, physics and HUD need no changes.

### Tiers and the 3-second rule

- **`pokeTier.js`:**
  - No WebGL, less than 2 GB of memory, or `localStorage['brainsnn:force-brain-2d']='1'` → `2d`.
  - Touch, narrow screens, or ≤4 GB / ≤4 cores → `low` (a coarser mesh with wider grooves and a lower DPR).
  - Everything else → `high`.
- **First paint is an SVG brain that is already pokeable.** It ripples and counts. The 3D scene loads lazily in its own chunk (`PokeBrainScene-*.js`, 8.6 KB gzip plus the shared `vendor-three`) and crossfades in when it is ready. Measured locally, the first poke is possible about 0.5 s after load.
- **A WebGL crash falls back to 2D.** `Brain3DErrorBoundary` calls `onError`, which drops the hero to 2D rather than leaving a blank box.
- The frame loop runs only while the hero is on screen (`frameloop` driven by an IntersectionObserver).

## 2. Sharing

`src/features/toys/shareMedia.js` is lazy-loaded on the first share tap, so it costs nothing on first paint.

- **Clip.**
  - The 3D canvas (`preserveDrawingBuffer`) is composited every frame into a 720×1280 canvas, with the hook on top, the counter, and the `brainsnn.com` watermark.
  - It is recorded with `MediaRecorder` for 6 s, then a 1.1 s outro card ("Poke it yourself · brainsnn.com", plus the sponsor line when one is set).
  - MP4/H.264 is preferred and WebM is the fallback.
  - Browsers only allow `navigator.share(files)` within a fresh tap, so it takes two taps: **Record** then **Share or save the clip**.
- **Poster.** A 1080×1350 PNG with the same layout.
- **Caption.** It is copied synchronously on the tap, so the clipboard allows it: hook, then result, then link with `?src=`. Example: `Poke the brain and watch the signal travel\n51 signals fired.\nhttps://www.brainsnn.com/?src=toy1-share`.
- **Score cards** (Fool, Duel, Defend). `renderScoreCard()` produces a 1080×1350 PNG with the score, rank, hook, URL, the honesty boundary line and the sponsor line.
  - The Defend card's link reuses the arcade's own challenge encoding (`brainGameShare.js` → `?lab=braingame&state=mode~level`), so "beat my score" opens the same level and mode.
  - A pasted custom level is never put in the link.
- **Delivery.** On phones the native share sheet opens with the file attached. Elsewhere the file downloads and the caption is copied.

Headless Chromium has no H.264 encoder, so automated runs produce VP9 in MP4 or WebM. Real Chrome and Safari produce H.264 MP4.

## 3. Sponsor slots (wired, empty)

`SPONSORS` in `toyConfig.js` is `{}`. To sell a slot:

```js
export const SPONSORS = Object.freeze({
  all:  { name: 'Acme Robotics', url: 'https://acme.example' },   // every toy
  poke: { name: 'Other Co.',     url: 'https://other.example' },  // overrides `all` for one toy
});
```

That one edit fills three places:

- the "Brought to you by" chip on each toy (`SponsorSlot`);
- the outro frame of every recorded clip;
- the footer line on every score card and poster.

Only `https:` URLs are accepted. While the slot is empty, the page renders a hidden `<span data-sponsor-slot>`, so there is no layout gap and nothing is visible.

## 4. Attribution and analytics

- **Attribution.**
  - Every shared link carries `?src=toyN-share`.
  - `src/lib/attribution.js` reads `src` as an alias of its existing short `s` param. It is first-touch, so the source survives later navigation.
  - It is reported in the existing `from.share` field.
- **New events.** These are in both allowlists (`src/lib/analytics.js` and `src/lib/eventSink.js`):
  - `toy_opened`, `toy_first_poke`, `toy_shake`, `toy_share_opened`
  - `toy_clip_saved`, `toy_card_saved`, `toy_link_copied`
  - `toy_more_clicked`, `toy_cta_clicked`
  - `toy_fool_finished`, `toy_duel_finished`, `toy_defend_finished`
- **The funnel to watch:** `toy_first_poke` → `toy_share_opened` → `toy_clip_saved` / `toy_card_saved` → visits with `from.share = toyN-share` → `toy_cta_clicked`.

## 5. OG images (link unfurls)

Each toy route has its own card in `src/lib/routeMeta.js`: title, description, crawler-readable heading and body, and `image: /og/toy-*.png`. The server writes these into the HTML, so scrapers see them without running JavaScript.

The images are real screenshots of the running toys. To regenerate them after a visual change:

```bash
cd brainsnn-r3f-app
npm run build && PORT=4180 npm start          # in one terminal
npm run og:toys                               # writes public/og/toy-{poke,fool,duel,defend}.png (1200×630)
# optional: TOY_OG_BASE=http://127.0.0.1:4190  PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome
npm run build                                 # so dist/ carries the new PNGs
```

`src/lib/routeMeta.test.js` fails if any of the four PNGs is missing.

## 6. What changed outside `src/features/toys/`

| File | Change |
|---|---|
| `src/app/BehaviourHome.jsx` | The homepage is now: Poke hero → More toys → the existing tools section (`#tools`, "Build a mind. Give it a world. Give it a mission.", now an h2) → the evidence note (unchanged) → the BrainSNN strip with the Sponsor (`/sponsor/gt3/`) and Enterprise (`/arcade#brief`) CTAs. |
| `src/app/AppShell.jsx` | Three lazy toy routes. `resolveRoute` is exported. |
| `src/app/GaugeGapLanding.jsx` | `/arcade#brief` scrolls to the brief form. |
| `src/features/gaugegap/BrainGameLab.jsx` | Optional `onRunComplete` prop, which reports each finished mission or challenge once. The arcade doesn't pass it, so its behaviour is unchanged. |
| `src/features/brain3d/Brain3DErrorBoundary.jsx` | Optional `onError`. |
| `src/lib/attribution.js` | `src` alias. |
| `src/lib/analytics.js`, `src/lib/eventSink.js` | Toy events. |
| `src/lib/routeMeta.js` | Toy cards, new homepage card, crawl links. |
| `scripts/check-three-imports.mjs` | `PokeBrainScene.jsx` added to the allowlist; it is loaded via `React.lazy` only. |
| `scripts/render-toy-og.mjs`, `package.json` | `og:toys` script. |
| `tests/e2e/agent-lab.spec.ts` | Homepage expectations updated for the new hero. |
| `tests/e2e/toys.spec.ts` | New. |

Every existing route, lab and the arcade copy of Defend the Brain are unchanged. The calibration and holdout regression guards are untouched and green.

## 7. Verification

Run from `brainsnn-r3f-app/` (Node 22.6+):

```bash
npm test          # includes check-three-imports and the calibration/holdout guards
npm run lint      # tsc --noEmit
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4180 npx playwright test tests/e2e/toys.spec.ts tests/e2e/agent-lab.spec.ts
```

## 8. Honesty rules the copy follows

- The brain is a **simulation**: a seven-region spiking model inside a procedural shell. It is not a recording of anyone's brain and not neural data. The hero says so.
- Fool the Detector links the published evaluation, and it states that the detector missed every paraphrased technique on held-out text. It keeps "Model scores describe their tested conditions; they do not establish universal capability."
- Defend the Brain keeps verbatim: "Scores are 0–100 indices, not probabilities." and "Results describe tested conditions, not universal capability."
- The playbook's positioning ("neural-data software layer, EEG dashboards, open neural-data benchmark, vendor partnerships") is **not** used on the site, because none of those exist yet. The strip says "A software layer for neural-style models." Phase 4 (the benchmark leaderboard) needs real consent flows, storage and a published schema before any of that copy can ship.
