# Backend dimensional evidence

The video model already identifies objects from registered frame crops; their dimensions come from reconstructed geometry at an entered scale. Every metric `scene-usd` job now emits `scene-measurements.json`, separating unchecked box dimensions from physical-reference comparisons. This is distinct from `fit-check.json`, which measures agreement with the reconstruction itself.

Without references the report says `no-held-out`. It inventories wall, floor and object dimensions, including the modelled wall thickness, floor slab depth and inferred furniture bases. Every element remains `independentlyChecked:false`. Point-pair checks do not validate every compiled BIM element.

## Run on a finished job

```sh
python3 -m robotics.world_worker.measurement_check --fingerprint /path/to/arena-cloud.json
python3 -m robotics.world_worker.measurement_check \
  --cloud /path/to/arena-cloud.json --scene /path/to/scene.json \
  --checks /path/to/dimension-checks.json --out /path/to/new-report.json
```

Without `--checks`, the command uses references embedded in the cloud if present; otherwise it inventories unchecked dimensions. Output must be a fresh path. Exact input-file hashes accompany the report; `sceneCanonicalSha256` is separately labelled as a canonical parsed-JSON hash, not the original file hash.

An optional `measurementChecks` object can also travel inside a metric `cloud` upload. The existing API validates it before compilation and preserves it in the returned cloud. It never changes scale or coordinates. The browser's existing 2D worksheet is unchanged; a 3D check-entry interface is not part of this change.

## Reference contract

This example is illustrative, not a measured BrainSNN result. Replace the hash, indices, distances, date and instrument with actual evidence:

```json
{
  "schema": "brainsnn.dimension-checks.v1",
  "cloudPointsSha256": "<hash from --fingerprint>",
  "coordinateFrame": "right-handed-y-up",
  "units": "m",
  "tolerance": {"absoluteMeters": 0.05, "relative": 0.02},
  "checks": [{
    "id": "withheld-span-1", "label": "Independent visible landmark span",
    "role": "held-out", "pointIndices": [0, 1], "distanceMeters": 1.2,
    "uncertaintyMeters": 0.005, "method": "tape", "instrument": "Actual instrument",
    "measuredOn": "2026-10-24", "note": "Describe the actual endpoints"
  }]
}
```

Indices address the exact ordered points in `arena-cloud.json`. They must identify the same physical landmarks that were measured. Missing/occluded endpoints need another capture or a different check. There may be 1 to 64 checks within 64 KiB. IDs and endpoint pairs must be unique, including across roles. Roles are `calibration` and `held-out`; methods are `tape`, `laser` and `manual-reference`. A model estimate is not an accepted physical reading.

The hash is SHA-256 over the ASCII prefix `brainsnn.dimension-points.v1\0right-handed-y-up\0m\0`, then each ordered point's six XYZ/RGB values encoded as little-endian IEEE-754 Float64. Reordering, changing or scaling points invalidates the references.

## Read results

For reference length `r`, the requested threshold is `max(absoluteMeters, relative * r)`. The example thresholds are an operator-selected policy, not achieved accuracy or a calibrated confidence interval. Reading uncertainty stays separate and never widens the threshold.

- `no-held-out`: no withheld checks; calibration agreement is not validation.
- `within-requested-tolerance`: all supplied held-out point-pair checks meet that policy.
- `outside-requested-tolerance`: at least one held-out check fails.

Status covers held-out point pairs only. Review calibration failures separately. Roles, readings and instrument details are self-reported: the system cannot attest that a withheld reading was not used elsewhere to tune the reconstruction. Do not recalibrate from withheld checks and keep describing them as independent validation.

All reports retain `metric_verified:false` and `certified:false`. Geometry, labels, scale and planning review flags are unchanged. Passing a few spans does not establish survey accuracy, obstacle completeness or dimensional accuracy for every wall, opening and object.

## Next physical qualification

Record three real phone captures of one measured room. Use one calibration span and at least three withheld lengths in different directions per run. Preserve capture hashes, calibration picks, original exports, failed checks and missing endpoints. Then open the IFC in the target BIM application and inspect the corresponding elements and doorway geometry. This change does not claim that physical trial, a BIM editing round trip, new MoGe/DA3 inference or automatic BIM openings has happened.
