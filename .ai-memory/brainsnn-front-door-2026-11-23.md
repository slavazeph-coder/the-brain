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
- Caches: World SW `world-shell-front-door-v56`, Walk SW `brainsnn-walk-v4`.
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
