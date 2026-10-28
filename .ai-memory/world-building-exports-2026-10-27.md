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
