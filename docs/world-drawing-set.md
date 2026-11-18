# Drawing set from the compiled model (November 17, 2026)

Scan-to-BIM products show the same closing step: the model is finished, one action produces the documents. World Builder
wrote a plan image, a DXF, an IFC and two CSV schedules, but no set a person can print and read. `drawing_set.py` writes
that set: one A3 PDF, drawn from the compiled scene.

## What it writes

`drawing-set.pdf`, 12 sheets for a scene whose schedules fit one page each:

| Sheet | Content |
|---|---|
| G-001 | Cover, element counts, sheet index, what the set does and does not show |
| A-101 | Floor plan at a standard scale: walls, object boxes, reviewed openings, unknown space, overall dimensions, section lines, elevation key |
| A-201 to A-204 | Four interior elevations, looking outward from the centre of the plan |
| A-301, A-302 | Two sections, each on the one of nine evenly spaced planes that passes through the most elements |
| Q-401 | Wall schedule: length, height, thickness, net face area, openings, thickness basis, provenance |
| Q-402 | Opening schedule: host wall, width, height, sill, offset, area |
| Q-403 | Object register: name, IFC class, box size, plan area, scan-frame position, whether the name was reviewed |
| Q-404 | Quantities: the summary rows of `quantities.csv` |

A schedule with more than 34 rows continues on further sheets (`Q-401.1`, `Q-401.2`), with the total on the last.

Every sheet is drawn from `cad_export.elements(scene)`, the geometry behind `scene.ifc`, `scene-plan.dxf`, `scene.3dm`
and `quantities.csv`. Wall tag `W1` is the first wall in all of them. The quantities sheet prints the totals
`cad_export.quantities` computes, from the geometry in the scan frame before the plan is turned. A test turns the
walls 25 degrees and compares the sheet with that function.

## How it is drawn

- **To scale.** The plan and the six views use the first standard scale that fits (1:50, 1:75, 1:100 and so on), named
  in the title block, with a scale bar. The vector PDF preserves the model's scale when printed at 100% on A3;
  this does not establish the physical accuracy of the model.
- **Squared to the sheet.** A scan has no compass and its frame is arbitrary. The plan is turned by the length-weighted
  direction of the walls, modulo a right angle, so most walls run along the sheet. A turn keeps every length. The plan
  says how far it was turned, and the object register still gives positions in the scan frame, as the DXF has them.
- **Overall dimensions** run across the walls found, outside to outside. Where a scene has no wall they run across the
  objects. They are not room sizes: the compiler does not close rooms.
- **Elevations and sections** show each element as its box: face-on walls as rectangles, end-on walls as slivers,
  objects as boxes at their height. What a section plane passes through is hatched. Heights run up from the floor
  estimate, and a box an edit has sunk below it is drawn down to its base, with the depth marked.
- **Nearer hides farther.** Two boxes that overlap in a view are compared on a sight line through the middle of
  their overlap, not by their nearest corners, so a turned box does not hide a smaller one standing in front of its
  face. Boxes that pass through each other have no such order, and a view with more than 200,000 overlapping pairs is
  not compared: those sheets say the nearest point was used.
- **Tags** never cover a wall, a section line or another tag. A tag that sits away from its element has a leader. A tag
  with no free place is left off and counted on the sheet; the element is still in its schedule. In a view, an element
  wholly hidden behind nearer ones gets no tag, and the sheet counts those too.
- **Unknown space** is tinted and hatched on the plan, clipped to the drawing so a very large cell cannot cover the
  legend or the title block. A sheet draws at most 20,000 hatch lines; past that, areas keep the tint and the sheet
  says how many went unhatched.
- **The sheet index** takes two columns on the cover. A set too long for them continues on index sheets G-002 onward.
  No scene the compiler accepts is that long (1,024 components give about 45 sheets).
- **No library.** The file is written directly as PDF 1.4 with the standard Helvetica and Courier fonts, so it runs in
  the worker and in Blender's Python. The same scene gives the same bytes: there is no date and no document identifier.

## What it does not claim

Every sheet carries "FOR REVIEW - DIMENSIONS UNVERIFIED" and the basis of the scale in words ("Scale estimated by the
reconstruction model. Not verified."). Nothing in this module checks a dimension against a building.

- A wall the compiler did not find is not on the plan. Fragmentary walls stay fragmentary on the sheets.
  A registered laser scan (`survey_cloud.py`) can supply denser source coverage; these drawing tests do not qualify it.
- An object is the box around a separated cluster of points. It is not the object's outline.
- There is no north point, room boundary, material, level datum, roof, ceiling or floor slab.
- **Pipes, valves, fittings, steel members and equipment are not modelled.** There are no piping isometrics, spool
  drawings or steel schedules. Fitting those to a point cloud is a separate modelling step that does not exist here.
- Openings are the ones a reviewer entered in the building review step. The scan does not place them.

## Where it runs

- **Scene job.** `scene_usd.run` writes the set after the building hand-off, from the final scene (the one whose fit
  summary was attached), lists `drawing-set.pdf` in the manifest as kind `cad`, and records the evidence under
  `drawing_set` in `scene-usd.json`. A problem drawing the set never fails the scene: the evidence says why.
- **Component rebuild.** `rebuild_components.rebuild` redraws the set from the edited revision and records it under
  `drawingSet` in the receipt.
- **Site.** The inline scene workspace shows the plan first, with a sheet selector for elevations, sections and
  schedules, a fit/large page control and a PDF download. It uses the originating job and client, including when a
  different job finishes later. Missing drawing artifacts in older jobs stay unavailable; the site never substitutes
  a demonstration drawing.
- **By hand.**

```sh
PYTHONPATH=robotics/scene_compiler python robotics/world_worker/drawing_set.py \
  --scene /absolute/path/to/scene.json --out /absolute/path/to/output --name "Project name" --svg
```

`--svg` also writes one SVG per sheet, for previews.

## Native browser preview

`drawing-preview.json` contains the same numeric line, polygon and text operations that generated the PDF.
The worker binds it to SHA-256 of the final `scene.json` bytes, the ordered source cloud hash, the component revision
and the PDF's hash and size. Both scene compilation and component rebuilding supply the final scene file to
`write_drawing_set(..., scene_path=...)`. A mismatched file is refused and stale drawings are withdrawn.

The browser validates all bindings and every operation before rendering. It builds SVG nodes and text with DOM APIs;
it does not inject worker HTML/SVG or embed a PDF. Limits are 4 MiB, 30,000 drawing operations and 256 sheets. A set above
those limits retains its PDF but omits the optional inline preview. Source changes or pending local BIM edits withdraw
the current preview; recompiling produces a new drawing revision. Screen zoom is explicitly not a measurement.

Closing the model view disposes its renderers and pending preview requests. Reviewed opening drafts remain in memory
for up to 12 scenes, keyed to the originating client, job, exact scene bytes, source point hash and component revision.
Opening the same result restores its draft, including removals, and keeps drawings unavailable until recompilation.
Opening a different result or worker cannot borrow those edits. Clearing the session discards all drafts.

No additional runtime package is required. `pypdf` is a test-only independent reader.

## The artifact bound moved from 32 to 40

A scene job could already publish exactly 32 files when every optional export ran: six from the walkthrough
reconstruction, the scene files, CAD, stand-ins, the building hand-off, evidence, fit, checks, component reports, the
Nav2 map, the cloud and the object names. The PDF and native preview can add two files. The bound is now `MAX_ARTIFACTS = 40` in
`app.py`, `ARTIFACT_LIMIT` in `scene_usd.py` and `MAX_ARTIFACTS` in `worker-client.mjs`; a test holds the three equal.

**Deploy the site before the worker.** An older site refuses to download an artifact index above 31, so a new worker
behind an old site would list a 33rd file the site cannot fetch. The other order is safe. A tab that was already
open keeps the old script until it reloads, and until then it cannot fetch a file listed after the 32nd.

If a manifest would still exceed the bound, `scene_usd` first omits the preview, then the PDF if necessary, removes
the omitted files and records the reason, so an optional export cannot cost a job its scene.

`.pdf` joins the worker's artifact suffix list. A PDF can carry scripts, so it leaves the worker as every artifact does:
`application/octet-stream`, `Content-Disposition: attachment`, `Content-Security-Policy: sandbox`.

## Checks

```sh
python -m pytest tests/world/test_drawing_set.py tests/world/test_building_handoff_pipeline.py \
  tests/world/test_cad_export.py tests/world/test_worker.py tests/scene_compiler/test_rebuild_components.py -q
node --test tests/world/drawing-review-ui.test.mjs tests/world/bim-workflow-ui.test.mjs tests/world/worker-client.test.mjs
```

The tests read the PDF back without the module's writer: a walk of the cross-reference table, and pypdf 7.1.0. They
check paper lengths against the scale, the turn, view geometry, one tag per element, schedule totals against
`quantities.csv`, hostile names, a failed publish and an unscaled scene. The scene is authored geometry, not a capture:
the tests show the sheets say what the model says, not that a model matches a building.

An independent review of the first version found seven defects, each now with a test that fails on that version: a
huge unknown cell could ask for millions of hatch lines; quantities were counted after the plan was turned, so the
point-covered footprint could differ from the CSV; a turned box could be painted over a box in front of it; a box
below the floor ran off the sheet; a hidden element was still tagged; a third index column ran under the cover note;
and a title beyond ASCII was garbled in the document information. A scene that can no longer be drawn now also removes
the set drawn from an earlier one.

One real model was drawn by hand during development: a phone walkthrough of a showroom (23 walls, 16 objects, 160
unknown cells, scale estimated by the reconstruction model). PDFKit on macOS opened all 12 sheets. Its plan reads
clearly; its elevations show the fragmentary walls that capture produced. That run is not in the repository.

Also fixed here: `cad_export.quantities` raised on a scene with no floor object, because it formatted two empty
placeholders as numbers. Such a scene lost its DXF, 3DM and CSV. It now writes empty extent cells.

## Not done

- No drawing set has been checked against a measured building.
- The section cut is the best of nine planes, not of every plane: a plane between two of them can pass through more.
- Elevations do not split a box that is partly hidden by one that passes through it.
- No sheet has been opened in Revit, AutoCAD or Bluebeam; only pypdf and PDFKit have read the file.
- The rebuild path's publish step needs Linux (`renameat2`), so its test runs in CI and not on macOS.
- Browser transport fixtures exercise authored geometry; they are not a real-building accuracy qualification.
