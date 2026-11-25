---
type: project
description: brainsnn.com front door — `/` became three doors (Walk, World Builder, API); traffic audit and the pending "what dies" decision
---

# Front door and cleanup — 2026-11-23

The owner asked what comes next for the cleanup, then said "Yes all": pull the traffic numbers and build the front-door PR.
**Deleting anything waits for the owner's own list.**

## Shipped on branch claude/happy-lamport-dsfa48

- `/` is `src/app/FrontDoor.jsx`: three doors (Walk `/walk/`, World Builder `/world/`, API `/world/api.html`), each with its limitation.
  - This reverses #337's "brainsnn.com opens the real world".
- World Builder routes:
  - `/world/` is World Builder.
  - `/world` 301-redirects to it (Express static directory redirect), so links use `/world/`.
  - Old root links (`?sandbox|scene|tool|install`, public World fragments such as `#showcase`) still open World Builder.
  - The routing choice is `appRoute()` in `src/world/worldRoute.js`.
- `AppShell` is lazy now: the homepage entry chunk went from 182 KB to 22 KB.
- Nav: World Builder, API and Lab, with the **Walk a space** button. Robot Arena, Capture studio, test pricing, Review and Evidence are under More.
  - Removed a phone CSS rule that hid the 2nd and 4th nav links *by position*. It also hid items inside the More menu.
- Route meta: `HOME` uses positioning `walk-world-api-v1`. `index.html` bakes HOME tags.
  - The deploy boot check and live verify now grep the HOME marker on `/` and `world-builder-v1` on `/world/`.
- Studio chapters open on 2 core tools each (`coreTools` in `showcase-features.mjs`, 12 in all), with **More tools** for the rest. Search still covers all 50.
  - The core picks are a guess, not usage data.
- Events: `front_door_viewed`, and `front_door_opened` with `door`.
- Caches: World SW `world-shell-front-door-workbenches-v57` (after merging #339), Walk SW `brainsnn-walk-v4`.
- Docs: `docs/front-door.md`.

## Never-mounted code found (candidates for removal)

`src/app/MobileNavigation.jsx`, `DesktopSidebar.jsx`, `AppHeader.jsx`, and `src/app/WorldHome.jsx` (App imports `src/world/WorldHome.jsx`).
The e2e Playwright specs in `tests/e2e` are stale (they expect the old lobby nav) and are not run in CI.

## Traffic, 7 days to Nov 23 (Railway http-requests, the-brain service)

Request counts, not visitors. They include bots, CI live-verify curls and my own checks.

| Path | Requests | Path | Requests |
| --- | ---: | --- | ---: |
| all (site total) | 38,463 | `/office` | 61 |
| `/` | 515 | `/api/events` | 33 |
| `/world/index.html` | 394 | `/scan` | 27 |
| `/arena/` | 71 | `/evidence` | 20 |
| `/world/api.html` | 69 | `/lab` | 19 |
| `/api/world/v1/status` | 14 (mine) | `/api/affect` | 1 |

Zero requests: `/api/neural/analyze`, `/api/soliton/explore`, `/api/leads`, `/api/billing/checkout`, `/api/agent-lab/summary` and `/api/engines/status`.

## Owner correction, Nov 23: "not old product if it's a functional layer, fix the layers"

Do not propose deleting BrainSNN layers. The zero-traffic APIs were **disconnected**, not unused. Commit 06262617
(Oct 16) dropped `/app` and the analyzer shell from the router.

What was restored:
- `/app` is the Creative Engine (`AnalyzerApp.jsx`) and `/agent-lab` is Agent Lab.
- The pressure fixes in `draftPatch.js` and `analysisEngine.js`, with tests in `src/lib/pressureFixes.test.js`.
- `/api/*` now returns a JSON 404.
- The CI guard `tests/world/layers_browser_smoke.py`.

Production config, from `/api/engines/status`: Gemini and the GPU worker are configured; Stripe and Supabase are not.
Production runs the app `railway.toml` with the preloads (brand-brain, missions and sponsorship are live). The repo-root
`railway.toml` lacks those preloads; it is misleading but unused.

## UI test and improve, Nov 24 (owner: "Test then improve")

- **Audit and results:** `docs/front-door.md` has the before/after table.
  - The scratch audit scripts were not committed. The permanent guards live in `layers_browser_smoke.py`.
- **Creative Engine:** it is in the primary nav now (World Builder, Creative Engine, API, Lab, plus the Walk button).
  - The 3-vs-4 homepage doors question is still open for the owner.
- **Engine change:** in `analysisEngine.js`, the gaugeGap score is floored at 80 x the share of lines this scan flags as
  pressure. Without it, a pressure-heavy ad read as "Low trust risk". The calibration guard still passes (0.883).
- **Next:**
  - Robot Arena legibility and speed.
  - One shared header and set of design tokens across the apps.

## Nov 24-25: research verdict, #338 merged and live, pilot kit

- **Research:** `docs/research/brainsnn-best-next-move-2026-11-24.md`. The verdict is to sell one paid, fixed-fee
  "site-to-sim" pilot of the World Builder API to mobile-robot deployers in 30 days. "Merge all into one" lost as the main
  move: only its cheap part, merging #338, was done.
- **#338:** merged as `bd669f45` on the owner's "Next all" and live on www.brainsnn.com (`/`, `/app`, `/agent-lab`,
  JSON 404 for unknown APIs).
- **Pilot kit (`docs/sales/`):** offer + SOW + acceptance + restore drill (`site-to-sim-pilot.md`), owner-only steps
  (`owner-week1.md`), templates (`outreach.md`), and a 40-row seed list to verify (`targets.csv`). The offer is on
  `/world/api.html`.
- **Bare domain:** `brainsnn.com/` 301s, but deep links 404 from the registrar forwarder (AWS). Railway has the domain
  verified and needs an apex CNAME/ALIAS to `tnoamdbj.up.railway.app`. Owner action.
- **Postgres backups:** no schedule is visible in the volume config, and no tool lists backups. Railway's Backups-tab
  restore overwrites production in place; use the separate-service drill instead.
- **Exposed key:** the "exposed key" is an Anthropic key pasted in chat, not in the repo; rotation is an owner action.
  `docs/DEMO_SCRIPT.md` has only a fake demo key.
