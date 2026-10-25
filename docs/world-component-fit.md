# Component fitting and reviewed correction

The next World Builder layer checks individual model elements against their
bound reconstructed points and proposes limited wall corrections. It does not
establish physical accuracy. All inputs, outputs and conclusions refer to the
retained scene revision and reconstructed cloud.

## What runs

Metric `scene-usd` jobs with a component graph and source evidence now publish
`component-fit.json`. It is available beside the IFC, Rhino and measurement
files in the existing BIM download panel. Saved component rebuilds also emit a
fresh report and hash it in their artifact receipt.

The report recomputes deterministic compiler memberships from the complete
ordered cloud. The 256 published evidence indices are a display sample, not
the fitting dataset. Exact scene/cloud bytes, source point hash, graph revision
and supplied component evidence must match. Retained camera evidence is
recomputed through the same source-job path when it is supplied.

Per-component residuals describe the current model against reconstructed
geometry. Large errors remain in the distribution. Point support, plane
conditioning, proposed improvement and camera availability determine which
components receive refinement candidates or recapture requests. These are
diagnostic rules, not calibrated probabilities or accuracy certificates.

## Scope

- Walls: estimate a supported visible-face plane and consider a bounded change
  in horizontal normal position and yaw. Preserve length, height and thickness.
  A one-sided wall's solid remains behind its observed face. Reconstruction
  spread does not establish actual construction thickness.
- Floor: report plane support and limitations of the rectangular floor extent.
  Sampled floor points cannot establish coverage of an entire room or make
  unknown cells navigable. Floor corrections are diagnostic in this version.
- Openings and door leaves: operator-authored geometry stays explicitly
  unsupported by compiler point membership. Capture both jambs, the head and
  the adjoining wall for later detection/review; missing wall points alone do
  not detect a doorway.
- Edited geometry: cannot inherit the original compiler's observed support.
  Changed walls and their hosted openings retain authored provenance.

Physical tape/laser checks remain in `scene-measurements.json`. They are not
used as fitting targets or to choose a correction. Their held-out status is
unchanged, and fitting never rescales the cloud.

## Offline report

Use a metric scene and cloud from the same retained job. The installed worker
Python environment supplies NumPy and the existing scene/compiler dependencies.
Use a fresh output directory.

```bash
python -m robotics.world_worker.component_fit \
  --scene JOB/output/scene.json \
  --cloud JOB/output/arena-cloud.json \
  --evidence JOB/output/component-evidence.json \
  --source-job RECONSTRUCTION_JOB \
  --out output/fit-review
```

`--source-job` refers to the retained reconstruction with its private camera
ledger and source geometry, not an arbitrary image folder. If no camera job is
available, omit both `--source-job` and `--evidence` to generate a new
membership-only diagnostic with camera support explicitly unavailable. Do not
remove an evidence argument to bypass a mismatch during a retained-job review.

## Review and regenerate

Inspect the report, the original images, component identity and proposed
geometry. Select specific eligible wall component IDs; no default operation
accepts every candidate. The refinement command recomputes the report before
creating an existing `brainsnn.component-edits.v1` contract. Altered reports,
stale scenes and unsupported targets are rejected.

```bash
python -m robotics.scene_compiler.refine_components \
  --scene JOB/output/scene.json \
  --cloud JOB/output/arena-cloud.json \
  --fit JOB/output/component-fit.json \
  --evidence JOB/output/component-evidence.json \
  --source-job RECONSTRUCTION_JOB \
  --component-id SELECTED_WALL_UUID \
  --out output/reviewed-refinement
```

Add `--blender /absolute/path/to/blender` to create the rebuilt bundle under
`output/reviewed-refinement/model/` as well.
The ordinary compiler admission rules still apply. `--allow-unverified` is
only for explicitly labelled authored software experiments, never a production
capture-quality shortcut.

The selected edits go through the existing atomic component editor and native
Blender rebuild. Hosted openings follow their wall. The fresh bundle includes
GLB, USD, IFC, Rhino, DXF, quantities, measurement evidence, component evidence,
fit reports and conservative navigation files. Original inputs stay unchanged;
IDs stay in their source namespace. New geometry is operator-authored and its
previous map/review/accuracy flags are invalidated. A better internal surface
fit does not authorize robot motion.

## Acceptance experiment

Use three independent captures of a real room. Keep calibration separate from
withheld physical measurements. Record correction time, all residuals,
missing surfaces, failures and final IFC/Rhino editing behavior. Compare the
same input cloud when testing modeling engines; compare independently measured
space when testing complete capture workflows.

The first priority is a correctly fitted room shell with a reviewed doorway.
Video-mask instance separation, automatic opening detection, metric uncertainty
calibration, merging recaptures, native Rhino/Grasshopper editing and physical
robot validation remain separate work. This implementation runs no new model
checkpoint and makes no market-superiority claim.

## Public implementation references

- [Moving Atoms' documented scan-to-BIM stages](https://movingatoms.ai/blog/ai-scan-to-bim/)
  motivate instance separation, fitting, relationships and explicit review;
  they do not disclose its private implementation.
- [Moving Atoms' quality-control guide](https://movingatoms.ai/blog/scan-to-bim-quality-control/)
  separates scan quality, model fit and information acceptance.
- [IfcOpenShell geometry creation](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_creation.html)
  describes profiles, axes and solid representations used for structured IFC.
- [SAM 2](https://github.com/facebookresearch/sam2) is a candidate for a later
  tracked image-mask comparison. It is not executed by the component fitter.

See [the qualification record](world-component-fit-qualification-2026-10-25.md)
for actual executed results and limits. Synthetic
fixtures and reconstructed public datasets cannot establish real-room physical
accuracy.
