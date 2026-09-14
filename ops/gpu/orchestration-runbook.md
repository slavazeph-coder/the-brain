# Private orchestration: local verification and coordinated cutover

This document describes a future operator action. This implementation session
does not deploy, push, stop remote processes, inspect production credentials,
or change host configuration. Local fixtures are not live GPU evidence.

## Components and ownership

The website's `src/server/orchestration.js` is the **only job scheduler** when
`ORCHESTRATION_ENABLED=1`. `/api/ops` accepts only the owner bearer credential;
`/api/orchestration-worker` accepts only its distinct worker bearer credential
and a stable worker ID. The existing GPU inference adapter selects this durable
transport in orchestration mode, including when configuration fails. It cannot
fall through to direct GPU access or the old memory broker. Disabled mode keeps
the existing application path. The homepage and deterministic comparison
contract remain intact. `/ops` exposes a sign-in screen, not public controls.
Its credential lives in page memory only; leaving/reloading/locking removes it.
Serve this page only over HTTPS, and do not place credentials in URLs.

The existing `ops/gpu/runtime.py` remains the sole GPU process supervisor.
The new outbound worker is its thread, not a daemon or additional watchdog.
Legacy `BRIDGE_COMMAND` and `BACKGROUND_COMMAND` must be empty when opting in.
Every gateway inference request requires both the existing service credential
and the current orchestration lease. A resident idle inference child can be
retained between successful inference jobs. Before video execution, the same
runtime drains and stops that owned child before starting Comfy. Only process
groups created by this runtime can be signalled. Occupied configured ports
cause refusal, never process takeover or a remote Comfy `/interrupt` request.

The runtime starts separately configured GPU generation and CPU decode children,
drains their output into its rotating private log, checkpoints stages, and
stores immutable content-addressed files. This avoids making process stderr
depend on an SSH session. There is no claim that it survives container deletion.

CrewAI is one agent, one sequential task, no tools/delegation, two maximum
iterations, and a hard 90-second subprocess bound. Its one allowed inference
endpoint is the authenticated local gateway. Evidence is an operator-supplied
packet; URLs are attribution and are never fetched. Read [crewai.md](crewai.md)
for the exact contract, isolated interpreter and pinned dependency gate.

## Durable store and physical fencing

Existing marketplace/brand-brain persistence uses Railway Postgres through
`psql`. It has no durable GPU job schema. This slice adds a separate SQLite
ledger without changing that database or migration/start commands. Node must
be **22.13 or newer**; validation used Node 22.22.2. Configure an absolute
`ORCHESTRATION_DB_PATH` in an existing, owner-private directory on a persistent
local volume and explicitly set `ORCHESTRATION_SINGLE_REPLICA=1`. The flag is an
operator assertion, not an automatic deployment check. Do not enable on an
ephemeral filesystem, network filesystem, multiple independent volumes, or
multiple Railway replicas. Horizontal scaling requires a future shared-store
implementation, not another scheduler beside this one.

SQLite transactions use `BEGIN IMMEDIATE`, `synchronous=FULL`, WAL, a unique
idempotency key, and a database constraint allowing only one active lease.
Lease generations fence stale writes. Expiry or loss of physical certainty
quarantines the GPU; expiry alone never permits another worker to run. A worker
can acknowledge full quiescence only after all owned processes are stopped.
Idle-resident acknowledgments and worker affinity are distinct from that
stronger assertion. Hardware loss remains latched until explicit owner
clearance even after worker reconciliation.

The storage choice follows [SQLite's WAL requirements](https://www.sqlite.org/wal.html):
all participants use the same host filesystem; `FULL` synchronization preserves
commits across power loss subject to the storage hardware honoring sync. Keep
the database, WAL and shared-memory sidecars together. Use an SQLite online
backup mechanism or a fully quiesced copy after the app closes its connection;
do not copy only a live `.sqlite` file. Runtime artifacts/checkpoints need an
independent durable backup, with hashes verified on restore. Retain old data
until an operator has verified the restored queue, artifacts and approvals.

States are `queued`, `generating`, `decoding`, `ready-for-review`, `failed`, and
`paused`. Video takes priority at the next job boundary. Transport failures
have at most three automatic attempts, contingent on a stopped worker;
checkpointed decode resumes using the generated artifact and exact workflow
hashes. Changed workflows or artifact tampering fail validation. NVML/CUDA/Xid
loss does not automatically retry. Manual job resume starts a new explicitly
authorized attempt budget and preserves its checkpoint. When the exact served
model is configured, pending website inference can trigger a separate durable
180-second warmup lease. A short public health timeout does not cancel that
internal job. Failed warmup remains held for explicit recovery; no warmup is
created without demand. Idle model retention defaults to 300 seconds. Cold or
video-busy requests can still return the existing deterministic fallback; only
a real completed backend request establishes reachability.

## Local validation

Run from the repository root. No production configuration is required:

```sh
node --test brainsnn-r3f-app/scripts/orchestration.test.mjs
python3 -m unittest discover -s ops/gpu/tests -p test_orchestration_worker.py -v
python3 -m unittest discover -s ops/gpu/tests -p test_crew_worker.py -v
node ops/gpu/test_orchestration_slice.mjs
python3 -m unittest discover -s ops/gpu -p test_evaluate_queue.py -v
```

The cross-language slice runs actual Node handlers, SQLite, the Python worker,
owned child process groups, workflow hashing, checkpoint resume and artifact
files. Its explicitly controlled adapters replace sockets, Comfy responses,
GPU health and OpenAI responses. They are test-only files, never selected by
an agent prompt or by production configuration. A valid fixture PNG proves
file handling, not a GPU render or human visual approval.

From `brainsnn-r3f-app/`:

```sh
npm ci --no-audit --no-fund
npm run lint
npm test
npm run build
npm run test:ops
npm run test:e2e
```

`test:ops` starts the compiled app with an isolated temporary database, synthetic
credentials, no inherited provider environment, dotenv loading disabled and a
loopback-only listener. Tests cover owner sign-in, durable submission, boundary
pause/resume, lock, storage exclusion, desktop/mobile layout, accessibility and
the existing deterministic comparison. It requires an installed Playwright
browser and local socket permission. The ordinary E2E config excludes these
specs because they need the isolated owner/worker setup.

If the execution environment prohibits socket binding, `npm run test:offline`
runs the existing application subset and prints each of the two omitted GPU
HTTP suites. It is explicitly partial; default `npm test` still runs everything.
Set `ORCHESTRATION_TEST_HTTP=1` on the scheduler test command to run the same
invariants over real HTTP on a machine where binding is permitted. Real
CrewAI integration requires the pinned package and the explicit test interpreter
described in `crewai.md`; a missing dependency is a failure/skip, never a result.

## Operator configuration and pinned render workflows

Use `brainsnn-r3f-app/.env.orchestration.example` and the new disabled entries in
`runtime.env.example` as the configuration inventory. Generate distinct owner,
orchestration-worker, gateway, backend and background credentials through the
operator's secret manager. The website needs only owner/worker credentials and
the exact served model name. The GPU runtime never receives the owner key.
Do not paste secrets into source, job payloads, reports or model prompts.

Set the outbound runtime URL to the verified website origin plus
`/api/orchestration-worker`; HTTPS is required. Its stable worker identity must
be 8–80 alphanumeric/underscore/hyphen characters, unique to this owned runtime.
Set `CREWAI_PYTHON` to the separate pinned environment, not the CUDA/vLLM venv.

Comfy commands are JSON argv arrays in operator configuration. Each executable
is absolute, the listen address is loopback, and GPU/CPU/backend/gateway ports
are distinct. Comfy CPU mode must use its `--cpu` option as well as the runtime's
empty `CUDA_VISIBLE_DEVICES`. Record the selected Comfy version (known context:
0.3.65), custom-node versions, model hashes, output node/key, command and workflow
hashes before use. No generic example graph can validate the real video model;
use the actual reviewed generation and decode API graphs.

`COMFY_WORKFLOW_MANIFEST` is an absolute local path with this shape:

```json
{
  "workflows": {
    "reviewed-clip": {
      "inputDirectory": "/operator/comfy/input",
      "generate": {
        "path": "/operator/workflows/generate.json",
        "sha256": "REPLACE_WITH_EXACT_FILE_SHA256",
        "outputNode": "42",
        "outputKey": "images",
        "mediaType": "application/octet-stream",
        "bindings": {"prompt": ["6", "text"], "seed": ["3", "seed"]}
      },
      "decode": {
        "path": "/operator/workflows/decode.json",
        "sha256": "REPLACE_WITH_EXACT_FILE_SHA256",
        "outputNode": "51",
        "outputKey": "gifs",
        "mediaType": "video/mp4",
        "bindings": {"input": ["50", "filename"]}
      }
    }
  }
}
```

Node IDs, fields and output keys are illustrative, not known-good video graphs.
The API accepts `{workflowId,prompt?,seed?}`, never a graph, URL or command.
Generation must expose a retrievable saved artifact. Decode must accept that
artifact by its exact `<sha256>.latent` filename in the reviewed input directory.
For the actual latent workflow, verify extension/format compatibility before
cutover. Artifact references are `sha256:<digest>`; the bytes are stored under
`<RUNTIME_DIR>/artifacts/<digest>`. Retrieve them through operator access and
verify the digest; the website does not expose private files publicly.

## Exact safe cutover sequence — separate future authorization

1. Coordinate ownership with the existing Codex recovery monitor and Hermes
   renderer watcher. Identify which operator owns each process and startup unit.
   Do not install a second watchdog or let a recovery monitor restart legacy
   inference while orchestration owns the GPU.
2. Let segment06 CPU decoding finish or obtain its owner's explicit checkpointed
   stop. Inventory and hash the six saved clips, all new artifacts, runtime
   configuration, reviewed workflow files and model manifests. Preserve
   `/workspace/slava`, model files and every existing artifact. Confirm a
   restorable off-container backup without copying secrets into task logs.
3. Complete the presently blocked package/real HTTP/browser tests. In an
   isolated GPU window, verify the actual pinned CrewAI package with the existing
   vLLM gateway and bounded source packet; verify one real generate/decode pair,
   review its quality, and record the exact hashes. Test long input, timeout,
   cancellation, transport recovery and host-loss safe stop without injecting
   destructive GPU faults. A render remains pending review.
4. Have the process owners stop their own legacy outbound bridge/background
   worker, existing GPU/CPU Comfy instances and recovery automation in the agreed
   order. Verify no inference/render/decoder remains active on the target GPU or
   configured ports. Preserve their old configuration and rollback commands.
   This code intentionally refuses to take them over.
5. Provision the website's persistent local volume and verify one replica and
   one active application process. Back up any existing orchestration ledger.
   Configure secrets and model identity and start the app while the worker stays
   stopped. Log in at `/ops` and pause the scheduler before starting any worker.
   Start only the updated existing runtime with the new worker settings and
   reviewed commands. Its startup lock, process ownership checks and any
   durable hardware/unclean-stop latch must pass before work is resumed.
6. Verify unauthenticated and swapped-key operations fail; log in at `/ops`.
   Resume the scheduler deliberately. Verify a real warmup/model list followed
   by a structured analysis. Then queue one video, confirm inference has drained
   before Comfy starts, and verify subsequent inference can resume. Inspect
   actual generation/decode checkpoints and hashes, plus pending review state.
   Record separate visual/outreach/publication/spend decisions if appropriate;
   none of them enables external execution.
7. Restart only the owned app/runtime during the agreed test window and verify
   durable queue recovery, stale fencing and checkpoint reuse. Separately have
   the host owner configure and test container startup/persistent mounts and
   outer restarts. An in-container supervisor or one successful smoke does not
   establish 24/7 uptime or 99% reliability. Resume the coordinated monitor only
   after its role is read-only or explicitly compatible with this single owner.

## Kill, hardware loss and recovery

`Pause after current job` prevents new claims while the active job reaches its
boundary. `Stop all work` revokes the lease and quarantines uncertain execution;
the next heartbeat/cancellation check stops the owned work. It is bounded
cooperative cancellation, not an instantaneous remote power switch. If the
host is unreachable, do not redispatch simply because the website lease expired.

On NVML/CUDA/Xid recurrence, retain both website and runtime holds. Obtain host
owner clearance and confirm all previously owned processes are actually gone.
Stop the owned runtime using the agreed service manager, then use its
`clear-orchestration-pause` action with `--config <private runtime.env>` after
checking the exact CLI help. The command requires the runtime lock, a healthy
GPU probe and quiescent configured ports. In `/ops`, record that evidence with
`Record verified clearance`, then resume the scheduler and the selected jobs.
Clearance does not itself constitute a render approval or model-quality proof.

## Rollback

Pause/kill the new scheduler and wait for worker acknowledgment. If uncertain,
leave it quarantined and have the owning operator verify/stop its process groups.
Stop the new owned runtime before re-enabling any legacy path. Back up the closed
SQLite ledger and runtime checkpoints/artifacts, preserving audit records.
Disable orchestration on the website and restore the previously reviewed runtime
configuration and app build. Restore exactly one former inference/bridge owner
only after the new owner is quiescent. Re-enable the previous renderer/watcher
only under its owner's coordination. Verify the old health and deterministic
fallback paths, artifact inventory, backup and monitor ownership. Do not delete
the new ledger, models, clips or `/workspace/slava` during rollback.

## Required GPU ownership attestation

Before enabling orchestration, the responsible operator must set
`GPU_OWNERSHIP_SCOPE=exclusive-container`, `GPU_OWNERSHIP_UUID` to the exact
single full-device UUID, and `GPU_OWNERSHIP_BASIS` to a nonsecret record (at least
20 characters) identifying operator/date and the evidence for exclusive device
allocation, stopped prior GPU users, and disabled competing startup/recovery
controllers. Include the host/provider allocation evidence or its record ID.
This is an explicit human assertion, not independently verified host evidence.
Do not set it based on an empty process listing inside a PID namespace.
Shared GPU/MIG allocations and uncertain host ownership are unsupported and
must remain held. No automatic attestation or pause clearance is performed.

At claim, launch, warm reuse and clearance, the runtime requires this scope,
matching single-device telemetry and a successful parseable `nvidia-smi pmon`
sample covering compute and graphics users. Unknown/invisible PIDs, foreign
process groups, malformed/unsupported telemetry and a missing basis fail closed.
An idle `-` row is accepted only within the explicitly attested scope. No foreign
process is signalled. Owned process groups must disappear after termination
before their tracking record is released. The attestation must be re-reviewed
when the allocation, container, startup services or process ownership changes.
The manual clearance command applies these same checks in addition to its
runtime lock and closed-port checks; update the earlier clearance description
accordingly. Local fixtures replace this physical gate explicitly and prove no
host ownership.

## Backup and restore verification

`BACKUP_COMMAND` remains a finite, supervised, timeout-bounded command in both
runtime modes. It receives `BRAINSNN_RUNTIME_DIR` and
`BRAINSNN_CHECKPOINT_DIR`; include **artifacts/** and **checkpoints/** explicitly
in its reviewed backup selection. It receives no service credentials from the
runtime. Backup exit status is visible in status.json; verify actual restore
contents, not only exit code. A local copy is not eviction-safe storage.

For a consistent recovery point, pause the scheduler, drain/stop its owned work,
stop the runtime and close the app database (or use SQLite's online backup API).
Record artifact filenames, sizes and SHA-256 values plus checkpoint hashes.
Copy the closed ledger and runtime artifacts/checkpoints to private independent
storage. In an isolated restore directory, restore both trees; compare the
inventory and hashes, load each checkpoint as JSON, and verify every generated
and rendered reference through `ArtifactStore.read`. Run SQLite
`PRAGMA integrity_check` and inspect queue/checkpoint/approval records before
starting anything. Keep the scheduler paused and require physical reconciliation
and renewed ownership evidence before resuming. Interrupted `.decode-*` staging
files can be removed only while the owned decoder is stopped; a retry publishes
from the immutable artifact and never overwrites a modified final latent file.
The local regression tests exercise artifact/checkpoint restoration only;
real off-container storage, ledger backup and disaster recovery remain cutover
gates requiring operator evidence.
