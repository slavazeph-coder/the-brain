# Revit and Xactimate building handoff

World Builder writes the building handoff after a metric scene has been compiled
and its fit summary serialized. The same export runs after a controlled component
edit, so the plan, schedule and evidence refer to the new component revision.

## Files and destination workflows

| File | Purpose |
| --- | --- |
| `scene.ifc` | Existing typed IFC4 walls, reviewed hosted openings and door leaves, with provenance. Open in Revit through File → Open → IFC, or link as a reference. |
| `xactimate-underlay.png` | Equal-scale plan image with a labelled calibration ruler. Import in Xactimate Sketch through Options → Import → Import Underlay Image, set scale from the ruler, then trace and review the rooms. |
| `building-schedule.csv` | Wall and opening dimensions in metres and feet, geometric areas in square metres and square feet, component IDs and revision references. |
| `building-handoff.json` | Exact final scene-byte hash, component identity/revision, image transform, calibration endpoints, companion hashes and readiness limits. |
| `BUILDING-IMPORT.txt` | Destination instructions and the limits of the generated files. |

The worker lists these as authenticated job artifacts. The browser shows their
actual manifest indices and destination instructions. Plain-text output support
does not add a new upload kind or relax the existing download authorization.

The PNG ruler preserves the scene's existing scale. It is not an independent
measurement. A metric handoff retains the worker's existing user-measured,
self-reported and unverified scale contract. Unscaled scenes receive a reason
instead of metre/foot building exports.

## What the plan and quantities mean

- Walls use the same oriented boxes and reviewed openings as IFC and Rhino.
- Unknown areas remain visibly hatched. Labels cannot erase walls, openings or
  coverage evidence; labels without a safe position are omitted from the plan
  and retained in the schedule.
- The dotted floor rectangle is a **floor bounding extent**. It is not a closed
  room polygon or a measured floor assembly. No room floor or ceiling area is
  calculated from it in the building schedule.
- The older CAD summary exposes `point_covered_footprint_area_m2`. Its legacy
  `observed_floor_area_m2` alias remains for compatibility, with an explicit
  scope: points above a grid cell do not establish that its floor was observed.
- Wall area is one face minus reviewed opening rectangles. It is not a repair
  scope or material quantity. Material, damage, activity, waste and prices are
  estimator decisions.
- Generic detections and unsupported requested IFC classes export consistently
  as `IfcBuildingElementProxy`. An explicit supported `IfcFurniture` class stays
  furniture. A display label does not create a typed duct, beam or fitting.

## Programmatic use

```python
from robotics.world_worker.building_handoff import write_building_handoff

result = write_building_handoff(scene, output_dir,
                               scene_path=output_dir / "scene.json")
```

Use final serialized scene bytes and a fresh job/revision directory. The worker
and component rebuild already do this. `written=False` means the handoff was not
produced; callers must not publish prior files as the current result. The four
companions are staged before publication. The manifest hashes permit consumers
to reject mismatched files.

The standalone CLI requires an empty output directory:

```sh
python -m robotics.world_worker.building_handoff \
  --scene /absolute/path/to/scene.json \
  --out /absolute/path/to/new-building-handoff
```

## Application boundaries

Revit Link IFC keeps the source model read-only. Open IFC creates a Revit model
using the import settings and template; inspect the resulting elements in the
actual Revit version before promising a particular editing operation. This
change does not generate a native `.rvt` file or validate a Revit API adapter.

The Xactimate PNG workflow requires tracing. There is no generated ESX/SKX
project. Verisk documents TPI ESX Return for third-party capture tools; a direct
integration needs the approved endpoint/schema, agreement and credentials, plus
an actual Xactimate import test. Do not rename JSON, DXF, IFC or USD to ESX.

Omniverse/SimReady assets retain their separate simulation provenance. They do
not establish dimensions of captured walls or become native building elements
through this handoff.

## Verification

The tests reopen generated PNG, IFC, DXF and Rhino artifacts, check scale and
coordinate orientation, verify IFC schema and hosted void geometry, exercise
component edits and exact final scene-byte bindings, and check private download
transport. The orchestration fixture explicitly stands in for Blender; it is
not a physical-room reconstruction qualification.

Use the user's real capture for reconstruction acceptance separately. Require
complete coverage of the needed rooms, defensible scale and held-out physical
dimensions before accepting quantities. Camera registration percentage and
pixel reprojection error alone do not establish room completeness or accuracy.

## Official application references

- [Autodesk: Open an IFC File](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-Model/files/GUID-21EFC097-96F3-428A-AFA4-BFEA4EDAB3D2.htm)
- [Autodesk: About Linking to IFC Files](https://help.autodesk.com/cloudhelp/2026/ENU/Revit-Model/files/GUID-BAA2ED9C-5107-4F21-ABE1-1ACF609AEEE3.htm)
- [Xactware: Importing and using underlays](https://xactware.helpdocs.io/l/enUS/article/pdlwk5k8zd-importing-using-underlays)
- [Verisk: Sketch Integration APIs](https://developerportal.verisk.com/solutions/estimation)
