# BrainSNN World Builder: implementation and validation

World Builder is live on brainsnn.com as a labelled preview, deployed from `main` (see Deploy path). It is not yet a fully qualified real-to-sim product. The full objective remains in [the flagship specification](world-builder-flagship.md).

## What works now

The flagship homepage preserves the near-black, cyan and violet identity and uses the requested headline. `/` and `/world` embed the local workspace; `/?classic=1`, Arena and research routes remain accessible. The frame now fits short landscape screens. The same-site [API guide](../brainsnn-r3f-app/public/world/api.html) describes private operator-provisioned access and its limits.

A selected photo can run Depth Anything V2 Small on-device after explicit approval to download the runtime and model. It produces an explorable relative-depth point cloud, with source comparison, cancellation, binary PLY export and provenance. It does not create unseen surfaces, establish metric scale or create collision geometry. Model files are downloaded; the source image is not uploaded. The model is pinned to `onnx-community/depth-anything-v2-small@4472b7362082ad9968fee890ca0f1e5aca36b93d`, q8, whose model card declares Apache-2.0. This is distinct from the still-unqualified Lyra pipeline.

The first-party viewer handles bounded PLY and SPLAT files, classifying ordinary points separately from Gaussian parameters. It displays up to 100,000 uniformly sampled points, uses DC colour for Gaussian assets, and supports touch orbit/pan/zoom and keyboard controls. GLB remains available in the separate same-site asset viewer using the existing Arena loader with synthetic floor and robot objects disabled. SPZ and KSPLAT require conversion. No remote rendering code is needed to view local assets.

The private worker performs authenticated resumable uploads, explicit job preparation/start, status polling, cancellation, retention and short-lived artifact downloads. Completed PLY/SPLAT outputs can load directly in the workspace after bounded streaming and SHA-256 verification. Real COLMAP CPU reconstruction now processes overlapping photos or decoded video into sparse points and camera poses. It is not dense reconstruction or verified collision geometry. See [the reconstruction report](world-reconstruction-validation.md) for actual evidence and the bounded MapAnything GPU qualification.

An optional private tenant registry maps random credential hashes to server-owned identities, engine allowlists and upload/job/storage allowances. Every API record and download ticket is owner-bound; the legacy operator identity cannot read tenant jobs through HTTP. Removing or rotating credentials revokes access and tickets, and queued work rechecks authorization. Existing data migrates only to the reserved operator owner. The registry is not public signup, metered compute or process isolation: adapters still share the worker's service account and filesystem.

RoomPlan CapturedRoom JSON and existing BrainSNN Arena maps import through the established Arena parser. World Builder preserves the floor polygon, including concave and rotated floors; it never fills the capture's bounding rectangle with traversable space. Imported scale and geometry require renewed review. Polygon dimensions are locked in this interface to prevent accidental distortion. The planner uses conservative robot envelopes and keeps unknown regions blocked. Arena export preserves the polygon; static USDA export currently rejects nonrectangular floors explicitly.

The World panel also records independent distance readings, uncertainty, instrument/date and floor/start/object review decisions in a local worksheet. Its canonical geometry SHA-256 binds records to the exact map. Edits mark prior evidence stale; imports reset it to reference-only. Proof export snapshots the map, assumptions, sources, events and optional worksheet before asynchronous hashing. These self-reported records do not change geometry, planning approval or reconstructed-artifact metric flags.

The optional local vision-model adapter accepts one photo or a bounded MP4/MOV video, strips derivative metadata, and submits up to four 512-pixel frames to the operator’s loopback model server. It requests a strict response schema and checks the returned model alias. Generation is limited to six concise, partial frame-bound labels within 1,024 output tokens; box generation remains unqualified and is disabled. Outputs retain original/source-frame SHA-256, exact decoded video PTS/time base, uncertainty text and model/prompt provenance. The import/review format also validates optional normalized 2D boxes from earlier evidence. A separately verified frame index binds the proposals to the displayed PNG bytes. The Understand panel supports accept, edit and reject without changing map objects, scale or geometry review. Pending edits survive navigation but enter proof exports only after explicit review. Empty model output does not prove free space. Model revisions are operator-declared, not remotely attested signatures.

### Real → sim: a reconstruction proposes a planning map

A reconstruction that comes with camera poses (the worker's `reconstruction.json`, loaded with its point cloud, or imported locally after the PLY) can propose a World v1 map in one step from the Capture panel ([`reconstruction-map.mjs`](../brainsnn-r3f-app/public/world/reconstruction-map.mjs)):

1. **Up:** the mean image-down axis of the registered cameras (refused when the cameras disagree).
2. **Floor:** the lowest dense height layer of points below the cameras.
3. **Scale:** either a distance you measured in the room or an editable assumed phone height (default 1.35 m). For a measured scale, tap both ends of the measured span (for example a doorway's width) in the 3D view and enter the distance. That pair sets metres per reconstruction unit exactly. A measurement that would put the phone outside 0.3–2.5 m above the floor is refused as a wrong pick or typo. Either way the scale is self-reported, so the `scaleReviewed` gate stays unchecked.
4. **Horizontal axes:** aligned to the walls by maximising the sharpness of projected structure.
5. **Free cells:** where the camera passed, in steps up to 1 m, plus where floor points were seen, with single-cell gaps closed.
6. **Obstacles:** dense points between 0.12 m and robot height. Dense evidence wins over the walked path; isolated weak points become unknown, never free.
7. **Unknown:** everything unseen stays blocked.

Free and obstacle cells merge into at most 128 axis-aligned boxes on whole-centimetre cells. The robot start is the most open free cell within 1.5 m of where the walk began. The result is `provenance: observed`, `geometrySource.kind: reconstruction-proposal` with its assumptions as warnings, and `scaleReviewed`/`mapReviewed` false, so the existing review gate still decides when planning may run. The proposal event enters the proof pack. It records the job, the evidence SHA-256, the scale source and the implied phone height. For a measured scale it also records both picked points in reconstruction coordinates, their span and the entered distance, flagged `selfReported`. Picking needs a pointer or touch; keyboard users can still use the assumed height.

Pipelines that call the worker API directly can run the same proposal without a browser: `npm run world:propose -- --points sparse-preview.ply --evidence reconstruction.json --out world.json --report proposal.json [--measure "ax,ay,az;bx,by,bz;metres" | --camera-height m]` ([`scripts/world-propose-map.mjs`](../brainsnn-r3f-app/scripts/world-propose-map.mjs), documented in the [API guide](../brainsnn-r3f-app/public/world/api.html)). The report adds each input's SHA-256. The output map is unreviewed: World Builder imports it with its gate closed, and Arena/OpenUSD exports stay blocked until a person reviews it. A single-photo depth preview has no camera poses and never proposes a map.

### Simulation scene: walkthrough → Blender GLB/USD (October 23, 2026)

The worker engine `scene-usd` ([`scene_usd.py`](../robotics/world_worker/scene_usd.py)) turns one walkthrough video into a simulation scene. It runs COLMAP, then the same Arena hand-off as the browser's point-cloud export, then the [scene compiler](../robotics/scene_compiler/README.md) in headless Blender. It writes:
- `scene.glb` for the browser;
- `scene.json`, which records each object's label and provenance. Placed boxes also carry a size and centre, walls and placed detections carry their supporting point count, and unplaced detections carry the reason instead. Unknown cells are listed separately, with totals in `counts`;
- `scene.usda` for Isaac Sim and Omniverse, only for a metric scene (see below);
- `scene.ifc` for BIM tools (IFC4, metres), also only for a metric scene. Walls are `IfcWall` with their measured orientation, the floor is an `IfcSlab`, placed detections are `IfcFurniture`, and unknown space is an `IfcBuildingElementProxy` named "Unknown space (not free)". Each element carries its provenance and support count in `Pset_BrainSNN`, and the project records the scale source, the measured distance, `SelfReported` true and `MetricVerified` false. On the metric ETH3D office scene, IfcOpenShell's validation, including the IFC4 EXPRESS rules, reported 0 issues, and the IFC wall and floor geometry matched the GLB to the millimetre.

Provenance follows the same rules as the planning map:
- **observed:** the floor, walls (vertical planes) and, in metric scenes, separated objects measured from their points.
- **unknown:** floor no point reached. It is exported as a tagged volume, never as free space.
- **detected:** 2D detections from an observation sidecar lifted into 3D boxes. Only the compiler run directly with `--detections` does this: the worker engine never passes detections, so worker scenes contain no detected objects. The compiler lifts every detection in the sidecar and does not read review decisions, so pass only detections you have reviewed. A detection is lifted only through its frame's camera pose. Without that pose, or without a box, it stays unplaced and the reason is recorded.

Nothing is inferred, and single-photo depth is refused. `scene.usda` declares `metersPerUnit = 1`, so it is written only for a cloud with a measured scale; otherwise `scene.json` records why it was skipped. A walkthrough video job has no measured scale yet, so its scene is in arbitrary units without `scene.usda`.

**Metric scenes (October 23, 2026).** The scale is measured after reconstruction, on the reconstruction itself, so the metric path takes the measured cloud back to the worker:
1. Pick two points on a multi-view reconstruction and enter the distance you measured between them. Multi-view means camera poses from at least two views, from COLMAP or dense MapAnything; the hand-off then says `multiView: true`. A single-photo preview never qualifies.
2. The calibration card then offers **Build metric simulation scene (GLB, USD, IFC)**. It needs a connected worker whose engine lists the `cloud` input kind.
3. After an explicit consent tick, the browser uploads the same Arena point-cloud JSON it exports as a `cloud` upload: `.json`, up to 16 MiB and 50,000 points.
4. `scene-usd` skips COLMAP and compiles that cloud.

The worker parses the hand-off strictly: no NaN, bounded coordinates and colours, a footprint the compiler's unknown-space grid can cover (at most 250 × 250 m at 0.5 m cells, also enforced in the compiler), and the known fields only. A metric cloud must carry its scale as user-measured, self-reported and unverified, and a single-photo preview is refused. The scene opens in the dialog, which says the metres are self-reported. The request is recorded in the proof pack with the metres per unit.

Real run on the Mip-NeRF 360 room reconstruction. Two tapped points with an illustrative 0.66 m per unit (not a measurement of that room) gave a 3.97 × 7.95 m floor and 5 walls 1.5–2.2 m tall. `scene.usda` declared `metersPerUnit = 1`, the compile took 1.5 s, and the round trip from the click took about 6 s in Chromium at desktop and phone sizes.

**Checked against ground truth (ETH3D office, October 23, 2026).** ETH3D's *office* scene has real DSLR photos, ground-truth camera poses in metres and a laser scan (CC BY-NC-SA, used for testing and not committed). The test ran through the built site and the real worker (`colmap-sparse`, then `scene-usd` with Blender 4.2 via `bpy`), in Chromium:
- **Input:** twelve photos, downscaled to 3024 × 2016 to stay within the 24 MP limit.
- **Reconstruction:** all 12 registered, with 695 sparse points.
- **Ground-truth scale:** aligning the reconstructed cameras to the ground-truth cameras gave 0.1361 m per unit, with camera centres agreeing to 1.5 cm RMS.
- **Measurement:** two points tapped in the 3D view are truly 2.976 m apart by that ground truth. That value was entered as the measured distance, the role a tape measure plays.
- **Metric scene:** `scene.usda` was written in metres, with a 2.89 × 2.38 m observed floor, one wall and 7 unknown cells.
- **Independent check:** placed in the scan's frame, the metric points sit a median 1.1 cm from the laser scan, with 88% within 5 cm and 94% within 10 cm.

So the scale and geometry are right where points exist, but a 12-photo sparse CPU reconstruction covers little of the room. Its points stop about 1.8 m above the floor (the scanned room is 4.1 m tall), and only one wall had enough support. A full simulation scene needs dense geometry, which is the planned GPU MapAnything path.

**Repeatable benchmark.** `python -m robotics.world_worker.benchmark_eth3d --reconstruction JOB/output --eth3d office --out report.json` scores any engine's output folder (`colmap-sparse` or `mapanything-apache`) against ETH3D ground truth. It needs the photos uploaded with their original names, and scipy for real scans. It reports:
- metres per reconstruction unit (about 1.0 for an engine that predicts metric scale) and the camera RMS;
- accuracy: reconstructed points against the laser scan;
- completeness: how much of the 2 cm voxelised scan has a reconstructed point within 5 / 10 cm.

CPU baseline, the 12 office photos above through `colmap-sparse`: camera RMS 1.5 cm, accuracy median 1.5 cm (87% within 5 cm), completeness 2.1% within 5 cm and 5.3% within 10 cm. Completeness is the number dense GPU reconstruction has to raise.

### Dense CPU points and separated objects (October 24, 2026)

**Dense points without a GPU.** The `colmap-dense-cpu` engine is the same COLMAP adapter run with `--densify-model` ([`densify.py`](../robotics/world_worker/densify.py)). After the sparse reconstruction, it:
1. Predicts depth for every registered frame with Depth Anything V2 Small, the Apache-2.0 checkpoint the site already runs on the device. It is pinned as ONNX by revision and SHA-256, and any other file is refused.
2. Fits each frame's depth to that frame's own triangulated points (`1/z = s·d + t`), which puts it in the reconstruction's units. Lifting and reprojection go through COLMAP's own camera model, so the fitted radial distortion is respected.
3. Keeps a lifted point only where at least 2 of the 4 nearest frames predict the same depth within 2%.
4. Writes `dense-preview.ply` (at most 50,000 points) before `sparse-preview.ply`, so the site opens the dense cloud. Camera poses and measured scale work unchanged, and `reconstruction.json` records the model, the alignment error and the counts under `dense`.

Scored with the ETH3D benchmark on the same 12 office photos:

| Points | Median error | Within 5 cm of the scan | Scan covered within 5 / 10 cm |
|---|---|---|---|
| Sparse (`colmap-sparse`) | 1.5 cm | 87% | 2.1% / 5.3% |
| Dense CPU (2%, 2 of 4 neighbours) | 3.1 cm | 59% | 7.6% / 11.4% |

Dense CPU covers 3.6 times as much of the room, at lower point accuracy. The agreement tolerance sets the trade-off: at 5%, coverage is 13.8% / 18.0% with a 6.8 cm median error; requiring 3 of 6 neighbours at 2% gives 2.1 cm and 5.0%. The ETH3D photos carry a radial distortion of −0.04, and handling it improved the default from 3.4 cm and 7.2%. These ETH3D figures come from 12 widely spaced photos; a walkthrough gives each frame closer neighbours. On the 62 s room walkthrough, all 57 frames aligned to their SfM points with a median relative error of 1.3%. The depth pass took about 80 s on 4 CPU threads, fusion took 7 s, and about 39,000 points were kept. Dense GPU reconstruction (MapAnything on the 4090) remains the path to survey-grade coverage.

**Every object separated and measured.** In a metric scene the compiler now finds:
- **Walls:** vertical planes, found by RANSAC on points 1.3–2.3 m above the floor, above most furniture. A wall is at least 1 m long and 1.2 m tall, its own points cover at least 0.8 m of height (so a shelf top is not a wall), and it takes the points within 2.5 times its own scatter (6–15 cm). Furniture standing against it stays furniture. A doorway (at least 50 cm along the wall with none of its points below 1.9 m) splits it into one wall per stretch, and the points above the opening stay with the wall, so the opening stays passable.
- **Floor:** points within twice the floor layer's scatter of the floor plane (5–15 cm) count as floor.
- **Objects:** every other cluster up to 2.4 m above the floor is its own object. Clusters are 10 cm cells joined through their faces, at least 0.3% of the cloud.
- **Measurements:** each object gets the smallest oriented box around its 3–97% extents, in metres, standing on the floor when its lowest points are within 30 cm of it.
- **Exports:** objects are written to `scene.json` with `kind: separated` and to the GLB and USD with their orientation. In IFC, an object nothing has named is an `IfcBuildingElementProxy` called "Object N", with its length, width and height in `Pset_BrainSNN`. An object a lifted detection overlaps (at least 30% of its points inside the detection's box) takes that label and becomes `IfcFurniture`.
- **Dialog:** it lists the count and the largest objects' measurements.
- **Robot route in the scene:** for a metric scene, the dialog offers **Plan a robot route in this scene**. It turns `scene.json` into an unreviewed World v1 map in the scene's own frame (`worldFromScene` in [`scene-preview.mjs`](../brainsnn-r3f-app/public/world/scene-preview.mjs)):
  - The observed floor sets the map's size.
  - Walls and objects become obstacles: axis-aligned boxes that contain them. A diagonal one is cut into up to 4 strips along its length, so it blocks little more than itself and the map stays within 128 boxes. A scene with more elements than that is refused.
  - Floor cells no point reached stay unknown, and the rest of the observed floor is proposed as free.
  - The robot starts at the most open point and plans only after both reviews.

  On the dense room walkthrough at the same measured scale, the map proposed from the points left a robot vacuum 0.2 m² (a 3.4 m route from the nearest start that fits), because the dense floor's scatter reads as obstacles. The scene map gave it 3.4 m² and a 67.8 m coverage route around 8 walls and 14 separated objects. Two more objects lay outside the observed floor.

**Names from the frames (Claude).** Separation measures objects but cannot say what they are. With naming on, the scene
engine also suggests a name for each separated object ([`object_names.py`](../robotics/world_worker/object_names.py)):
1. **Find it in the frames.** The site's hand-off records `fromSource`, the exact transform from the reconstruction's coordinates to the cloud it sends. The scene job may read the same owner's reconstruction job (`source_job`), so each object is projected into the registered frames through COLMAP's own camera model.
2. **Pick two views.** Only frames that see at least 85% of its points, with at most half hidden behind other points (a z-buffer in 8-pixel cells), are used. The second view must come from a camera at least 0.3 m from the first.
3. **Ask once.** The crops, each with the object outlined, go to Claude (`claude-opus-5-5`) with the measured sizes in one request. The answer is constrained to a JSON schema: a name, a category and a confidence for each object. A refusal, a truncated answer or ids that don't match are recorded, and the scene compiles unnamed.
4. **Apply carefully.** A name is applied only at medium or high confidence, only to an object no detection named, and only where the object's centre and height match the one that was cropped. Furniture becomes `IfcFurniture`; anything else is a named `IfcBuildingElementProxy`. Both carry `LabelReviewed` false and the model in `Pset_BrainSNN`, and the dialog says "Suggestions, not reviewed."

Crops leave the worker only after a second, separate approval in the site ("Also send crops of each separated object … to Anthropic"). That box appears only when the engine advertises `object_naming` and the reconstruction came from this worker. The worker passes `ANTHROPIC_API_KEY` to that one adapter (`"secrets"` in `adapters.json`), never to the others. Without the key, naming is not offered. The model call is mocked in CI (`tests/world/test_object_names.py`).

**Names from a detector on the worker (no key, nothing sent).**
- [`detector_names.py`](../robotics/world_worker/detector_names.py) runs MediaPipe's EfficientDet-Lite2 (COCO's 80 categories) on the same views `choose_views` picks. It runs when the engine is started with `--detector-model` and the vision model did not name the objects: naming was not approved, there is no key, or the call failed.
- **Matching.** A detection names an object when the two boxes overlap (IoU at least 0.3). It also names one when at least 70% of the object's box lies inside a detection no more than 8 times its size, because sparse points often cover only part of an object.
- **Confidence.**
  - Medium needs either one clear match (IoU at least 0.5 and a score of at least 0.6) or agreement in two views.
  - High needs both.
  - Low names are not applied.
  - A second category with half the votes names a pair ("table and sofa").
- **Labels.** Only room categories become labels (sofa, chair, table, bed, television, potted plant, appliances…); people, animals and vehicles never do.
- **Data and approval.** No crop is made and no frame leaves the worker, so the site asks for no second approval. Because the scene step needs that job's frames, the site sends the reconstruction job whenever the engine advertises `object_detection`.
- **Measured run.** Real room walkthrough, 10 separated objects, 2.3 s on CPU: sofa (high), chair (medium) and potted plant (medium). The other 7 stayed "Object N", because COCO has no piano bench, door or computer tower. Claude named 7 of 10 on a dense run of the same room (#224).
- **Licence.** The model file carries no licence notice, so the operator reviews its terms before enabling it. On Linux, MediaPipe needs `libegl1` and `libgles2` even on CPU (`requirements-detector.txt`).

Objects that touch, such as a sofa with a table against it, stay one object, because geometry alone cannot split them. On the dense room walkthrough this gave 8 objects, including an armchair-sized 1.01 × 0.97 m, 1.06 m high, and 6 wall planes.

The engine is registered for GB10 in `adapters.gb10.json`. An 11-frame clip there ran end to end in about 20 s. When a job returns a `.glb`, Evidence offers **Explore scene.glb in 3D** next to the downloads ([`scene-preview.mjs`](../brainsnn-r3f-app/public/world/scene-preview.mjs)). The workspace downloads the file with a short-lived ticket, checks its SHA-256, and opens it in a dialog with the Arena's mesh viewer, which loads only on first use. Beside the scene it lists only what `scene.json` records: observed points and walls, placed and unplaced detections, unknown floor cells, units and whether USD was written. A missing or malformed `scene.json` is shown as unknown, never guessed.

Verified on October 23, 2026, on a cloud container. The built site was connected to the real worker HTTP API running `scene-usd`, with Blender 4.2 as the `bpy` module behind a small `blender` stand-in, on the Mip-NeRF 360 *room* walkthrough. Each run took about 2.5 minutes of CPU COLMAP and gave about 9,950–10,000 points, 5–9 walls and 42–52 unknown cells. Wall counts vary because COLMAP is not deterministic. The scene had about 121,000 vertices and rendered in Chromium at desktop and phone sizes with no page errors. WebKit was not available on that container. World checks run the compiler and adapter contracts without Blender or COLMAP. They also run `scene_browser_smoke.py`: Chromium at desktop size and WebKit as an iPhone 15, against the real worker with an authored transport-fixture GLB.

### Deploy path (October 22, 2026)

brainsnn.com is published by Railway's GitHub deploy for `main` (GitHub environment `wonderful-charisma / production`). Railway waits for the GitHub checks on that commit, so a failed or cancelled check means nothing ships.

The pipeline runs in two stages:
- **Before the deploy: "BrainSNN app release checks"** (`.github/workflows/brainsnn-app-deploy.yml`). It runs the World checks, lint, the analysis tests, the build, the engine smoke and the server boot checks. It never deploys and needs no Railway secret.
- **After the deploy: "Verify BrainSNN live deploy"** (`.github/workflows/brainsnn-live-verify.yml`). It runs when Railway posts a successful `deployment_status`, and can also be started by hand. It checks that the live World Builder and Arena files are byte-identical to the deployed commit. It also checks the healthz endpoint and the Home/World, Classic, Arena and analysis release markers.
- Sponsor and GT3 live acceptance (`sponsor-live.yml`, the `verify-live` job in `sponsor-launch.yml`, and `gt3-live.yml`) now follow the verify workflow, so they test the site only after the new build is actually live.

History before this split:
- The workflow used to run `railway up` itself, and Railway rejected its `RAILWAY_TOKEN` as Unauthorized.
- **463eca2:** no Railway deployment was created.
- **2207c87 (on-device detection):** went inactive after the workflow's `world-contracts` job hung installing dependencies and was cancelled.
- Only commits outside the workflow's paths, such as the 43d8f8e retrigger, deployed.

### On-device object identification

A photo can also get object labels without a worker: "Identify objects on this device" downloads a pinned detector after consent and runs it in the browser. The photo is never uploaded. The detector is `Xenova/detr-resnet-50` at revision `8be7ab59`, q8 WASM, the ONNX conversion of `facebook/detr-resnet-50` (Apache-2.0). It suggests up to 20 objects scoring at least 0.7 from the 80 COCO categories, which exclude doors, stairs, boxes and cables.

Detections go through the same frame-bound observation sidecar and review as worker VLM output ([`detections.mjs`](../brainsnn-r3f-app/public/world/detections.mjs)):
- The reviewed frame is the exact lossless PNG of the pixels the detector saw.
- The provenance records the model, its revision and a hash of the detection settings.
- Each suggestion states that its score is not a calibrated probability and that a missed object is not evidence of free space.
- Accept, edit or reject is recorded in the proof pack. Labels never change scale or collision geometry.

Real run (`detect_browser_smoke.py`, opt-in, Chromium): one Mip-NeRF 360 *room* photograph produced 12 suggestions in about 10 s on CPU WASM, including chair, couch, TV and dining table. The chair box landed on the armchair. The only outbound requests were GETs to Hugging Face and jsDelivr for the pinned model and runtime. CI does not download models; run it with `WORLD_DETECT_PHOTO=/absolute/path/to/photo.jpg python tests/world/detect_browser_smoke.py`.

## Verified on October 22, 2026 (live site with the operator's CPU worker)

- Setup: brainsnn.com (main 5d90e0c) in Chromium, connected through the in-page dialog to the operator's Mac worker. The worker runs CPU COLMAP behind a Cloudflare quick tunnel, a test endpoint rather than production. It reported `inspect` and `colmap-sparse` only (no observations/VLM engine). Its CORS allowed brainsnn.com, and requests without the token got 401.
- Walkthrough: the 62 s room video, uploaded with consent. The worker reconstructed it in about a minute (57 camera poses, about 10,900 points). The site loaded `sparse-preview.ply` plus `reconstruction.json` and proposed a 4.4 × 7.4 m map at the assumed 1.35 m phone height: 8 m² free, 8.9 m² obstacles, 15.6 m² unknown. Planning stayed blocked until scale and map were reviewed.
- Route: after review, every robot preset was rejected with the old "start is blocked" message and no hint. Offline checks on the same artifacts showed no start anywhere in the map fits a preset. The free space in this furnished room is a corridor of about 0.8–1 m around the furniture, narrower than the planner's circumscribed-circle footprint plus margin and half-cell inflation. The planner now explains a blocked start. It names the nearest spot where the robot fits or, when none exists, the widest square robot any spot fits at that margin and where. On this map: about 0.25 m at (1.88, 4.13) with a 0.1 m margin, which then plans. The advice uses the planner's own test and is covered by unit tests. Open spaces, a measured scale (the room may be larger than the 1.35 m assumption implies) or a smaller envelope give real routes.
- Planner resolution: the planner grid now goes down to 10 cm cells instead of 25 cm. It still coarsens to stay under the 6,000-cell cap. Inflation is half a cell diagonal, so room- and garden-sized maps keep about 0.2 m more of every corridor, and the route still clears every obstacle by the robot's circumscribed radius plus margin. A "Robot vacuum" preset (0.35 × 0.35 m) joins the presets.
- Open-ground walkthrough: a 62 s video built from the 185 Mip-NeRF 360 *garden* photos (MIT on the Hugging Face mirror; credit Barron et al.). On the live site with the operator's worker: 60 poses and 20,828 points, an 11.2 × 11.2 m map (28.3 m² free around the table), and a 20.1 m Cleaning-robot route on the old 25 cm grid. On the 15 cm grid this map now uses, the same map gives 40.4 m for the Cleaning robot and 110.7 m for the Robot vacuum (0.1 m margin).
- Headless Chromium here cannot decode H.264, so the local preview showed "This browser cannot decode the video". The worker decoded it. Safari and Chrome decode H.264 natively.

## Verified on October 22, 2026 (measured-scale calibration)

- Proposal contracts: 8 Node tests. Two picked points 0.9 m apart in the synthetic room's arbitrary frame give metres per unit equal to the truth within 1e-9. The picked pair maps back to exactly 0.9 m, and the implied phone height comes out at the true 1.35 m whatever height was assumed. A 9 m entry for the same doorway (phone about 13 m up), identical points, NaN, sub-5 cm distances and malformed points are refused. All World Node contracts: 83 passed.
- Command line: 3 Node tests run the tool as a subprocess on the synthetic room's PLY and `reconstruction.json`. Assumed-height scale lands within 3% and a measured pair is exact. Input SHA-256 receipts are checked, and the output imports into World Builder with planning and OpenUSD export blocked until reviewed (both work after review). Conflicting flags, non-JSON evidence and an out-of-range height fail without writing a map. On real CPU COLMAP output (the rejected no-upscale variant's 49 poses and 6,328 points from the room video) it produced a 3.6 × 7.2 m unreviewed map in 0.26 s. All World Node contracts: 86 passed.
- `realtosim_browser_smoke.py` now also taps two points on the WebGL view (mouse on desktop, touch on the phone viewport). It enters their true distance, re-proposes and checks the proof. Chromium recovered 2.7027 m/unit, the fixture's exact 1/K, on both viewports. The proof carried `scaleSource: measured-pair`, the picked points and the implied height. The other Chromium World suites (HTTP smoke, capture, observations) and the real 12-photo worker chain (12 poses, 2,592 points) still pass. App suite: 1,083 + 73 passed; lint and production build pass. WebKit and a physical iPhone were not available locally.

## Verified on October 21, 2026 (real → sim handoff and main merge)

- Proposal contracts: 6 Node tests on a measured 8 × 6 m room expressed in an arbitrary rotated, scaled and shifted COLMAP-like frame. Scale is recovered within 3%; the box becomes an obstacle with a height near its true 0.8 m; the unobserved corner stays unknown; every walked position stays free. Planned routes never enter obstacles or unknown space. Contradictory camera orientations, missing poses and too few points are refused. All World Node contracts: 81 passed.
- Real data: the CPU COLMAP adapter processed a 62-second walkthrough video, made from the Mip-NeRF 360 *room* photographs (test data, not a phone capture). It registered 57/60 frames and 10,963 points in 139 s. The proposal ran in 76 ms and produced a 4.6 × 7.6 m map at the assumed camera height: 8.1 m² seen free, 8.7 m² obstacles and 18.1 m² unknown. A top-down overlay showed furniture as obstacles and the photographer's positions as free. This room is cluttered: a default cleaning envelope does not fit at the start, while a 0.35 m envelope plans a short route.
- Real browser chain (`worker_browser_smoke.py`, Chromium): 12 room photographs went through upload, the real worker, CPU COLMAP, verified artifact and evidence downloads, then the proposal from the worker's 12 camera poses and 2,594 points. The review gate blocked planning, and the proof pack linked the map to the job and the `reconstruction.json` SHA-256.
- `realtosim_browser_smoke.py` (added to hosted World checks for Chromium and WebKit) covered the import, proposal, gate, review, plan and proof sequence on desktop and phone-sized viewports. Only Chromium was available locally.
- Main (#199, World Engine homepage and `/scan`) is merged. `/` and `/world` remain World Builder; `/?classic=1` is the robot-testing lobby; `/scan` hands off to World Builder. App suite: 1,083 + 73 passed. Production build and every deployment boot check passed. Existing World browser suites passed in Chromium: smoke, capture, visual and observations. World backend: 127 passed, 2 dataset skips.
- Tried and rejected for the COLMAP adapter on this low-resolution capture: not upscaling frames registered 49/60 frames and 6,328 points; one shared camera per video registered 50/60. Both are worse than the current 57/60, so the adapter is unchanged.

## Verified on October 19, 2026

- Production build and the existing app regression suite: 1,083 checks plus 73 paid-analysis tests passed.
- World core/import/viewer/client/observation/capture/measurement tests: 75 passed.
- Actual HTTP desktop and phone-sized Chromium and WebKit tests passed, including root iframe routing, landscape sizing, keyboard tabs, Classic/Lab/Arena links, RoomPlan import/review/planning/export, file boundaries and provenance.
- Real photograph inference passed in both Chromium and WebKit, with cancel/retry, source comparison and proof export. Captured request traces contain only GET/HEAD requests and no request bodies for the on-device inference journey. One observed Mac run produced 98,304 points in 2.1 seconds of inference; this is not an iPhone or end-to-end latency guarantee.
- PLY/SPLAT parser and WebGL rendering tests passed. GLB rendering, external-resource rejection, and clearing all synthetic geometry passed in desktop/mobile Chromium and WebKit.
- The separate real browser-to-worker journey also passed: 11 photo uploads, COLMAP execution, signed artifact retrieval, embedded viewing, binary PLY export and a provenance proof pack.
- Actual MapAnything Apache GPU runs produced 72,125 points from one photograph, 86,593 from three, 98,735 from eleven and 98,345 from a photograph-sequence MP4. Peak allocation stayed below 5.9 GiB. Actual outputs rendered in Chromium and phone-sized WebKit; production LLM health remained normal under the trial watchdog. These bounded trials do not qualify physical phone captures, geometric accuracy or collision surfaces.
- Actual local vision-model runs on GB10 produced one selected photo label in 8.1 seconds and four frame-bound video labels in 26.3 seconds. Exact artifacts replayed in Chromium and WebKit with unchanged source/frame/timestamp provenance and all reviews pending. The video is a photograph-sequence fixture, not a phone walkthrough; labels remain partial and unverified. Earlier schema, timeout and box failures are preserved in the reconstruction report.
- A separate HTTP observation test passed in Chromium and WebKit using distinct scoped credentials for the two browsers, the real worker, media decoder and CLI connected to an explicitly synthetic local VLM fixture. Each credential sees only its granted engine; the operator HTTP identity cannot list either tenant’s jobs. It checks upload consent, verified PNG evidence, inert model text, accept/edit/reject, draft persistence, proof export and source removal while keeping map geometry/review flags unchanged. Additional regressions cover a delayed connection response after session clearing and a stalled artifact stream; neither may restore cleared credentials or wait indefinitely. This test does not claim model inference.
- The complete default World backend suite now passes 127 tests with two optional COLMAP dataset skips, including 29 tenant regressions. They cover foreign-ID routes, mixed-owner inputs, migration/restart, credential/ticket rotation and revocation, delayed-body admission, lowered quotas, concurrent reservations and legacy operator behavior. The private browser observation flow also passed using distinct scoped credentials for Chromium and WebKit.
- Worker tests: 46 passed with the real fixture, including actual 11-photo and decoded-video COLMAP jobs through upload, processing and signed artifact downloads. The default CI run passes 44 tests and skips the two dataset-dependent qualification cases. The separate observation backend suite passes 54 tests covering actual media decoding, exact source PTS, bounded HTTP, constrained response validation and model identity. Its transport responses are fixtures. See the reconstruction report for actual GPU/model execution and fixture limitations.

Screenshots, proof packs and network records are local under `output/playwright/world/` (not committed customer/media assets). Browser tests now require real HTTP. The previous offline HTML/module-rewrite harness was removed; it did not establish real module loading or Safari behavior.

### Safari runtime correction

The initially selected ONNX Runtime JSEP build crashed WebKit during real inference, including without cancellation. The depth worker now explicitly selects the matching plain WASM module and binary from ONNX Runtime `1.22.0-dev.20250409-89f8206ba4`. The complete real-inference tests then passed with the unchanged model. This follows the independently reproduced failure described in [ONNX Runtime issue 26827](https://github.com/microsoft/onnxruntime/issues/26827). It does not replace testing on physical iPhones.

The runtime remains pinned to Transformers.js 3.8.1. Each inference disposes its pipeline and terminates its worker; cancellation terminates the worker immediately. Image decoding and display geometry are bounded. The downloaded weights may remain in the browser's model cache.

## Reproduce

From the repository root, serve the standalone workspace:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory brainsnn-r3f-app/public
node --test tests/world/*.test.mjs
```

Open `http://127.0.0.1:8765/world/index.html`. The authored sample and map editor need no model downloads. Photo inference requests approval before contacting the model/runtime hosts.

For the integrated build:

```sh
cd brainsnn-r3f-app
npm ci
npm run build
npm test
NODE_ENV=production PORT=4181 node dist/server.cjs
```

Browser regression dependencies are Playwright and Pillow in a disposable Python environment, plus Playwright Chromium/WebKit binaries. `PLAYWRIGHT_CHROMIUM_PATH` optionally selects an installed browser. JavaScript viewer tests use `PLAYWRIGHT_WEBKIT_PATH` if the locally installed WebKit revision differs from the app's Playwright dependency.

```sh
WORLD_BROWSERS=chromium,webkit WORLD_URL=http://127.0.0.1:4181/ \
  WORLD_SITE_URL=http://127.0.0.1:4181 \
  WORLD_PHOTO=/absolute/path/to/a/permitted-real-photo.jpg \
  python tests/world/browser_smoke.py
WORLD_BROWSERS=chromium,webkit node tests/world/visual-browser-smoke.mjs
```

`WORLD_PHOTO` opts into a real model download/inference test. It is never replaced with mocked model output. The GPU adapter likewise is not considered qualified from its CPU conversion fixtures.

The [World Builder contracts workflow](../.github/workflows/world-builder-checks.yml) runs on relevant pull requests and is a prerequisite of the existing Railway deployment workflow. It runs `npm run test:world`, pinned CPU worker tests (including real FFmpeg decoding and COLMAP failure handling), a production build, HTTP Chromium/WebKit workspace tests standalone PLY/GLB rendering tests, and the complete observation worker/review contract. CI does not download model weights. Its separate observation review contract test uses an explicitly named local response fixture; no live model output or quality is claimed. Python Playwright 1.64.0 installs the browser binaries; both Python and npm test drivers use those explicit executables, avoiding a second incompatible browser download. Root and standalone World Builder markers, Classic pricing and Arena pricing are also checked by the deployment boot/live gates. Workflow validation and local execution of its boot and browser commands passed. The [GitHub-hosted World contracts run](https://github.com/slavazeph-coder/the-brain/actions/runs/39268374210) also passed on Ubuntu 24.04 at commit `715ce8b14e2e278ba656e62d562e6f643f94c8d0`: all 37 Node contracts, 44 worker tests (two explicit fixture-dependent skips), the production build and both browser suites. The [observation follow-up run](https://github.com/slavazeph-coder/the-brain/actions/runs/39274565591) passed at `f905006cb12413b6c5bb2725ac364d682a2da515`: 56 Node contracts, 97 Python tests (two dataset-dependent skips), the production build, desktop/mobile HTTP flows and the separate observation-worker review regression in Chromium and WebKit.

A separate browser-to-worker reconstruction test starts disposable local HTTP servers and requires real overlapping photographs plus installed COLMAP:

```sh
WORLD_COLMAP_TEST_CAPTURE=/absolute/path/to/permitted-overlapping-photos \
  WORLD_COLMAP_PYTHON=/absolute/path/to/colmap-venv/bin/python \
  WORLD_SERVER_PYTHON=/absolute/path/to/python-with-fastapi-and-uvicorn \
  python tests/world/worker_browser_smoke.py
```

For the observation HTTP contract (fixture model response, real worker and UI):

```sh
WORLD_BROWSERS=chromium,webkit python tests/world/observations_browser_smoke.py
```

`WORLD_SERVER_PYTHON` and `WORLD_OBSERVATIONS_PYTHON` can select separate installed environments. Both default to the test interpreter.

## Worker operation

Use one worker behind TLS with persistent storage and an operator-owned token. Do not put it in public JavaScript or a VITE variable. Install `robotics/world_worker/requirements.txt`, configure reviewed adapters from `adapters.example.json`, then start:

```sh
# Supply WORLD_WORKER_TOKEN through your private service environment.
export WORLD_WORKER_DIR="$PWD/world-worker-data"
export WORLD_ALLOWED_ORIGINS="http://127.0.0.1:8765,https://www.brainsnn.com,https://brainsnn.com"
python -m uvicorn robotics.world_worker.app:create_app --factory \
  --host 127.0.0.1 --port 8010 --workers 1 --no-access-log
```

For a long-running host, `robotics/world_worker/deploy/` has a systemd unit, an environment template and a Cloudflare named-tunnel template. Check a deployed worker from outside with `python -m robotics.world_worker.check_worker --url https://... --upload-probe`. It verifies TLS, the token, the engines, brainsnn.com's CORS access and a chunked upload, without printing the token.

Connect with Capture → Process a walkthrough / use an API worker. Explicitly approve uploads to the displayed destination. `/v1/capabilities` advertises only available configured engines. Start with `inspect` for an integrity-only receipt. Enable an AI or reconstruction adapter only after its installation, licensing and hardware checks. Example engines are disabled by default.

The observation adapter additionally needs `requirements-observations.txt` (Pillow and PyAV), FFmpeg/FFprobe, and an already running local image-capable model server. Enable the example engine only after qualification. Supply these through the private worker service environment:

```sh
export WORLD_VLM_ENABLED=1
export WORLD_VLM_BASE_URL=http://127.0.0.1:11435/v1
export WORLD_VLM_MODEL=qwen3.8:27b
# Optional, only after checking the installed checkpoint:
export WORLD_VLM_REVISION=482ca0f3832238542f8f5295dde86b5f22711d80
```

`WORLD_VLM_API_KEY` is optional for a local server that requires it; it is never sent to the browser. The adapter accepts loopback HTTP only and has no proxy, redirect, retry or hosted-provider fallback. MP4/MOV decoding supports the bounded Arena software H.264, HEVC, MPEG-4 and libdav1d AV1 decoders. Synthetic 8-bit SDR HEVC passed exact-timestamp and native pixel-limit tests on Mac and GB10 CPU; HDR, display orientation and physical-phone behavior remain unqualified. WebM observation inputs require prior compatible conversion; they are not silently transcoded with invented source timestamps. Remote worker upload consent remains separate from local depth-model download consent.

Adapters receive bounded local files and write a validated manifest. They cannot accept browser-supplied executable commands or arbitrary output paths. API outputs keep `metric_verified:false`. The process boundary is not a complete host sandbox: run reviewed executables under a non-root service account with an external disk quota and resource limits. Never log short-lived download ticket URLs. Authentication supports legacy operator access and optional provisioned tenant credentials; it does not provide public account registration or qualified process isolation.

## Browser recording qualification

The capture controller owns each permission request and stream independently. Cancelling a pending request, clearing the session, leaving the page or hiding it prevents a late permission result from restarting capture. Recorder errors, empty output and the byte limit discard partial files. Normal stop, the 90-second limit and track interruption release the camera and retain a completed recording. The recorder selects MP4; browsers without native MP4 recording use the native-camera upload fallback instead of producing a worker-incompatible WebM recording.

Seven lifecycle contracts and HTTP Chromium/WebKit permission fixtures passed. Both browser engines also recorded an actual animated 128×96 canvas as H.264 MP4; independent PyAV decoding found seven frames with increasing original timestamps in each file. These are synthetic browser recordings, not camera or physical-phone evidence. Receipts are under ignored `output/playwright/world/capture/`. The regression entry point is `tests/world/capture_browser_smoke.py` and is included in hosted World checks.

The [generative qualification review](world-generative-qualification.md) records the Lyra 1 commercial-use candidate, Lyra 2 production restriction, checkpoint/dependency terms and unresolved GB10 port/resource gates. Neither Lyra version has run here.

## Full objective still open

These are release requirements, not optional polish:

1. Extend the successful bounded reference-photo and photograph-sequence GPU trials to actual indoor phone walkthroughs, establish reconstruction quality and qualify service scheduling. Qualify the chosen generative world model and checkpoint licenses separately. Lyra has not run here.
2. Build public signup/session verification and API-key issuance, qualified process/storage isolation, metered compute limits, durable object storage/queueing and billing authorization. Private API ownership checks and per-owner admission limits are implemented; public hosted processing remains disabled. On-device photo processing needs no account.
3. Test physical iPhone Safari camera permissions, recording/codecs, interruptions and upload fallback on real device captures. Phone-sized WebKit is not that evidence.
4. The geometry handoff from reconstructed camera/point evidence to a proposed floor/obstacle map now exists (see Real → sim above). A user-measured distance now rescales the proposal exactly (self-reported, recorded in the proof). Still open: checking the scale against a second independent measurement, denser geometry than sparse COLMAP (the GPU MapAnything output is the candidate), robot-specific motion constraints beyond a circular footprint, and validation of proposed obstacles against a measured site. Sparse visual points are not a substitute for collision surfaces.
5. Benchmark the connected video-language observation adapter on target captures, including omissions and incorrect labels. Frame/time provenance and human review are implemented; uncertainty text is not a calibrated confidence score. Qualify localization before enabling model-generated boxes. Extend supported phone codecs with preserved source timing before claiming broad capture compatibility.
6. Validate one measured gym with one cleaner, compare predicted clearances/routes/time against a supervised physical run, and calibrate editable operating assumptions. Current planning is conservative planar traversal, not robot dynamics, optimized cleaning or a learned policy.
7. Add authenticated report signatures and scenario evidence linkage. Current SHA-256 export detects byte changes and explicitly does not authenticate authorship.
8. Finish production privacy/retention/access checks, then verify the public app/API journeys and rollback. The preview is deployed from `main` and checked against the live site after each deploy, but public hosted processing is still disabled.

The original app remains at `/?classic=1`. Reverting the WorldHome selection in `src/App.tsx` restores the earlier homepage. Existing Arena and production credentials are preserved.
