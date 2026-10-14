# BrainSNN Arena runtime protocol v1

The static Arena UI connects to an independently hosted, server-authoritative physics and policy worker. A catalog entry, external body viewer or local illustrative renderer is not evidence that a named policy ran. Only an accepted worker frame can provide policy execution evidence and measured results. The checked-in Python worker is an integration scaffold with real LIBERO/OpenPI code paths; deployed access and an end-to-end checkpoint run are separate requirements.

## Browser API

Load `arena-profiles.js` before `arena-runtime.js` and the workspace consumer.

```js
const recipe = BrainSNNArenaProfiles.findForSelection({robotId:'panda', modelId:'pi05'});
const client = BrainSNNRuntime.createClient({
  onState: state => renderState(state),
  onFrame: frame => showAuthoritativeFrame(frame),
  onError: error => showError(error.message)
});
await client.connect({
  url: 'https://your-worker.example', token: inputToken,
  selection: {robotId:'panda', modelId:'pi05', task:'libero_spatial:0', seed:42, protocol:'practice'}
});
// Populate tasks from client.getState().profile.tasks, then create the chosen session.
await client.start({robotId:'panda', modelId:'pi05', task:'libero_spatial:0', seed:42, protocol:'practice'});
await client.command('run');
await client.command('pause');
await client.disconnect();
```

`connect` checks capabilities. `start` creates and observes a session without silently executing a policy. `run`, `step`, `reset`, `intervene` and `branch` execute only when advertised by the exact worker profile. `disconnect` aborts work, clears the token and attempts authenticated session deletion. The returned promises resolve to current state; an operational error is represented by `state.error` and `onError`, rather than an unhandled rejection. A missing browser fetch API is a constructor error.

State contains `status`, `message`, `profile`, `capabilities`, `sessionId`, `selection`, `lastFrame` and `error`. Status progresses through `disconnected`, `connecting`, `connected`, `creating`, and worker states `ready`, `running`, `paused`, `succeeded`, `failed`, `error`. A connected profile with `ready:false` offers its specific setup reason. The recipe registry never marks a model as installed.

Tokens live only in the client's closure and HTTP Authorization headers. They are never included in exported state, localStorage or URLs. Use HTTPS; only localhost, 127.0.0.1 and IPv6 loopback allow HTTP for development. The browser refuses redirects, URL credentials, query strings and fragments, sends no cookies, and requires CORS permission from the worker. A localhost HTTP worker can still be blocked by browser mixed-content/private-network rules when the website uses HTTPS; an HTTPS tunnel or properly deployed worker resolves this without weakening client transport rules.

## HTTP surface

Every successful JSON response has numeric `version:1`. Errors should use `{version:1,error:{code,message}}` with an appropriate HTTP status. Standard Bearer authentication applies to every request, including cleanup. Frames have a 16 MiB JSON limit. Worker deployment must enforce its own request/body/resource limits and an idle session TTL; interrupted browser/network requests cannot guarantee a remote session has closed.

| Method/path | Request | Response |
| --- | --- | --- |
| GET `/v1/capabilities` | None | `{version:1,server:{name,version},profiles:[profile]}` |
| POST `/v1/sessions` | `{version:1,profileId,robotId,modelId,checkpoint,task,seed,protocol}` | `{version:1,sessionId,profileId,robotId,modelId,checkpoint,status,profile,frame?}` |
| GET `/v1/sessions/:id/frame` | None | Authoritative frame |
| POST `/v1/sessions/:id/commands` | `{version:1,type,payload,requestId}` | `{version:1,sessionId,requestId,status,frame?}` |
| DELETE `/v1/sessions/:id` | None | `{version:1,closed:true}` |

Encode session identifiers in URL paths. Commands must execute serially per worker session, with idempotent request-ID acknowledgement. A disconnected client stops polling and ignores old observations. Reset cancels pending browser requests and queued commands; worker serialization must also prevent a previous request from mutating the environment after reset completes. The supplied worker provides one serialized session actor.

The client uses a 20-second per-request deadline, a 100-second session-start deadline for the worker’s bounded 90-second renderer/policy initialization, and approximately 180 ms running-frame polling. This transport rate is not a policy/control frequency. Rendering and polling must never define simulator physics time. Native stepped evaluation pauses physics during inference and is distinct from real-time deployment stress testing.

## Exact runnable profile

Example for the native OpenPI route, abbreviated only in the task list:

```json
{
  "id": "panda-pi05-libero",
  "robotId": "panda",
  "modelId": "pi05",
  "checkpoint": "gs://openpi-assets/checkpoints/pi05_libero/",
  "checkpointRevision": "sha256:<verified-checkpoint-manifest>",
  "adapter": "openpi-libero",
  "ready": true,
  "reason": "",
  "simulator": {"name":"LIBERO","id":"libero","version":"<pinned-commit>","engine":"mujoco","engineVersion":"<installed-version>"},
  "cameras": [
    {"id":"agentview","role":"policy","width":224,"height":224,"sourceWidth":256,"sourceHeight":256,"rotation":180},
    {"id":"wrist","role":"policy","width":224,"height":224,"sourceWidth":256,"sourceHeight":256,"rotation":180}
  ],
  "state": {"size":8},
  "action": {"size":7,"space":"cartesian-delta-gripper","controller":"OSC_POSE"},
  "timing": {"controlHz":20,"actionChunkSteps":5},
  "tasks": [{"id":"libero_spatial:0","label":"LIBERO Spatial · task 1"}],
  "protocols": ["practice","benchmark"],
  "commands": ["run","pause","step","reset","intervene"]
}
```

A ready profile must declare checkpoint/revision, simulator identity/version, observation dimensions, action space/controller, cameras and their processing, supported tasks/protocols/commands. Known recipe IDs cannot be reused with a different body, model, adapter, checkpoint, action contract, camera processing or timing. Session creation must echo the exact capability contract, including timing and optional adapter/policy code revisions. A registered recipe with no task-adapted checkpoint is guidance only; it does not authorize a general base model to run.

A worker may offer a new exact profile that is absent from the local recipe registry. Complete, validated backend profiles are permitted. If multiple profiles match a body/model, supply `selection.profileId`; the client will not silently pick one. Selected task IDs come from the worker, not arbitrary catalog task prose. Seeds must be nonnegative 32-bit signed integers. The `protocol` field is either `practice` or `benchmark`.

Current recipe distinctions:

| Profile | Meaning |
| --- | --- |
| `panda-pi05-libero` | Native OpenPI `pi05_libero`, processed 224² agentview/wrist, 8 state features, 7 Cartesian/gripper actions, 5-action replanning. |
| `panda-molmoact2-libero` | `allenai/MolmoAct2-LIBERO-LeRobot`, its own saved processor/statistics and 10-action chunk route. Requires a dedicated adapter; never loaded by OpenPI. |
| `g1-sonic` | G1 plus learned SONIC joint controller; setup required, not an LLM and not an external viewer claim. |
| `g1-groot-sonic` | A task-finetuned `UNITREE_G1_SONIC` GR00T policy plus a matching SONIC controller; no universal checkpoint assigned. |
| `so101-act`, `so101-smolvla` | Task-adapted checkpoints, environment/camera processing and calibrated action units are required. |

## Observations and evidence

```json
{
  "version": 1,
  "sessionId": "session-123",
  "profileId": "panda-pi05-libero",
  "seq": 42,
  "status": "running",
  "simTime": 1.25,
  "policyExecuted": true,
  "cameras": [
    {"id":"spectator","role":"spectator","url":"data:image/jpeg;base64,..."},
    {"id":"agentview","role":"policy","url":"data:image/jpeg;base64,..."},
    {"id":"wrist","role":"policy","url":"data:image/jpeg;base64,..."}
  ],
  "bodies": [{"id":"robot","position":[0,0,0],"quaternion":[1,0,0,0]}],
  "metrics": {"steps":25,"success":false,"inferenceCount":5,"inferenceLatencyMs":162},
  "events": []
}
```

Sequence numbers increase monotonically within the session, including reset. Frames for another session/profile and stale sequences cannot reach the viewer. Each image role is explicit. The spectator view may orbit independently; the policy images must remain the actual processed sensor inputs with their fixed checkpoint semantics. Policy-camera IDs must match the capability contract. A `policyExecuted:true` frame must include all declared policy camera views. Optional physics body transforms are renderer inputs; animated UI illustrations cannot generate worker metrics.

The UI should show only reported metrics and explain their units. No inferred success, fabricated latency, arbitrary intelligence score or simulated billing value is permitted. Benchmark mode disables unscheduled interventions and branching in both the client and worker. Practice occlusion, when supported, uses `{type:'intervene',payload:{kind:'camera-occlusion',enabled:true,fraction:0.35}}` and must alter the actual policy observation. A frame timeline is observation review; full causal rewind requires a backend `branch` capability with saved physics/controller/policy/RNG/action-queue state. The shipped OpenPI worker does not advertise that capability.

## Verification

Run `node tests/arena-runtime.test.cjs`. These network-mocked tests check exact tuple preservation, arbitrary complete profiles, validation failures, malformed responses, deadlines, command serialization, benchmark lock, stale/out-of-order frames, selection/reset races, late creation cleanup, session mismatch cleanup and token redaction. They do not demonstrate actual GPU inference or render quality. Run the Python worker tests separately and perform the documented real dependency/checkpoint smoke run before claiming live model support.
