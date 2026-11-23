# Scan project workbench

The World Builder scan project workbench groups registered scans into projects and runs them through the existing `scene-usd` worker. Its board keeps a separate source, processing job, output manifest and human review record for each scan. The native layer ID is `bimworkbench`.

The product reference was the Moving Atoms scan-to-BIM project workflow shared in [Ahmad Saroya’s LinkedIn post](https://www.linkedin.com/posts/ahmad-saroya-a05400237_one-of-the-most-common-questions-i-get-asked-ugcPost-7530380311721963520-b7_7/). The implementation adopts batch intake, visible project state and reviewed handoff. It does not adopt the post’s delivery-time or capacity claims. Its concurrency is limited by the actual connected worker and account.

## Use it

1. Create a project such as “North building · level 1”.
2. Add one or more already registered xyz/rgb PLY scans, or prepared survey `arena-cloud.json` files. Declare each PLY’s units and up axis, then confirm registration. Each file becomes a separate processing job; adding files does not merge scan stations.
3. Connect processing using the World Builder’s existing connection panel. The access token remains in that session’s memory.
4. Agree to send the scan clouds, choose one to three concurrent jobs, and start the queue. The actual capacity is the smallest of the requested value, three, the worker’s `limits.concurrent_jobs`, and the account’s `owner_limits.active_jobs`. The current reference worker advertises one.
5. Open a completed model in the existing scene reviewer. Inspect scale, coverage, classifications and required exported files. Save the named reviewer’s checklist and notes.
6. Download the files that the worker actually produced. Save the full project manifest locally, or add the selected project’s bounded metadata summary to **Saved projects**, where the user chooses a workspace that can also retain robot trial reports.

The workbench shows IFC, DXF, 3DM, visual scenes, drawings, measurement reports and other files only when their names, sizes and SHA-256 hashes are present in an actual completed worker manifest. IFC can be opened or linked in Revit. This workflow does not produce a native RVT file.

## Supported inputs and preparation

| Input | Path | Limits and meaning |
|---|---|---|
| Registered PLY | Browser parser, then `cloud` upload | 64 MiB binary or 16 MiB ASCII; at most 50,000 retained points; finite bounded xyz/rgb values |
| Prepared survey JSON | Validate locally, then `cloud` upload | 16 MiB; 1–50,000 points; right-handed Y-up coordinates in metres |
| Large PLY, LAS, LAZ, E57 | Existing `survey_cloud.py` command, then add its JSON | Scanner conversion dependencies are installed with the worker; this path can voxel-thin larger inputs |

For a large registered scan:

```bash
python robotics/world_worker/survey_cloud.py \
  --input /path/to/registered-scan.e57 \
  --out /path/to/prepared-scan \
  --up z
```

Then add `/path/to/prepared-scan/arena-cloud.json` to the project. See [laser scan input](world-laser-scan-input.md) for format and preparation details.

Browser PLY preparation uses the existing bounded PLY parser and source-index sampling, performs the declared Z-up to Y-up transform when necessary, and uses `toArenaCloud` for floor alignment and conservative framing. It composes the axis conversion into `fromSource` and records the point count, sampling step, skipped nonfinite samples and floor/framing provenance. The complete original file stays in local source storage. Only the prepared cloud is uploaded.

The browser PLY parser uses float32 coordinates before unit conversion. Before accepting the scan, preparation calculates the worst representable spacing of its retained coordinates after the declared unit conversion. It rejects spacing above **1 mm**, with a source-specific message directing the user to `survey_cloud.py` and prepared JSON. For example, metre-based UTM coordinates near 500,000 m have 31.25 mm float32 spacing and are rejected. A 1,000,000 mm local coordinate has 0.0625 mm spacing and passes this numeric precision gate. The accepted spacing is recorded as `provenance.float32SpacingMetres`. This is a browser preparation limit, not a survey or model accuracy claim. Prepare large georeferenced datasets with the scanner CLI and import its JSON, and check output dimensions against independent survey control.

The source and prepared cloud receive separate SHA-256 digests. The output cloud carries the same contract emitted by the existing scanner CLI:

```json
{
  "version": 1,
  "kind": "survey-scan-point-cloud",
  "coordinateFrame": "right-handed-y-up",
  "sourceFrame": "survey-scan",
  "units": "m",
  "scale": {
    "source": "scan-file",
    "metresPerUnit": 1,
    "distance": null,
    "spanUnits": null,
    "selfReported": true,
    "verified": false
  }
}
```

`points` contains bounded six-number xyz/rgb rows. No `multiView` camera claim is added. The worker validates the paired survey kind/frame, metric units and declared scan scale. Existing single-view reconstruction restrictions remain in place for reconstruction clouds. Registration and survey accuracy are user declarations; the workbench does not establish them.

## Queue and recovery

The scheduler uses `WorkerClient.upload`, `/v1/jobs`, `/start`, status polling and the existing cancellation endpoint. It does not invent workers, agents, progress stages, completion times or output artifacts. Upload percentages are actual acknowledged byte progress; compiler states come from worker responses.

Source files and project/job manifests commit together in IndexedDB. The bounded local board holds up to 16 projects, 48 scans and 256 MiB of source plus prepared files. No credential or signed download ticket is persisted. This is browser-local storage: clearing site data removes the saved sources; exported JSON manifests contain metadata rather than source blobs.

On reload, previously active jobs become **Resume needed**, or **Check submission** if the creation response was lost before a job ID was saved. No job is submitted or polled automatically. The user reconnects the original worker/account and explicitly resumes. A known job resumes by its original ID. A partial upload restores its saved upload identity into `WorkerClient` so the worker’s acknowledged offset controls which bytes remain.

Before sending a create request, the workbench records the uploaded cloud identity and a creation-pending marker. If the response is lost, it searches the owner’s recent worker jobs for the exact upload ID. It does not submit another job blindly. An absent or ambiguous match remains visible for operator reconciliation. A definite validation, authorization or quota refusal with an actual HTTP status becomes a retryable failed attempt. Transport loss, timeouts and server errors remain uncertain.

**Pause new jobs** stops new submissions and leaves submitted jobs running. Moving to another World Builder tool has no effect on the authorized queue. **Cancel job** cancels its actual remote job and waits for a terminal worker response. An unconfirmed cancellation retains its remote identity and pending flag. Clearing the board refuses to discard unresolved remote work. Retrying a confirmed failed or cancelled job preserves the previous attempt record and starts a new upload identity.

If observation of a submitted job is lost, new submissions pause because that job may still occupy worker capacity. Resuming prioritizes existing remote jobs before fresh uploads. An unconfirmed creation must be reconciled before the queue can restart.

## Review and shared project handoff

A review is available only for a completed worker result. It records the reviewer, notes and checks for independent dimensions, coverage/openings, classification and exported files. It becomes “reviewed” only after every check and a reviewer name are recorded. The record binds to the original source hash, prepared cloud hash, worker job ID and complete returned artifact set. Changed artifacts reset the review.

This is a human review record, not an automated quality certificate or verified survey. Use the existing model reviewer for geometry inspection and supported BIM edits. The current compiler primarily models floors, wall envelopes and object boxes; it does not promise a complete parametric MEP model or verified room quantities. The [BIM review](world-bim-review.md) and existing as-built workflow remain available through the opened model.

The **Saved projects** handoff is `brainsnn.bim-project-summary.v1`. It contains only the selected project’s source/prepared hashes, real worker job IDs/states, output hashes and review metadata. UTF-8 size is capped at 512 KiB. It excludes file blobs, worker credentials and ticket URLs. The `saveToProject` callback hands the summary to the shared chooser; the workbench itself does not select or mutate an external workspace.

## Integration

`bim-workbench-ui.mjs` exports `bimWorkbenchMarkup()` and:

```js
mountBimWorkbench({
  root,                    // or host
  getConnection,           // existing {client, caps}; credentials remain in memory
  rememberResult,          // shared workspace result registry
  connect,                 // open the existing processing connection panel
  status,
  onOpenResult,            // receives the remembered result context
  saveToProject,           // {name, content_text}; opens the shared Saved projects flow
  store                    // optional injectable persistence for tests
});
```

The returned API exposes `open`, `refresh`, `suspend`, `clear`, `dispose`, `getReport`, `getState` and `isActive`. `refresh` avoids unchanged DOM rebuilds; `suspend` is UI-only. `dispose` stops observation, persists recoverable remote IDs and does not pretend that closing a tab cancelled the worker.

Deploy the browser, worker and adapter from the same qualified revision. A compatible `scene-usd` entry must explicitly declare `dimension_checks: true`, `bim_review: true` and `registered_survey_cloud: true`. The supplied example, GB10 and Railway scene adapter entries include the new flag. Custom adapter configurations require the same explicit update after installing the corresponding code. A capability flag reports a configured contract, not proof of a successful run.

## Verification

```bash
node --test tests/world/bim-workbench.test.mjs tests/world/worker-client.test.mjs
python -m pytest tests/world/test_bim_workbench_handoff.py -q
node tests/world/bim-workbench-browser-smoke.mjs
```

The browser smoke test accepts `CHROMIUM_EXECUTABLE` and `BIM_SMOKE_OUTPUT`. It uses an explicitly labelled local HTTP worker fixture with the actual browser UI, `WorkerClient`, chunk uploads and IndexedDB. It verifies blob/hash preservation across reload, explicit resume, no duplicate submissions, continuing work across navigation, ticket downloads, saved review records, bounded shared-project handoff and mobile layout.

The Python suite tests survey contract admission, mixed/overclaimed source rejection, unchanged single-view reconstruction gating and explicit capabilities. When Blender is installed, it also runs the actual scene adapter through authenticated upload/create/start/poll/ticket endpoints on an authored 5,053-point room. The local acceptance run used Blender 4.3.2, produced IFC4 with four walls plus GLB, USDA, DXF, drawings and evidence files, and verified downloaded IFC/DXF hashes. Rhino3DM was unavailable in that environment, so no 3DM output was offered. This proves execution on that authored fixture; it does not measure reconstruction quality on a user survey or the availability of a deployed production worker.
