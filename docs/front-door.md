# Front door (Nov 23, 2026)

brainsnn.com leads with three products. Nothing was removed; everything else is one click away.

## Routes

| Address | Serves |
| --- | --- |
| `/` | The three-door homepage (`src/app/FrontDoor.jsx`): Walk, World Builder, API. |
| `/world/` (and `/world`, which redirects) | World Builder, framed (`src/world/WorldHome.jsx`). |
| `/?sandbox=…`, `/?scene=…`, `/?tool=…`, `/?install=1`, `/#showcase` and other public World fragments | World Builder, so links shared while it was the homepage keep working. |
| `/?classic=1` | The classic robot-testing lobby. |
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
