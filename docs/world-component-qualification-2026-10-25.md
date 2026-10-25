# Component and robot-map software qualification, 25 October 2026

This is an authored synthetic room test. It is not phone-video reconstruction,
independent metric accuracy, survey validation, a native Rhino/Bonsai editing
workflow, Nav2 runtime qualification or a physical robot result.

## Executed

Official Blender 4.2.23 LTS, build `d0cbe84903e8`, Linux x64, exited normally with
code 0 for compilation, controlled re-export and separate native `.blend`
save/reopen processes. The downloaded official archive matched SHA-256
`bea0eb3146be13eae6225409a117b215184f41b7f79e799f97cb3abb8f6dc404`.
Source: [Blender 4.2 release directory](https://download.blender.org/release/Blender4.2/).
Python native file checks used IfcOpenShell 0.9.0 and rhino3dm 8.17.0.

The deterministic fixture contains 8,009 authored points: a floor lattice and four
wall lattices. Its 4 m scale is illustrative, entered and unverified. It carries
neither `sourceFrame: colmap` nor `multiView: true`. The compiler and rebuild tool
correctly refuse it by default. Successful software experiments explicitly used
`--allow-unverified`; the rebuilt receipt records that choice.

| Check | Observed software result |
| --- | --- |
| Metric compilation | Genuine Blender GLB, USD, IFC, JSON and `.blend` files written; exit 0 |
| Arbitrary-unit regression | Genuine Blender GLB and JSON written; USD/IFC omitted; exit 0 |
| Reviewed opening | Authored 1.000 m by 2.100 m void in a reconstructed fixture wall |
| Controlled edit | Wall translated +0.100 m in world X; opening width changed to 1.100 m |
| Shared identity | Component IDs and IFC GlobalIds retained; actual Rhino objects preserve matching component/IFC metadata |
| Geometry | Actual IFC opening profile changed to 1.100 m; GLB cut-wall pieces moved from X=2.000 m to X=2.100 m; native IFC/Rhino solid-volume comparisons pass |
| Provenance | Edited geometry and dependent hosted placement labelled operator-authored; original observed/operator-reviewed origins retained separately |
| Bundle integrity | Original scene/cloud unchanged; receipt artifact hashes and final scene/cloud bindings checked; internal fit and point reports recomputed |
| Native Blender persistence | `.blend` opened, saved and reopened in a separate native process; identity, transform, dimensions and metadata retained |
| Nav2 raster | 82 by 122 cells at 0.05 m resolution: 548 occupied, 0 candidate free, 9,456 unknown |

Zero candidate free cells is a useful negative result. The sparse 0.1 m lattice
does not provide quadrant-complete source support for 0.05 m cells. The exporter
did not invent navigable floor between samples. This output is not a usable
autonomous-navigation map for this capture density and resolution.

The final release-check bundle's serialized scene SHA-256 was
`6f80799950ac996bb1530fdbd7f10f9410acc2d857b658708d1d0e069d2bdcbf`.
Its source cloud SHA-256 was
`f2b68ba410c170af383e8900ab0f4a09868d0aa397374128e9dd39640163c5ae`.
File hashes identify these particular artifacts. Blender timestamps and export
versions can change serialized hashes on another execution; semantic component
identity and checked geometry are the repeatability targets.

## Failures retained

- The Python `bpy==4.2.23` wheel wrote files but exited 139 during teardown. That
  execution failed. No exit-code override or teardown bypass was used. The
  successful qualification uses the actual official Blender executable instead.
- Default authored-fixture admission failed as intended. The unverified experiment
  flag did not become a production default or a multiview claim.
- Static map export did not establish free coverage or a planned route. Nav2
  runtime, localization, robot footprint clearance and physical execution remain
  untested. USD still contains visual geometry without authored physics collisions.
- No new model checkpoint was executed. Camera matrix validation and software
  export agreement do not establish improved reconstruction accuracy.

## Reproduce

Use the authored fixture generator and the commands in
[the component integration guide](world-component-robotics.md). Native runs require
an actual Blender executable and the existing worker/CAD Python dependencies.
From the repository root, choosing a fresh directory and an installed Blender:

```bash
export WORLD_COMPONENT_BLENDER=/usr/bin/blender
python scripts/world-demo/component_fixture.py cloud output/component-qualification
"$WORLD_COMPONENT_BLENDER" -b --python-exit-code 1 \
  --python robotics/scene_compiler/scene_compiler.py -- \
  --cloud output/component-qualification/cloud.json \
  --out output/component-qualification/initial --allow-unverified
python scripts/world-demo/component_fixture.py review \
  output/component-qualification/initial/scene.json \
  output/component-qualification/cloud.json \
  output/component-qualification/reviewed-cloud.json
"$WORLD_COMPONENT_BLENDER" -b --python-exit-code 1 \
  --python robotics/scene_compiler/scene_compiler.py -- \
  --cloud output/component-qualification/reviewed-cloud.json \
  --out output/component-qualification/reviewed --allow-unverified
python scripts/world-demo/component_fixture.py edits \
  output/component-qualification/reviewed/scene.json \
  output/component-qualification/edits.json
python -m robotics.scene_compiler.rebuild_components \
  --scene output/component-qualification/reviewed/scene.json \
  --cloud output/component-qualification/reviewed-cloud.json \
  --edits output/component-qualification/edits.json \
  --out output/component-qualification/edited \
  --blender "$WORLD_COMPONENT_BLENDER" --allow-unverified
python scripts/world-demo/verify_component_bundle.py \
  --bundle output/component-qualification/edited \
  --original output/component-qualification/reviewed \
  --cloud output/component-qualification/reviewed-cloud.json
```

The ordinary Python tests cover graph edits, raw artifact transport, cross-format
IDs, actual native IFC/Rhino files, map orientation, unknown-space policies,
invalid inputs, stale evidence and failed-process publication. Blender is a
separate opt-in execution check.

Local combined validation after integrating main's PR #233 and installing the
configured CPU prerequisites: 428 tests passed, 95 subtests passed, 2 real-capture
opt-ins skipped. The 131 browser/Node contracts also passed. Earlier missing
PyCOLMAP, PyAV and ONNX Runtime prerequisites were installed and their tests then
passed. CI results must be read at the exact proposed commit.
