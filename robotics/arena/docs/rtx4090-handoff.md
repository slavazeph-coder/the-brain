# BrainSNN Arena: RTX 4090 handoff

The production repository is `https://github.com/slavazeph-coder/the-brain`. Arena is served from `brainsnn-r3f-app/public/arena/`; worker source is in `robotics/arena/`. The first implemented learned-policy route is **Panda + native OpenPI π0.5 LIBERO**. G1/SONIC, GR00T, MolmoAct2 and SO101 entries require separate validated adapters. Existing BrainSNN text inference in `ops/gpu` is a different service and must keep working.

This source has CPU contract coverage. The CUDA model, actual LIBERO/EGL rendering, Docker image and combined RTX 4090 memory still need validation on the host. No cloud allocation or live worker is created by the website deployment.

Treat the commands and copied prompt below as an operator handoff for an available, authorized host window. GB10 remains unqualified; read `docs/gb10-qualification.md` before attempting this recipe on that platform. Local recording inspection and CPU contract tests require neither host.

## Copy this prompt to the agent on the 4090

```text
Set up and validate the real BrainSNN Arena worker from the main branch of
https://github.com/slavazeph-coder/the-brain on this RTX 4090 host.

Start by reading AGENTS.md, .ai-memory/MEMORY.md, the relevant GPU recovery
memory, ops/gpu/README.md, robotics/arena/docs/arena-worker.md and this handoff.
Record the exact source commit. Preserve local work: inspect git status first,
fetch and fast-forward only a clean existing checkout, or use a separate clone
or worktree. Do not reset or overwrite an existing checkout.

Inventory running GPU processes, free/total VRAM, driver, disk, ports and current
BrainSNN service health without printing secrets. Preserve the existing text
model, GPU supervisor, outbound bridge, startup hooks and private configuration.
Use a separate OpenPI environment and physics environment. Do not kill existing
models, upgrade the host driver, replace the container entrypoint, expose the
native policy port, or allocate paid cloud compute. If safe headroom is absent,
finish all possible setup and report the measured blocker and a proposed window.

Follow the pinned kit exactly: OpenPI 215abfb217dbac7d5f1273282331b9b1866c0479
with submodules, LIBERO 8f1084e3132a39270c3a13ebe37270a43ece2a01,
official gs://openpi-assets/checkpoints/pi05_libero/ and its complete external
SHA-256 manifest. Verify source and checkpoint before serving. Use loopback
8010 for the policy and 8081 for physics after checking availability. Disable
JAX preallocation; this is not a memory cap. Monitor actual peak VRAM and latency.
Use the existing host/container facilities; Docker-in-Docker is not required.

Run lightweight worker tests, then the real GPU policy wrapper and EGL physics.
The synthetic warm-up is only compilation, not evidence of robot execution.
Run scripts/probe-worker.py with the installed physics/API Python environment,
from robotics/arena with ARENA_TOKEN supplied privately
and a new persistent evidence directory. It must verify authentication, exact
origins, a real Panda step with policyExecuted=true and consumed policy camera
frames, then a complete bounded LIBERO Spatial episode. Verify and save the full
hash-bound recording bundles after reset and session deletion, including both
lossless input cameras, state, prompt, returned chunks and chosen controller inputs.
Inspect the saved JPEG previews, durable originals and action/state trace. Report
actual task success or failure honestly. Confirm
benchmark interventions are blocked and session deletion releases the renderer.
Check existing BrainSNN text inference still works afterwards.

Connect an operator-controlled HTTPS endpoint to the private physics worker.
Use a fresh 32+ character token stored privately and exact allowed origins
https://www.brainsnn.com,https://brainsnn.com. Keep credentials out of Git,
VITE variables, reports and URLs. Use an existing authorized proxy/tunnel;
do not invent DNS, credentials or accounts. If endpoint access is missing,
complete and evidence the local run, then give the exact remaining setup.

Verify browser connectivity at https://www.brainsnn.com/arena/ with
Panda -> pi05 LIBERO -> Connect worker. Confirm create, step, run, pause,
reset, practice sensor occlusion, evidence export and cleanup. Check both
rendered spectator frames and the separate policy observations. Do not mark
G1 or another catalog profile live unless its matching adapter truly runs.

Report source commit, package pins, checkpoint manifest digest, GPU/driver,
peak VRAM, inference latency, episode outcome, evidence paths, HTTPS endpoint
(without token), baseline text-service health, and exact start/stop instructions.
Stop only newly created test sessions/processes after validation unless a
durable worker deployment is configured. If leaving a validated worker running,
integrate it with the existing process manager, bound restarts and prove restart
recovery without replacing other services. State remaining gaps explicitly.
```

## Host preflight

Use the host's existing authenticated access. These commands show process and capacity metadata, not environment contents or tokens:

```bash
git status --short
git rev-parse HEAD
nvidia-smi --query-gpu=index,name,driver_version,memory.total,memory.used,memory.free --format=csv
nvidia-smi --query-compute-apps=pid,process_name,used_gpu_memory --format=csv
df -h
ss -ltn
```

Read the existing supervisor's documented `status` output and check the current website health. Do not print private `runtime.env`, process environments, full command lines or proxy configuration. The existing text backend commonly uses 8000 and gateway 8787; this kit uses **8010 and 8081**. Check actual occupancy rather than assuming either new port is free.

The pinned OpenPI README gives inference memory as greater than 8 GB and names RTX 4090 as an example. That is not a promise that this policy, a resident text model and rendering fit concurrently. Measure free memory, leave rendering/compilation headroom, and measure peak use during the real run. Disabling JAX preallocation prevents its default initial reservation; it does not enforce isolation or a hard memory ceiling. Insufficient headroom is an operational blocker, not permission to stop the current model or purchase another GPU.

## Source and environments

Use a new directory if the existing checkout is dirty. Clone via the host's normal GitHub authentication:

```bash
git clone https://github.com/slavazeph-coder/the-brain.git brainsnn-arena-source
cd brainsnn-arena-source
git rev-parse HEAD
cd robotics/arena
```

For an existing clean checkout on `main`, `git fetch origin` then `git pull --ff-only origin main` preserves divergence as an explicit error. Record the deployed commit provided with this handoff if validating that exact release.

Follow `docs/arena-worker.md` from this kit directory. Keep weights, virtual environments, private env files, logs and episode evidence outside Git. In an existing Vast container without a Docker daemon, use a dedicated Python 3.10 physics environment rather than installing Docker-in-Docker:

1. Install CPU PyTorch 2.2.2 from its official CPU index, then the exact `workers/arena/requirements-simulation.txt` into that environment. Do not use the existing text-inference environment.
2. Clone LIBERO into a separate directory, check out `8f1084e3132a39270c3a13ebe37270a43ece2a01`, and install it with `pip install --no-deps -e <LIBERO-directory>`.
3. Install the pinned OpenPI checkout's `packages/openpi-client` with `pip install --no-deps`. The full OpenPI model remains in its separate `uv` environment.
4. Reproduce the Dockerfile's LIBERO `config.yaml` with actual absolute BDDL, assets and initialization paths. Set `LIBERO_CONFIG_PATH` to that config directory. Set `ARENA_LIBERO_REVISION` and `ARENA_OPENPI_REVISION` to the pins above.
5. Verify the host exposes NVIDIA EGL/graphics libraries. Set `MUJOCO_GL=egl` and `PYOPENGL_PLATFORM=egl` for the physics process. If the surrounding container lacks graphics driver mounts, the host operator must correct that; a successful `nvidia-smi` alone does not establish working EGL.
6. Supply literal private values from an environment file outside the checkout through the existing process manager's environment facility, plus the variables above. Set `ARENA_RECORDING_DIR` to an absolute private persistent directory writable by this process. Run the dedicated environment's `uvicorn workers.arena.app:create_app --factory --host 127.0.0.1 --port 8081 --workers 1` from the kit directory. Do not evaluate arbitrary env-file text as shell code.

The Dockerfile is the canonical simulation dependency recipe. Its NVIDIA driver capabilities include `graphics`; Docker host networking and its loopback listener are specifically for a Linux host with an existing container toolkit. Neither environment route upgrades a host NVIDIA driver.

Follow the worker guide's **complete checkpoint copy** into a new destination, with symlinks dereferenced, then create the manifest outside it. Copying only weight files or merging into an old directory is insufficient. Run the wrapper with `uv run --project /opt/brainsnn-openpi python .../serve_openpi.py --checkpoint /models/pi05_libero --manifest /models/pi05_libero.manifest.json --host 127.0.0.1 --port 8010`; the explicit project selects the pinned environment regardless of shell directory.

For Docker, mount the private host archive at the absolute `ARENA_RECORDING_DIR` configured inside the container, writable by UID/GID 10001. The worker guide includes that mount. `docker run --rm` without it loses the container's archive on removal. Reset finalizes the prior recording and starts a new ID; session deletion and TTL end live resources but leave recordings subject to independent age/count/byte retention. They do not erase the archived episode. A pending writer can cause a safe `recording_busy` reset rejection; wait for it to finish and retry.

## Real acceptance run

Start the verified policy wrapper first and wait for its synthetic warm-up and listening message. The warm-up uses the native eight-state/two-image contract, but runs no simulator and consumes a policy RNG sample. Upstream reset does not rewind that RNG. This worker does not claim exact fresh-inference replay.

With the private `ARENA_TOKEN` supplied to the probe process, from the kit directory, use the installed physics environment's Python (or a separate environment with `workers/arena/requirements-api.txt`, including NumPy and Pillow). Replace the interpreter path below with that absolute path. The probe does not install dependencies or start a model:

```bash
/absolute/physics-venv/bin/python scripts/probe-worker.py \
  --url http://127.0.0.1:8081 \
  --origin https://www.brainsnn.com \
  --out /path/outside-git/arena-evidence/first-run \
  --max-seconds 600
```

The output directory must be new and stays private. The probe checks unauthorized/origin rejection, the pinned profile and recording capability, then validates one practice policy step and saves three JPEG previews plus the legacy trace. It resets to a distinct unstepped recording, verifies the old complete bundle, deletes the session and verifies the same original bundle again. Reset does not delete an archived episode.

Next it creates a locked `benchmark` protocol session for task `libero_spatial:0`, seed 7, verifies that interventions are rejected, and runs to checker success or exactly 220 policy steps. It deletes the session before fetching and verifying the formal archive. The bundles in `practice-recording.json` and `benchmark-recording.json` include exact lossless inputs and bound event relationships; the probe checks SHA-256, completeness, inference/chosen-input/state counts, and consumption links. Finalization polls check a 30-second deadline between requests. Each response has a byte limit (128 MiB for a bundle) and a 60-second body deadline checked between reads; a blocked read can additionally consume the socket timeout (60 seconds, or 100 for session creation). `--max-seconds` bounds episode polling between requests, not the entire invocation including startup, requests, finalization and cleanup. A complete recording means retained coverage, not a successful task.

A 220-step horizon miss can pass transport/execution/archive acceptance while `taskSuccess` remains false. Early environment termination without checker success, partial/unreadable/tampered archives, timeout, renderer error or absent consumption evidence fail acceptance. The probe attempts deletion in `finally` on failure; a broken connection can prevent cleanup, so confirm no orphan remains. It does not prove storage survival across process/container/host replacement: validate the configured persistent mount separately during a later authorized host window.

Inspect the images and evidence manually as well. A health response or claimed JSON field alone does not demonstrate correct policy behavior. Measure GPU memory while this real run executes and verify latency stays below the worker's 20-second inference deadline under the intended load. The synthetic compilation pass reduces first-call delay but does not guarantee later latency. Compare additional fixed episodes with the pinned native evaluator before publishing model-performance comparisons.

## HTTPS, service operation and cleanup

The browser connects directly to this distinct physics worker; the existing text-inference outbound bridge is not an arena transport. Use an existing authorized TLS reverse proxy to loopback 8081, forward `Authorization` and `Origin`, set the request-body limit to 64 KiB and the startup timeout to at least 100 seconds. Do not expose native OpenPI WebSocket 8010. Confirm external requests without a token fail and a forbidden origin remains rejected.

Repeat the probe using the HTTPS base URL and a new output directory, then verify the actual browser flow. The token is entered privately in **Connect worker** and stays in browser memory. Verify the site's CSP permits the configured HTTPS worker; do not put the token in the link or source code. Report an endpoint only after this validation. A configured local worker is not proof of public availability.

The worker has one session, a 900-second hard TTL, a 120-second idle TTL and bounded startup/inference failures. Session deletion releases physics/rendering resources but leaves the resident policy model loaded. For a completed test, stop the newly launched Arena policy and physics processes using their own recorded IDs or service names to release model VRAM. Never use blanket `pkill python`, `killall`, GPU reset or supervisor replacement. If keeping the service, use the existing supported process manager with separate names, log rotation and restart limits; test restart recovery and continued text-service health. A process left in a shell is not a durable deployment.

## Evidence to return

Return the exact Git commit, source/checkpoint pins, checkpoint manifest digest, GPU/driver, free and peak VRAM, preview paths, both verified recording bundles and their manifest hashes, action/state trace, measured latency, actual task outcome, HTTP/auth/origin checks, and existing text-service health before/after. Confirm the reset/deletion archive checks separately from any later storage-restart test. Include the new service's startup/stop/restart instructions and HTTPS URL without credentials. Keep weights, recordings and tokens private. G1 support, multiworker orchestration, 100k-episode scheduling and paid-compute provisioning remain separate work.

## Sources

- [Pinned OpenPI requirements and installation](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/README.md)
- [Native LIBERO policy inputs](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/src/openpi/policies/libero_policy.py)
- [Native policy inference and RNG](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/src/openpi/policies/policy.py)
- [JAX allocation controls](https://docs.jax.dev/en/latest/gpu_memory_allocation.html)
