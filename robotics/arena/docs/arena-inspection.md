# Inspect an Arena run

Arena keeps the paused mission and Run as its first screen. After a run, use **Inspect run** to open the recorded events. **Open recording** reads an existing local bundle without connecting to a worker. The inspector cannot send control commands.

## What is being inspected

The native recorder captures the worker interface: both lossless policy-input camera images, observation state and prompt, inference attempts and returned action chunks, the vectors passed to the environment controller, subsequent simulator states, interventions, errors and task outcomes. Controller inputs are not measured motor torque. The recorded interface is before any additional internal policy transforms.

The policy episode starts after LIBERO's ten settling actions. Its post-settling state is retained separately from the suite's initial-state digest. Initialization coverage is declared. Simulation time and host monotonic nanoseconds remain separate; a 20 Hz simulation schedule does not promise 20 Hz wall-clock policy execution.

Selecting an event opens its evidence and related observation/inference/action. Imported LeRobot camera references retain actual decoded source PTS, timebase, episode offset and matching error. Dataset action columns remain dataset labels, not proof those actions reached a controller. Unsupported or missing information stays visible.

Recorded facts, deterministic rule findings, model hypotheses and human notes have separate origins. Rule findings identify recorded interventions, failed outcomes or missing evidence; they do not diagnose arbitrary visual causes. Known limitations remain next to the result. No learned video model, remote AI call or automatic factual judge is enabled by this release.

## Portable recording contract

The authoritative bundle contains exactly the manifest JSON text, its SHA256 and a map of base64 artifact bytes:

```json
{"schema":"brainsnn.arena.bundle.v1","manifestText":"{...}","manifestSha256":"<64 lowercase hex characters>","payloads":{"images/observation.png":"<base64>"}}
```

The manifest schema is `brainsnn.arena.recording.v1`. It binds source identity declarations, context, clocks, events, artifacts, findings, outcome and completeness. Each artifact descriptor carries its exact digest, byte length, media type and retention status. Array descriptors include shape, dtype and endianness. Event IDs link the observation, inference, chunk, chosen input and next state. The hash uses exact UTF-8 manifest bytes, avoiding Python/JavaScript float reserialization differences. Retain those bytes on round trip.

Import verifies bytes, schema, bounds and relationships before displaying data. It rejects ambiguous paths, duplicate IDs/JSON keys, unresolved references and cycles. Imported bundles are data: no remote artifact fetch, executable payload, worker command or arbitrary path extraction is permitted. A successful integrity check does not authenticate the producer or establish the truth of a conclusion.

Old `brainsnn.arena.evidence.v1` exports remain readable. Their preview metadata cannot reconstruct omitted policy images or full state. They are explicitly partial, with missing coverage, and scripted practice never becomes a named-model score.

Exports can contain prompts, camera images and source files. Inspect them before sharing. The website does not upload a local import. Worker endpoint credentials are not part of recordings. A redacted export has different bound contents and explicit omissions; its original source remains unchanged. Saved review notes bind to the exact manifest hash and become stale if attached to changed content.

## Worker storage and viewer access

See `.env.example` in `workers/arena` for the current defaults and ranges. Set `ARENA_RECORDING_DIR` to a persistent private volume outside the checkout and model cache. Recorded episodes survive live-session reset, deletion and TTL expiry, subject to the explicit archive retention limits. A website deployment does not provision or start this GPU worker.

The asynchronous writer copies input buffers before enqueueing them. It commits a contiguous sequence and writes the complete marker only after durable artifacts/events. Queue overflow, storage failure or interrupted finalization leaves a partial recording with gaps or an unknown tail. A full disk can prevent a gap-counter write too, so missing finalization never means no loss. Retention is bounded; export important episodes before expiry.

`ARENA_READ_TOKEN` is an optional distinct viewer secret of at least 32 characters. It can read capabilities and archived recordings but cannot create sessions, control them or delete them. `ARENA_TOKEN` retains existing operator access. Never put either token in Git, URLs, public environment variables or an exported case.

| Request | Purpose |
|---|---|
| `GET /v1/capabilities` | Discover recording support and bounds |
| `GET /v1/recordings` | List retained recordings; optional `sessionId` filter |
| `GET /v1/recordings/{id}` | Bound manifest and recording state |
| `GET /v1/recordings/{id}/events` | Recorded events |
| `GET /v1/recordings/{id}/artifacts/{artifactId}` | Original retained artifact |
| `GET /v1/recordings/{id}/bundle` | Portable recording bundle |

Archive reads do not depend on a live simulator session. Existing workers without the new capability fall back to their legacy incomplete evidence path. The browser distinguishes unavailable recordings from a successful empty recording.

## Compare recordings

Open a candidate, then load a reference recording. Compatibility checks cover task/judge revisions, environment, input/action semantics, units, preprocessing and initial state. Missing declarations are unknown; different declarations are displayed. Matching selected model names alone is insufficient.

The comparison locates observed differences and links the corresponding source events. It does not prove that one difference caused an outcome. A pair of episodes is a case comparison, not a reliability estimate. Repeat stochastic conditions and report episode-level uncertainty before making a performance claim. Fresh-inference branching is not supported because the recording does not promise full policy RNG/controller restoration.

## Optional local LeRobot and MCAP tools

These tools operate on local files only. Install their isolated optional dependencies using a Python version supported by `inspection/requirements.txt`; they are not required to run the website or the existing policy worker:

```bash
cd robotics/arena
python3 -m venv /path/to/inspection-venv
/path/to/inspection-venv/bin/python -m pip install -r inspection/requirements.txt
/path/to/inspection-venv/bin/python -m inspection.interop lerobot /path/to/dataset --episode 3 --out /path/to/episode.json
/path/to/inspection-venv/bin/python -m inspection.interop verify /path/to/episode.json
/path/to/inspection-venv/bin/python -m inspection.interop export-mcap /path/to/episode.json --out /path/to/episode.mcap
/path/to/inspection-venv/bin/python -m inspection.interop import-mcap /path/to/episode.mcap --out /path/to/imported.json
```

Then open the JSON bundle in Arena. Outputs require new paths; existing files are not overwritten.

The LeRobot v3.0 adapter reads metadata offsets and selects one episode from shared Parquet/MP4 shards. It preserves original files where bounded export allows, otherwise retains their full digest and an explicit omission. Source files remain untouched. At most 512 frames and eight video camera streams are supported; split larger recordings upstream. An original source is at most 512 MiB, and the converter caps included bytes at 32 MiB. Video frames use actual PTS and remain inside the selected episode; unavailable matches are gaps. RGB video and low-dimensional row data are supported; this is not a universal loader for every custom feature or depth encoding.

MCAP export carries indexed JSON event messages plus bound manifest and original retained artifacts. Native round trip checks both message content/timing and the manifest. Generic import preserves log/publish nanoseconds as strings, source schemas/channel metadata in the original file, JSON messages and opaque original bytes. It does not decode ROS CDR into an inferred robot state.

MCAP input is limited to 48 MiB and 4,000 messages. Compressed chunks are explicitly refused because the SDK does not provide a portable hard decompression bound for untrusted files; decompress a trusted bounded log with your existing tools first. Unknown synchronization stays unknown. No Foxglove account or Rerun download is required. Rerun embedding remains an optional follow-up if the native viewer becomes the bottleneck.

## Validation and deployment boundary

Tests use injected worker doubles and real locally encoded Parquet/MP4/MCAP fixtures. They check frame/episode offsets, reference integrity, tampering, archive lifecycle, read-only authorization and browser compatibility. They do not execute π0.5, prove CUDA/EGL works, or establish physical-robot performance.

The extracted worker kit includes the browser recording validator for cross-language checks. Run tests from the kit root with Node 22 available and the API test dependencies installed (`workers/arena/requirements-api.txt` plus `httpx==0.28.1`): `python -m unittest discover -s tests -p 'test_arena*.py'`. Run the optional interchange tests in a separate environment with `inspection/requirements.txt`: `python -m unittest discover -s tests -p 'test_inspection_interop.py'`.

Deploy the website through the existing main-branch Railway workflow. The downloadable worker kit includes the recorder, schemas, offline tools and tests. Updating an existing GPU worker requires its authenticated host access, persistent archive volume and real policy validation in `rtx4090-handoff.md`. Keep existing inference services running. No paid GPU or physical-robot action is triggered by opening inspection.
