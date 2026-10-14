# BrainSNN authoritative LIBERO worker

This worker joins the browser arena to real LIBERO physics and a real, separately hosted OpenPI π0.5 LIBERO policy. The static site cannot run the Python/CUDA model. No GPU worker is provisioned or billed by connecting this source kit. Start the services on a machine you own or a separately provisioned cloud machine, then connect its HTTPS URL and access token in the arena.

The implementation supports **Panda + native OpenPI π0.5 LIBERO**. MolmoAct2, SO101, and G1 still need their own validated worker adapters. A catalog entry or matching number of action dimensions does not make a checkpoint compatible. The worker never reports an unavailable profile as executable.

## What the loop actually does

1. Load the pinned LIBERO Spatial task, its BDDL, asset files, and suite-provided initial state. `seed % number_of_initial_states` selects the initial state; the same seed is applied to the simulator. The initial-state ID and hash are exported.
2. Construct `OffScreenRenderEnv` with the Panda and native `OSC_POSE` controller at 20 Hz. Reset and apply ten native settling actions.
3. Read `agentview_image`, `robot0_eye_in_hand_image`, end-effector position/orientation, and both gripper joint positions from that environment.
4. Rotate both camera images by 180 degrees and pad/resize 256 × 256 to 224 × 224 with OpenPI's image tools. Convert the quaternion to an axis-angle vector, giving eight state features.
5. Send the actual observation and task instruction to the verified OpenPI WebSocket server. Consume **five** actions per inference chunk, matching the native OpenPI LIBERO evaluator's default. This is not the separate LeRobot ten-step protocol.
6. Apply each seven-dimensional action through `env.step`. The native controller handles input clipping/scaling. Read success from LIBERO's `check_success`, not a visual heuristic or invented score.
7. Stream actual rendered images, body transforms, simulator time, task outcome, action queue, measured policy latency, and event evidence to the browser. All physics/rendering operations execute in one isolated owner process.

The timing protocol is **stepped evaluation**: physics waits for inference. The wall clock, simulation clock, and measured inference latency are separate. This worker does not claim real-time deployment deadlines or fleet-scale throughput.

The spectator camera is a distinct `frontview` render. The two policy images display the exact most recent inputs consumed by inference, with a `capturedStep` marker. Before the first inference they are labelled unconsumed. Browser camera movement does not change those sensor images.

Practice supports one real intervention: a centre-band occlusion of the agent-view policy sensor. It modifies the actual observation sent to OpenPI, clears pending actions so the next tick reobserves the change, and logs the perturbation. Benchmark mode rejects it. Object dragging, arbitrary physical pushes, exact RNG-preserving branches, batch orchestration, and GPU billing are not implemented in this worker.

## Pinned profile

| Component | Identity |
| --- | --- |
| Profile | `panda-pi05-libero` |
| Policy checkpoint origin | `gs://openpi-assets/checkpoints/pi05_libero/` |
| OpenPI config | `pi05_libero` |
| OpenPI code/client | `215abfb217dbac7d5f1273282331b9b1866c0479` |
| LIBERO source | `8f1084e3132a39270c3a13ebe37270a43ece2a01` |
| MuJoCo / robosuite | `3.2.3` / `1.4.1` |
| Camera contract | Two policy cameras, 224 × 224 processed, 256 × 256 native, 180° rotation |
| State / action | 8 state values / 7 Cartesian delta + gripper actions |
| Control / inference | 20 Hz simulated control, five consumed actions per chunk |
| Episode | 10 settling ticks, up to 220 policy ticks, Spatial tasks `libero_spatial:0` through `:9` |
| Weight revision | SHA-256 of a complete local checkpoint-file manifest, validated before model loading |

The published checkpoint URL alone is mutable. The manifest pins the bytes you downloaded. It establishes content identity, not an independent claim that those bytes were authored by Physical Intelligence. Obtain the model from the official source and retain the manifest with your experiment.

## Deployment layout

Use one OpenPI policy process and one arena physics worker. They can share a suitable GPU machine. Keep the policy port on loopback or a private network. Expose only the arena HTTP service through a TLS reverse proxy. The browser-facing worker requires a token and an exact CORS origin. Do not expose the native OpenPI port to the public internet; its default server is not the browser authentication boundary.

Commands below run from `robotics/arena` in [slavazeph-coder/the-brain](https://github.com/slavazeph-coder/the-brain), or from the extracted worker kit root. Replace `/srv/brainsnn-arena` with that absolute **kit directory** in your deployment. Read [the RTX 4090 handoff](https://github.com/slavazeph-coder/the-brain/blob/main/robotics/arena/docs/rtx4090-handoff.md) before installing on the existing BrainSNN GPU host. Use a Linux NVIDIA machine with a compatible driver, NVIDIA Container Toolkit, and enough memory for the actual checkpoint plus rendering. Hardware throughput and combined GPU memory have not been measured by this implementation. Keep the existing `ops/gpu` text service, environment, driver and ports intact. This worker uses separate loopback ports 8010 (policy) and 8081 (physics); verify they are free before launch. Docker is an optional host deployment route, not a requirement to install Docker inside an existing Vast container.

### 1. Install the pinned model server environment

Install `uv` using its official installation instructions, then create the upstream environment on the GPU host:

```bash
git clone https://github.com/Physical-Intelligence/openpi.git /opt/brainsnn-openpi
git -C /opt/brainsnn-openpi checkout 215abfb217dbac7d5f1273282331b9b1866c0479
git -C /opt/brainsnn-openpi submodule update --init --recursive
cd /opt/brainsnn-openpi
GIT_LFS_SKIP_SMUDGE=1 uv sync
GIT_LFS_SKIP_SMUDGE=1 uv pip install -e .
```

Obtain the official `pi05_libero` checkpoint with the upstream downloader. It prints the local checkpoint directory:

```bash
uv run python -c "from openpi.shared import download; print(download.maybe_download('gs://openpi-assets/checkpoints/pi05_libero'))"
```

Copy that directory, including all processor/normalization files, to `/models/pi05_libero`. Keep the model directory read-only while serving. Create the manifest outside the model directory:

```bash
python /srv/brainsnn-arena/workers/arena/checkpoint_manifest.py \
  --checkpoint /models/pi05_libero \
  --output /models/pi05_libero.manifest.json
```

Record the printed `sha256:...` value in the worker's `ARENA_CHECKPOINT_REVISION`. Start the verified policy wrapper from the OpenPI environment:

```bash
XLA_PYTHON_CLIENT_PREALLOCATE=false uv run python /srv/brainsnn-arena/workers/arena/serve_openpi.py \
  --checkpoint /models/pi05_libero \
  --manifest /models/pi05_libero.manifest.json \
  --host 127.0.0.1 --port 8010
```

The wrapper hashes all files again, rejects changed bytes and the wrong OpenPI source revision, loads the fixed `pi05_libero` config, and includes the checkpoint identity in OpenPI's initial metadata. The physics worker checks every identity field before accepting the policy. A generic OpenPI server without this attestation is rejected with an explanation. The wrapper requires a working JAX GPU, disables JAX preallocation by default, and performs one synthetic inference before opening its port. This moves initial compilation outside the live 20-second inference deadline. Warm-up is not an environment validation or an episode; it advances policy RNG, and upstream `reset()` does not restore that RNG. Neither disabled preallocation nor a successful warm-up guarantees sufficient shared GPU headroom or a 20-second response under production load. Measure both before exposing the service.

### 2. Build and start the physics worker

Return to `robotics/arena` or the extracted kit root:

```bash
docker build -f workers/arena/Dockerfile -t brainsnn-libero-worker .
cp workers/arena/.env.example .env.arena
```

Generate a secret with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Edit `.env.arena` on the deployment host and set:

```dotenv
ARENA_TOKEN=<your-generated-secret>
ARENA_ALLOWED_ORIGINS=https://www.brainsnn.com,https://brainsnn.com
ARENA_POLICY_URL=ws://127.0.0.1:8010
ARENA_CHECKPOINT_REVISION=sha256:<the-verified-manifest-digest>
ARENA_SESSION_TTL=900
ARENA_IDLE_TTL=120
```

Set `.env.arena` permissions to `0600`. Do not commit the real `.env.arena` or paste its token into reports. These are two exact origins, without path or trailing slash. Add a preview origin only when explicitly needed; never use `*`. On a Linux GPU host, host networking lets the physics container reach the policy on loopback:

```bash
docker run --rm --name brainsnn-libero --gpus all --network host \
  --env-file .env.arena brainsnn-libero-worker
```

The host-network container listens on **127.0.0.1:8081**, with NVIDIA graphics capability enabled for EGL. Terminate TLS at an operator-controlled reverse proxy and configure its request-body limit to 64 KiB and startup request timeout to at least 100 seconds. Keep port 8081 private to the proxy. For a different container-network arrangement, configure its listener and private proxy route explicitly; publishing a Docker port alone does not change the loopback listener. Configure the proxy to pass the `Authorization` and `Origin` headers. Use an HTTPS endpoint in the published arena; a browser will block HTTP mixed content from an HTTPS page.

This same layout can run on a separately rented Vast machine. Provisioning, GPU choice, hourly cost, storage billing, process supervision, and shutdown remain operator responsibilities. The source kit does not create provider accounts or purchase compute.

### 3. Connect from the arena

Choose **Panda → π0.5 LIBERO**, open **Connect worker**, enter the worker's HTTPS base URL and token, then connect. Capabilities verify installed package pins and the policy metadata. The session-creation request additionally initializes the real task and EGL renderer. If either fails, the UI reports a concrete error; it does not switch to a demonstration controller.

Create a practice session and step once before running an episode. A frame should show `policyExecuted: true`, one policy step, authoritative simulator time, nonzero inference count, and both policy camera inputs. Test pause, reset, a sensor occlusion, and evidence export. Then run a benchmark session and confirm that interventions are blocked. Confirm task-success outcomes against the upstream evaluator before presenting performance comparisons.

## HTTP contract

Every endpoint requires `Authorization: Bearer <ARENA_TOKEN>`. A request with an `Origin` header must match the configured origin exactly. JSON request bodies are bounded to 64 KiB before parsing, including chunked input.

| Request | Result |
| --- | --- |
| `GET /v1/capabilities` | Exact profile, readiness/reason, source/checkpoint/controller/camera/timing contract and session limits |
| `POST /v1/sessions` | A paused/ready session, exact mirrored profile, initial non-policy frame |
| `GET /v1/sessions/{id}/frame` | Authoritative current frame and last-consumed policy images |
| `POST /v1/sessions/{id}/commands` | Run, pause, one control tick, reset or supported practice intervention |
| `GET /v1/sessions/{id}/evidence` | Current episode's actions, flattened simulator states, state hashes, interventions, profile and measured metrics |
| `DELETE /v1/sessions/{id}` | Close policy connection and renderer; release or terminate the session process |

Create a session:

```json
{"version":1,"profileId":"panda-pi05-libero","robotId":"panda","modelId":"pi05","checkpoint":"gs://openpi-assets/checkpoints/pi05_libero/","task":"libero_spatial:0","seed":7,"protocol":"practice"}
```

Step it, using a fresh request ID for each intended command:

```json
{"version":1,"type":"step","payload":{},"requestId":"step-1"}
```

Change the actual policy sensor in practice:

```json
{"version":1,"type":"intervene","payload":{"kind":"camera-occlusion","enabled":true,"fraction":0.35},"requestId":"occlusion-1"}
```

Repeated identical command IDs are idempotent. Reusing an ID for a different operation fails. Frame sequence numbers do not rewind on reset. A running session must be paused before a manual single step. After success, the horizon, or an error, reset before another run. Reset clears the active intervention and pending action queue.

One session is admitted per worker. It expires after 15 minutes or two minutes without client activity by default; expiry closes the environment and policy socket. Failed or stuck startup/inference has a bounded timeout and a terminated session process. Run Uvicorn with **one** API worker; scale with a session-aware router to independent instances, not multiple Uvicorn workers sharing an in-memory manager.

Evidence is the current episode only and lives in worker memory. Export it before reset/deletion. Flattened state/action evidence enables diagnosis and recorded replay; it does not capture policy RNG, all solver state, or promise exact fresh-inference branching. A single successful task is not an official aggregate LIBERO benchmark result.

## Validation performed and remaining

The code is exercised using injected environment/policy doubles and actual FastAPI ASGI HTTP requests. These tests cover camera rotation/resize/state construction, action chunk cadence, action application, actual sensor-mask inputs, benchmark locks, terminal success, reset, cleanup, idempotence, verified checkpoint identity, token/CORS enforcement and body limits. They do not run the downloaded model, real MuJoCo/EGL, or the Docker image.

Run the lightweight tests without downloading model weights:

```bash
python -m pip install -r workers/arena/requirements-api.txt httpx==0.28.1
python -m unittest discover -s tests -p 'test_arena_worker*.py' -v
```

Before making claims about the hosted service, build the container, initialize the real environment, validate the pinned OpenPI checkpoint on a GPU, compare several fixed initial-state episodes with the native upstream evaluator, and measure total GPU memory/throughput. No successful GPU run or production availability is claimed by this source implementation.

## Primary implementation references

- [Pinned OpenPI installation and GPU requirements](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/README.md)
- [JAX GPU allocation controls](https://docs.jax.dev/en/latest/gpu_memory_allocation.html)
- [Native LIBERO input example](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/src/openpi/policies/libero_policy.py)

- [Native OpenPI LIBERO evaluation loop](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/examples/libero/main.py)
- [OpenPI policy-server checkpoint defaults](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/scripts/serve_policy.py)
- [OpenPI WebSocket client](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/packages/openpi-client/src/openpi_client/websocket_client_policy.py)
- [LIBERO authoritative environment wrapper](https://github.com/Lifelong-Robot-Learning/LIBERO/blob/8f1084e3132a39270c3a13ebe37270a43ece2a01/libero/libero/envs/env_wrapper.py)
- [LIBERO benchmark source and initialization](https://github.com/Lifelong-Robot-Learning/LIBERO/tree/8f1084e3132a39270c3a13ebe37270a43ece2a01)
