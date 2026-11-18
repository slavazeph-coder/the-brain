---
type: project
description: Plain-language World Builder playground, preserved tools, reading controls and browser validation
---

Owner asked to make the website easier for ages 6–90 without losing features,
then clarified that the scope is the World Builder playground. Preserve its
near-black/cyan/violet identity and every existing feature. This is broad-audience
usability work, not a claim of a usability study with all age groups.

The playground now comes before the four own-capture goal cards. Simple hero
actions open the playground or the existing capture panel. All tools retains
every former destination. Tabs read Add files / Change things / Try a robot /
Check details / Save & share while their original IDs and actions stay intact.
Dynamic panel text explains settings and optional time/cost assumptions. The
mobile world view precedes settings except during capture.

Readable sizes and 44px controls replace many 10–12px labels. Optional larger
text persists only a reading preference. Native help dialog explains three
steps and a short glossary, with user-triggered read-aloud where supported.
Speech stops on close/pagehide; help shortcuts use existing tabs without
replacing scenes or granting review. Original consent, provenance, measurement,
unknown-space, download and simulation boundaries remain.

Added playground_help_browser_smoke.py and its CI invocation. It checks actual
keyboard focus, help actions preserving an edit and unreviewed state, persisted
18px editor values, full menu reachability and 390/320px standard/large layouts.
Speech is explicitly a browser wiring fixture, not audible quality evidence.
Offline cache v28 includes the helper. Existing broad browser flows cover
room editing, routes, replay, source handling, measurements, exports, root
iframe links and street editing/scene return in Chromium and WebKit.

Local checks: 445 World contracts, app tests, TypeScript, production build and
Chromium/WebKit room/street flows passed. An axe WCAG A/AA scan of the mobile
playground reported zero violations. This is software browser verification,
not physical-phone performance or real capture accuracy qualification.
