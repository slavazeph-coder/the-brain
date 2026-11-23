# Front door (Nov 23, 2026)

brainsnn.com leads with three products. Nothing was removed; everything else is one click away.

## Routes

| Address | Serves |
| --- | --- |
| `/` | The three-door homepage (`src/app/FrontDoor.jsx`): Walk, World Builder, API. |
| `/world/` (and `/world`, which redirects) | World Builder, framed (`src/world/WorldHome.jsx`). |
| `/?sandbox=…`, `/?scene=…`, `/?tool=…`, `/?install=1`, `/#showcase` and other public World fragments | World Builder, so links shared while it was the homepage keep working. |
| `/?classic=1` | The classic robot-testing lobby. |
| `/app`, `/app/improve`, `/app/compare`, `/app/approvals`, `/app/history`, `/app/research`, `/app/pricing` | The Creative Engine (`src/app/AnalyzerApp.jsx`), restored Nov 23. |
| `/agent-lab` | Agent Lab (`src/features/agent-lab/AgentLabHome.jsx`), restored Nov 23. |
| Everything else | The React site shell, loaded on demand. |

`appRoute()` in `src/world/worldRoute.js` makes this choice and is covered by `tests/world/sandbox-route.test.mjs`.
Crawler copy for `/` is `HOME` in `src/lib/routeMeta.js` (positioning `walk-world-api-v1`); `/world` keeps `world-builder-v1`.
The deploy boot check and the live verify workflow look for those markers.

## Navigation

- Primary: World Builder, API and Lab, with **Walk a space** as the button (`src/app/navigation.js`).
- More: Robot Arena, Capture studio, Robot test pricing, Review and Evidence.
- Each door states its limitation in the same terms as its destination. Keep `DOORS` in `FrontDoor.jsx` in step with
  `/walk/`, `/world/` and `/world/api.html`.

## World Builder chapters

Each studio chapter opens on two core tools (a dozen in all), with **More tools** listing the rest in place.
**Find a tool** always searches all 50. The picks are `coreTools` in `public/world/showcase-features.mjs`. They are
a judgement, not measured usage.

## Measuring it

The homepage fires `front_door_viewed`, and `front_door_opened` with `door` = `walk`, `world` or `api`.
Those two events show which door people choose. Use them, and the per-route traffic, to decide what to remove next.

## Restored layers (Nov 23)

The October consolidation ("Consolidate BrainSNN around Arena and Review") removed the route to the original
analyzer: `/app` redirected to Review. Its scan, results panels, Improve, Compare, Approvals, History, Research
and Pricing still existed, as did their APIs, but nothing could reach them, which is why those APIs showed zero traffic.

- **Creative Engine at `/app`.** It uses the old shell's wiring, with one URL per section and Back between sections.
  It also handles Stripe's `?checkout=success|cancelled` return (the server already sent people there).
  Its sidebar, header and mobile tabs (`DesktopSidebar`, `AppHeader`, `MobileNavigation`) take their items from
  `src/features/analyzer/analyzerNavigation.js`.
- **Agent Lab at `/agent-lab`.** Its "Open BrainSNN" links to `/app` work again.
- **Analysis fixes:**
  - Improve now removes vague scarcity ("limited spots left"), guaranteed results ("guarantees 10x growth") and
    delay-as-loss ("every day you wait"). Honest terms ("30-day money-back guarantee", "3 seats left for the March 4
    cohort") are left alone.
  - "What works" no longer praises a line the same scan flags as pressure.
  - The proof-placement advice is skipped when the proof already sits right before the ask.
- **Server:** an unknown `/api/...` path answers a JSON 404 instead of the website's HTML with a 200.
- **Accessibility:** the Research layer explorer's filter is labelled and its list is keyboard-reachable.
- **Guard:** `tests/world/layers_browser_smoke.py`, which runs in CI, checks every route, the scan-to-approval flow on
  desktop and phone, and the analyzer APIs.

Production has Gemini and the GPU worker configured. Stripe and Supabase are not configured, so checkout and
magic-link sign-in answer 501 until those accounts are connected.

Still unmounted, and replaced by something else:
- `ReconstructPage` was replaced by Review's Claim split tab.
- `ProofMissionsPage` was replaced by Arena tasks.
- `src/app/WorldHome.jsx` and `WorldScene.jsx` were replaced by the framed World Builder.
- `LegacyResearchApp` was replaced by `ResearchDrawer`.

Still unmounted, and not wired anywhere:
- `SocialEmbedCard`, which has no entries yet.
- `AudiencePathways`.
- `BenchmarksTable.tsx`.
- `coherenceRequest.js`, the pilot mailto.
- `evalMetrics.js` and `agreement.js`, which only tests use.
