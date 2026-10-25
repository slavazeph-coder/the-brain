# World Builder: editable components and robot-map interchange

Implementation and primary-source review: 25 October 2026.

The next useful product layer is a saved architectural scene that teams can edit,
re-export and inspect consistently. A photorealistic reconstruction alone does
not supply building-component identity, wall construction thickness, robot
clearance, friction or localization. This change addresses identity, controlled
geometry authoring and static map interchange. It does not establish market
superiority, survey accuracy or physical robot readiness.

## Public interfaces used

| Foundation | What the implementation takes from it | Boundary |
| --- | --- | --- |
| [CRAB paper](https://arxiv.org/abs/2610.29257) | Component-level wall solids, dimensions and hosted openings are the useful representation | Design reference only. No CRAB model, weights or benchmark was reproduced. Its reported thickness result is not BrainSNN phone accuracy. |
| [IfcOpenShell placement API](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/geometry/edit_object_placement/index.html) and [feature API](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/feature/add_feature/index.html) | Preserve host-relative opening placement and IFC void/fill relationships | Native library parse, geometry and file round trips are separate from native Bonsai/Revit user workflows. |
| [rhino3dm ObjectAttributes](https://mcneel.github.io/rhino3dm/python/api/ObjectAttributes.html) | Actual object UUIDs plus component/host/IFC IDs in user strings | Named BREP solids and void metadata, not a Rhino parametric history or automatic bidirectional editing. |
| [Nav2 Jazzy map I/O source](https://github.com/ros-navigation/navigation2/blob/jazzy/nav2_map_server/src/map_io.cpp) and [REP 103](https://github.com/ros-infrastructure/rep/blob/master/rep-0103.rst) | PGM/YAML trinary format, image row inversion, explicit right-handed frame transform | Format and software contracts have been tested. Nav2 runtime, localization and physical robot runs have not. |
| [MapAnything official repository](https://github.com/facebookresearch/map-anything) | Rigid camera-to-world and OpenCV intrinsic matrix contract | Adapter validation rejects malformed matrices. Existing code/checkpoint pins remain; no new learned inference or accuracy result. |
| [Isaac Sim physics fundamentals](https://docs.isaacsim.omniverse.nvidia.com/latest/physics/simulation_fundamentals.html) | Visual USD and physics collision definitions are distinct | Current scene.usda remains visual. It is not advertised as a validated physics scene. |

The code uses public formats, documented APIs and original implementation. No
proprietary Matterport or Polycam internals were extracted.

## Implemented contract

`robotics/scene_compiler/component_graph.py` attaches deterministic UUID5 component
IDs to metric scenes. The source namespace is the existing ordered XYZ/RGB
fingerprint. IDs survive the supported edits and display-label changes within
that saved scene. They are not cross-capture object recognition. Legacy standalone
exporters derive a clearly labelled geometry-scoped namespace when no source
fingerprint is available; callers must retain the identified scene for later edits.
Fresh segmentation or compiler-version changes can alter component ordering even
for the same points. Do not use index-derived IDs as proof of semantic matching
between those fresh runs; continuity requires the retained scene graph and its
exact edit lineage.

Walls, source objects, openings and door fills have distinct identities. IFC
GlobalIds and Rhino metadata use those component IDs; unrelated source namespaces
do not reuse a generic `wall_1` identity. Split Rhino wall solids share their
semantic component ID and have separate deterministic representation-part UUIDs.
Representation-part numbering is not a persistent topological matching promise
when an opening changes the decomposition.

`apply_edits(scene, contract)` accepts at most 32 operations and 64 KiB, with a
64-revision history limit. It requires the exact source hash, complete canonical
scene hash and revision. Supported operations:

- `wall`: world XYZ translation in metres, replacement `[length,height,thickness]`
  centred on the wall, and absolute Y-up yaw in degrees.
- `opening`: host-relative offset, width, height and sill in metres.
- `label`: display label only. Internal names, host keys and component IDs stay fixed.

Edits are atomic copies. Hosts, opening fit and non-overlap are validated against
the final state. Hosted openings remain relative to the wall start and base.
Changed geometry is `operator-authored-edit`; `sourceProvenance` and original
support counts remain available, explicitly scoped to the original geometry.
Previous fit, dimensional report, route, navigation and export receipts are
invalidated. A reviewed opening continues to mean authored geometric intent;
physical review and metric verification remain false.

The worker now offers `component-graph.json` and, for admissible metric geometry,
`nav2-map.pgm`, `nav2-map.yaml`, `nav2-map.json` as signed, byte-hashed downloads.
All are bound to the final scene and cloud. A failed navigation export is recorded
as failed, without falsely failing an otherwise usable visual/BIM export.

## Run a controlled edit and rebuild

First use the updated worker/compiler to save a metric scene and its exact
`arena-cloud.json`. Keep the original output directory. Author a contract from the
saved scene, for example:

```python
import json
from pathlib import Path
from robotics.scene_compiler.component_graph import scene_sha256

scene = json.loads(Path('original/scene.json').read_text())
wall = scene['walls'][0]
contract = {
    'schema': 'brainsnn.component-edits.v1',
    'sourceSha256': scene['componentGraph']['sourceSha256'],
    'sceneSha256': scene_sha256(scene),
    'revision': scene['componentGraph']['revision'],
    'edits': [
        {'op': 'wall', 'componentId': wall['componentId'],
         'translationMeters': [0.1, 0, 0]},
        {'op': 'label', 'componentId': wall['componentId'],
         'label': 'Reviewed north wall'},
    ],
}
Path('component-edits.json').write_text(json.dumps(contract, indent=2))
```

```bash
python -m robotics.scene_compiler.rebuild_components \
  --scene original/scene.json \
  --cloud original/arena-cloud.json \
  --edits component-edits.json \
  --out edited-revision-1 \
  --blender /usr/bin/blender
```

Run from the repository root with the worker and CAD dependencies installed. Use
an actual Blender executable. The output directory must be absent. Source files
are retained, GLB/USD/IFC/Blender geometry is rebuilt, CAD/quantities/internal fit
and point-pair reports are regenerated, and a hashed rebuild receipt accompanies
the bundle. Publication is atomic on the Linux worker platform. A failed Blender
process never publishes a successful bundle, even if it wrote some files.

The existing non-multiview refusal remains. `--allow-unverified` is an explicit
experiment-only option recorded in the rebuild receipt. It is needed for authored
software fixtures and must not be used to label them as phone reconstructions.

Point-pair checks after an edit still compare the unchanged source points with
operator-supplied readings. They do not validate the edited wall dimensions.
The regenerated inventory labels operator-authored parameter changes explicitly.

## Inspect or load the map

Standalone export, requiring a fresh output directory:

```bash
python -m robotics.scene_compiler.nav2_export \
  --scene original/scene.json \
  --cloud original/arena-cloud.json \
  --resolution 0.05 --out nav2-review

ros2 run nav2_map_server map_server --ros-args \
  -p yaml_filename:="$(pwd)/nav2-review/nav2-map.yaml"
```

The second command is an integration example, not a reproduced Nav2 execution.
Use the ROS distribution's lifecycle manager to configure/activate the server.
Configure the actual robot footprint, safety margin and inflation; they are not
baked into the raster. For conservative experiments, disallow planning through
unknown space and preserve unknown tracking in the costmap. Supply and verify
`map -> odom -> base_link` through the robot's localization system. A file export
does not establish those transforms.

The frame mapping is `[x,-z,y]`, with metres and no geographic heading. PGM starts
at the highest ROS Y row. Occupied/free/unknown pixels are 0/254/205. One extra
unknown cell surrounds the floor extent. A candidate free cell needs actual
near-floor source samples in all four cell quadrants, with no interpolation or
ray clearing. Explicit unknown regions override candidate free status. Walls and
closed reference doors block space; raised or short openings stay blocked under
the declared 2 m projection convention. These are conservative geometric policies,
not robot clearance or traversability measurements. Sparse captures may yield
zero usable free cells. Report that result and improve capture support rather
than dilating floor observations into invented free space.

## Most useful remaining deep work

1. Build a shared camera/frame sidecar across COLMAP and MapAnything: prepared
   image hash, dimensions and pixel transform, time base, camera convention,
   intrinsics/distortion and source linkage. MapAnything currently lacks the
   COLMAP-specific naming/projection path. Then attach tracked SAM masks and
   source frame evidence to components, keeping geometry fixed for the ablation.
2. Retain per-point/view support and depth confidence beyond the display preview.
   An observed face does not measure the hidden opposite face or construction
   thickness. Surface support, inferred bases and authored parameters need
   separate uncertainty records.
3. Test a rights-cleared real phone room: one calibration span plus seven withheld
   tape/laser spans, then a native Bonsai/Rhino edit/reopen. Proposed targets,
   not achieved results: median withheld error at most 2 cm and maximum at most
   5 cm; cross-format serialized dimensions within 1 mm after a controlled edit.
4. Run 20 fixed closed-loop robot tasks against an independently measured
   reference world, recording collision contacts, minimum clearance, false-free
   area and completion. Proposed gate: at least 19/20 reachable tasks, no
   collisions. Testing a map against only its own derived scene can hide missing
   obstacles in both. Simulation success remains separate from physical execution.

Estimated next camera-sidecar slice: 2 to 4 engineering days; robot evaluation
slice: 3 to 5 days once a reference space and robot simulator are available.
These are estimates. No additional paid API or model inference was used for this
implementation. CUDA model throughput/VRAM on GB10 or RTX 4090 remains unqualified.
