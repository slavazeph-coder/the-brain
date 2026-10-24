# Reviewed BIM openings

World Builder now supports an explicit review step between a metric reconstruction and its building-model exports.
The browser shows wall dimensions and a labelled plan locator. An operator chooses a host wall, enters an opening's
dimensions and placement, declares that review, and separately consents to uploading the revised cloud. This is a
bounded authoring tool, not an automatic door detector or evidence that a measured room was reconstructed accurately.

## Operator flow

1. Upload or record an overlapping walkthrough, run reconstruction, and set scale using an identifiable measured span.
2. Add independent point-pair readings in the reconstruction. Keep these separate from the calibration pair.
3. Compile the metric scene and read every failing or absent check in Building model review.
4. Locate a host wall using its ID, plan highlight and dimensions. The marked start is the negative end of its local
   length axis. Enter the near-jamb offset from that end, width, height and sill measured from the host wall base.
5. Choose an unfilled opening or a door reference. Confirm each opening, consent to the worker upload, and recompile.
6. Download the IFC and evidence. Inspect individual elements, units and opening relationships in the intended BIM
   application before presenting an editable BIM demonstration.

Doors have a thin closed reference leaf. There is no automatic swing model, hinge inference or passability claim.
An unfilled floor-level opening can remove its wall segment from the planar planner only with at least 2 m headroom;
closed doors and elevated openings remain blocked. Unknown space stays blocked. Robot height and physical motion
still need separate validation.

## Source-bound contract

A metric `brainsnn.arena.cloud.v1` may contain:

```json
{
  "bimReview": {
    "schema": "brainsnn.bim-review.v1",
    "cloudPointsSha256": "<ordered point hash from measurement_check --fingerprint>",
    "openings": [{
      "id": "door-1",
      "hostWall": "<exact scene wall name>",
      "offsetMeters": 0.5,
      "widthMeters": 0.9,
      "heightMeters": 2.0,
      "sillMeters": 0,
      "kind": "door",
      "reviewed": true,
      "host": {
        "centre": [0, 1.5, 0],
        "size": [4, 3, 0.2],
        "yaw_degrees": 0
      }
    }]
  }
}
```

The numbers above illustrate the schema only. Copy the actual host snapshot and point hash from the scene/cloud
being reviewed. There may be 1 to 32 nonoverlapping rectangular openings within 64 KiB. Every rectangle must fit
its host; doors start at its base. Remove `bimReview` entirely to return to an unedited scene. The worker rejects
changed points, scale, host geometry, missing hosts, unreviewed edits, overlapping rectangles and invalid numbers.
The browser also discards stale reports and review state after a source, worker or scale change.

The compiler retains original semantic wall hosts in `scene.json`. It adds `scene.openings` and review provenance,
then builds the corresponding cut solids in GLB, USD and 3DM, plan gaps in DXF and film overlays, and net wall
quantities. IFC uses `IfcOpeningElement` with `IfcRelVoidsElement`; a door also has `IfcRelFillsElement`. Fit metrics
use the exposed cut surfaces rather than removed faces or internal decomposition seams. Raw point coordinates,
entered scale and original references are not changed by review.

## Qualification boundaries

`scene-measurements.json` compares reconstruction point pairs with self-reported physical readings. A passing span
does not validate every BIM element or infer hidden wall thickness. Model-to-points fit is a separate internal metric.
`metric_verified` and certification remain false. Original object names and their review status are preserved when
recompiling the same source; reusing suggestions does not approve them.

The compiler tests include rotated hosts, multiple openings, door fills, actual IFC solid-volume checks and an
IfcOpenShell edit/save/reopen round trip. The browser tests use an explicitly authored transport fixture. A real
phone-room capture with withheld readings and a native BIM-application editing session remain separate acceptance
gates in [the release checklist](world-demo-release-checklist.md).
