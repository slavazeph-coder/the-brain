# World Builder operational twin

The operational overlay connects existing compiler components to equipment knowledge. Open `/world/twin.html`, or open **Operational twin** under More in World Builder. A compiled metric scene also exposes the same inspector under Building model review, below its BIM downloads.

The workflow was informed by [Omer Shamay's Treedis TAI demonstration](https://www.linkedin.com/posts/omer-shamay-a73529146_we-gave-tai-a-scan-in-less-than-24-hours-ugcPost-7526265818083520512-1JcO/) and the [official TAI overview](https://docs.treedis.com/help-center/tai/overview). The post's crane reconstruction, counts and turnaround are company-reported results, not BrainSNN benchmarks. This implementation uses BrainSNN's own component graph and contains no Treedis code, machine assets or extracted manuals.

## Use your model

1. Compile a scene using a worker that emits `brainsnn.component-graph.v1`. Retain the original `scene.json`, capture/cloud evidence, measurements and exports. The layer requires a metric scene and stable component IDs. An arbitrary-unit reconstruction must be scaled and reviewed through the existing workflow first.
2. Open that scene in World Builder, or choose **Open your scene.json** in the standalone inspector. The standalone page hashes the exact file bytes. It does not upload the file.
3. Select a component in the list or proxy view. Record its display name, asset code, manufacturer, model, serial and location. These names do not overwrite source object labels. An assembly parent links non-floor object components; cycles are rejected.
4. Under **Sources & answers**, paste text from an approved source revision or read a local TXT/Markdown file. Enter the title, revision and optional HTTPS original URL. Link the document explicitly to each relevant component. A digest identifies the exact supplied text, not the authority of the author or the original PDF.
5. Ask a specific question such as `slew bearing inspection`. The local retriever returns exact four-line source windows, revision, line numbers and text digest. It abstains when its keyword coverage criterion is unmet. It does not synthesize maintenance instructions or verify a diagnosis. Keyword matches can still be irrelevant; inspect the cited passage and the original approved source.
6. Under **Parts & issues**, add spare part numbers with quantity, a linked document and a page/section/line locator. Record operator observations and explicit dependency links. A dependency trace reports those links and issue counts; it does not infer a fault's cause. Resolving an issue records an operator action.
7. Under **Motion**, enter a revolute or prismatic joint, a rest-world axis/pivot, limits and the home value corresponding to the source geometry. Sliders transform that component and its assembly descendants. Joint values are for inspection and are not written back into the BIM or robot map.
8. **Export overlay JSON** to retain the records. **Asset register CSV** carries the same component IDs and spare references. Work is local to the current session; reload, scene replacement or closing the page can discard unexported records. To resume, reopen the exact original scene and import its overlay.

## Contract and integrations

`brainsnn.operational-twin.v1` records bind to all of the following: exact `scene.json` byte SHA-256, component source SHA-256, content SHA-256, revision, metres and the right-handed Y-up frame. A different serialization of the same JSON has different bytes and is intentionally rejected. A changed capture or geometry revision requires an explicit new review and overlay; there is no fuzzy transfer by a similar object name.

Limits: 2 MiB per overlay, 1,024 scene components, 64 documents, 60,000 characters per document, 64 joints, 256 issue records, 64 spare records per component. Document text hashes are checked on import and export. Duplicate asset codes, dangling references, cycles, unsafe source URL schemes, nonfinite numbers, inconsistent units and out-of-range joint values fail validation. CSV formula-leading text is escaped. Document content is inert data and is never executed as code or instructions.

| Destination | Join key | What this version carries |
| --- | --- | --- |
| IFC | `Pset_BrainSNN.ComponentId` | Match overlay/register records to the existing IFC elements. Original IFC bytes are unchanged. |
| Rhino 3DM | `componentId` object user string | Match the same source-scoped records. Original CAD geometry is unchanged. |
| BrainSNN scene / GLB / USD | Compiler `componentId` | Stable source identity. Joint preview stays in the JSON overlay; no dynamic USD articulation is authored. |
| Robotics | Original rest scene, separately reviewed map and routes | Equipment knowledge is supplemental context. Moving a preview does not update a collision map or qualify a route. |

Validation flags remain false for metric accuracy, measured joints, physics and physical robot execution. The operational layer has no path to promote them. Spare and issue locators are entered by the operator; this version checks that a linked document and locator exist, not that a part number or observation is supported by that passage.

## Authored example and limitations

The included crane is seven authored machine boxes plus a floor, with three entered joints and one authored training document. Part numbers and the example issue are invented training data. It is not a scanned machine, a manufacturer manual, an automatically identified assembly or a real maintenance finding. Use it to test the UI and contract, never as reconstruction evidence.

Both WebGL and a software SVG proxy view use the same coordinate transforms. These are component boxes, not a photoreal scan or exact mechanism surfaces. Openings without their own bounded proxy remain selectable records. The software view uses painter sorting and is not an occlusion or clearance solver.

This version does not implement automatic machine segmentation, document OCR/PDF parsing, language-model answers, CMMS/live sensor connectors, load ratings, mass/inertia, actuators, contacts, collision checks or automatic URDF/MJCF/USD articulation export. None of the source point fit or floor-alignment metrics establishes survey accuracy or mechanical correctness. User-entered scale remains user entered. Simulation routes remain separate from physical robot validation.

The highest-value next qualification is one real machine with owner-approved assembly labels, its approved manual, independently measured pivot/axis/limit references and at least three measured poses. Compare component IDs/source links, transformed landmark position error and limits against held-out measurements before exporting dynamics. Acceptance tolerance must be set for that machine and intended use. Access to the machine and its authoritative mechanical information is the main blocker.

## Run and verify

From the repository root:

```sh
cd brainsnn-r3f-app
npm ci --no-audit --no-fund
npm run build
NODE_ENV=production PORT=4180 node dist/server.cjs
```

Open `http://localhost:4180/world/twin.html`. The build assembles `twin-renderer.js` from the pinned existing Three.js dependency. The software view keeps the inspector usable without WebGL. No model download, paid API or GPU worker is required for this layer.

```sh
node --test tests/world/operational-twin.test.mjs tests/world/bim-workflow-ui.test.mjs
cd brainsnn-r3f-app
npm run test:world
npm run lint
cd ..
WORLD_BROWSERS=chromium,webkit python tests/world/operational_twin_browser_smoke.py
```

The browser test serves real HTTP and exercises local authored data: equipment edits, text sources and escaping, supported/unsupported retrieval, spare and issue records, motion pixel changes, JSON/CSV downloads, mismatched-revision rejection, the actual compiled-scene integration, pending-edit guards and disposal at desktop/phone widths. It does not run reconstruction, validate a real mechanism or move a robot. CI installs browsers and runs both Chromium and WebKit.
