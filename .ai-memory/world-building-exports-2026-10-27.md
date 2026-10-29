---
type: project
description: Revit IFC and calibrated Xactimate underlay integration, truthful floor scope and real capture qualification boundary
---

# Building exports — October 27, 2026

Owner clarified that the captured interior must be usable in Revit or Xactimate.
Follow-up branch `codex/revit-xactimate-handoff-20261027` starts from PR253 head
`10d9173840b8951aaf97cf9fa23c6a874a46087b`; it preserves the Omniverse/native-capture work.

The metric scene and controlled component rebuild paths now generate a calibrated
PNG underlay, metric/imperial geometric schedule, source/revision manifest and
import instructions. Browser exposes these alongside typed IFC. PNG import into
Xactimate requires scaling and tracing. Native RVT and ESX/SKX are not generated;
direct Xactimate capture integration should use approved Verisk TPI ESX Return.

IFC/CAD/UI now describe the floor as a bounding extent, not measured room area.
Point-covered footprint retains an explicitly marked legacy JSON alias.
Untyped/unsupported object classes consistently remain proxies; labels alone do
not turn detections into furniture or native MEP. Existing wall/opening/door
identities and metric coordinate transformations remain intact.

Actual 140-second, 910x512 phone footage was run privately through current sparse
reconstruction: baseline 52/140 registered frames; a controlled shared-intrinsics
experiment registered 56/140 on identical prepared frames. Both omitted the later
rooms and remained unscaled. Checked camera-turn consistency passed; this is not
complete geometry or physical accuracy. No video, frames or room model are in
the repository. Do not label exporter fixture outputs as the captured interior.

Guide: `docs/world-building-exports.md`. Worker and site deployments still require
their separate release branches; never merge the worker-specific root Railway
configuration into the website branch. AGENTS memory sync helper is absent in
this environment; commit this note with the implementation.

## Current-main integration review — October 28

Merged main `ed7b353` into PR255, preserving the native capture importer,
bounded measurement canvas, deferred input focus and current NVIDIA qualification.
The browser scene fixture now runs the real handoff writer. Chromium desktop,
Chromium phone and WebKit downloaded/reopened the PNG and CSV, verified exact
scene/IFC/companion hashes and exercised fresh exports after an opening edit.
The fixture remains authored geometry; no Blender or destination application ran.

All 140 world JavaScript tests and the production build passed. Focused Python
checks passed except the existing rebuild publication check on macOS, where
production correctly refuses without Linux `renameat2`. Its complete revision,
component identity and file-hash assertions passed with an explicitly temporary
local publication transport substitute; Linux CI must qualify the real publisher.
No production publication guarantee was relaxed. Actual PNG/IFC/DXF/Rhino
writers/readers were exercised, and the generated underlay was visually reviewed.

No native RVT/ESX output, Revit/Xactimate application import, physical phone
capture or physical dimensional accuracy is claimed by these checks.

## Sandbox release integration — October 29

Merged main `bdd375c` into the existing PR255 branch without replacing the new
sandbox, guided capture, terrain controls or deferred measurement focus. Kept
both Omniverse ZIP downloads and building TXT instructions in the worker output
allowlist. The service-worker cache includes all current sandbox modules.

The complete scene browser matrix passed Chromium desktop, Chromium phone and
WebKit, including actual private PNG/CSV/TXT/manifest/IFC downloads before and
after a reviewed opening edit. A startup-only test failure had a completely
uninitialized module UI; the test now waits for an app-rendered control before
setting a file input and reports failed module requests. No app behavior was
changed for that test. All 240 World JS tests and the production build passed;
152 focused Python tests plus 8 subtests passed (2 dependency skips, 1 Linux-only
publication test deselected). All 3 rebuild tests additionally passed with an
explicit local publication transport substitute; Linux CI retains the actual
`renameat2` test and production publisher is unchanged.

Hosted synthetic acceptance now requires all four building outputs, source scene,
IFC and cloud; verifies download bytes/hashes, cloud-point identity, scale,
canonical scene/revision, companion bindings, real PNG/ruler, schedule row counts
and source/revision, instruction content and unqualified destination flags. It
fails before the NVIDIA pack job if building outputs are missing or malformed.
These remain software/export checks, not physical measurement or native
Revit/Xactimate application qualification.
