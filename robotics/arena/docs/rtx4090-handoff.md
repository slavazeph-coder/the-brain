# BrainSNN Arena: RTX 4090 handoff

The production repository is `https://github.com/slavazeph-coder/the-brain`. Arena is served from `brainsnn-r3f-app/public/arena/`; worker source is in `robotics/arena/`. The first implemented learned-policy route is **Panda + native OpenPI π0.5 LIBERO**. G1/SONIC, GR00T, MolmoAct2 and SO101 entries require separate validated adapters. Existing BrainSNN text inference in `ops/gpu` is a different service and must keep working.

This source has CPU contract coverage. The CUDA model, actual LIBERO/EGL rendering, Docker image and combined RTX 4090 memory still need validation on the host. No cloud allocation or live worker is created by the website deployment.

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
Run scripts/probe-worker.py from robotics/arena with ARENA_TOKEN supplied privately
and a new persistent evidence directory. It must verify authentication, exact
origins, a real Panda step with policyExecuted=true and consumed policy camera
frames, then a complete bounded LIBERO Spatial episode. Inspect the saved JPEGs
and action/state trace. Report actual task success or failure honestly. Confirm
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
6. Supply the literal private values from `.env.arena` through the existing process manager's environment facility, plus the variables above. Run the dedicated environment's `uvicorn workers.arena.app:create_app --factory --host 127.0.0.1 --port 8081 --workers 1` from the kit directory. Do not evaluate arbitrary env-file text as shell code.

The Dockerfile is the canonical simulation dependency recipe. Its NVIDIA driver capabilities include `graphics`; Docker host networking and its loopback listener are specifically for a Linux host with an existing container toolkit. Neither environment route upgrades a host NVIDIA driver.

## Real acceptance run

Start the verified policy wrapper first and wait for its synthetic warm-up and listening message. The warm-up uses the native eight-state/two-image contract, but runs no simulator and consumes a policy RNG sample. Upstream reset does not rewind that RNG. This worker does not claim exact fresh-inference replay.

With the private `ARENA_TOKEN` supplied to the probe process, from the kit directory:

```bash
python scripts/probe-worker.py \
  --url http://127.0.0.1:8081 \
  --origin https://www.brainsnn.com \
  --out /path/outside-git/arena-evidence/first-run \
  --max-seconds 600
```

The output directory must be new. The probe checks unauthorized/origin rejection, saves capabilities, creates a practice session, validates one policy step, saves three JPEG camera views and the action/state evidence, then deletes it. Next it creates a locked benchmark session, runs task 0 / seed 7 until success or the 220-step horizon, saves evidence and deletes that session in `finally`. A horizon failure can pass the execution probe and is still a failed task. A timeout, renderer error, invalid frame or missing policy execution fails the probe. The configured runtime expires abandoned sessions; a broken connection may prevent immediate cleanup, so confirm no orphan remains.

Inspect the images and evidence manually as well. A health response or claimed JSON field alone does not demonstrate correct policy behavior. Measure GPU memory while this real run executes and verify latency stays below the worker's 20-second inference deadline under the intended load. The synthetic compilation pass reduces first-call delay but does not guarantee later latency. Compare additional fixed episodes with the pinned native evaluator before publishing model-performance comparisons.

## HTTPS, service operation and cleanup

The browser connects directly to this distinct physics worker; the existing text-inference outbound bridge is not an arena transport. Use an existing authorized TLS reverse proxy to loopback 8081, forward `Authorization` and `Origin`, set the request-body limit to 64 KiB and the startup timeout to at least 100 seconds. Do not expose native OpenPI WebSocket 8010. Confirm external requests without a token fail and a forbidden origin remains rejected.

Repeat the probe using the HTTPS base URL and a new output directory, then verify the actual browser flow. The token is entered privately in **Connect worker** and stays in browser memory. Verify the site's CSP permits the configured HTTPS worker; do not put the token in the link or source code. Report an endpoint only after this validation. A configured local worker is not proof of public availability.

The worker has one session, a 900-second hard TTL, a 120-second idle TTL and bounded startup/inference failures. Session deletion releases physics/rendering resources but leaves the resident policy model loaded. For a completed test, stop the newly launched Arena policy and physics processes using their own recorded IDs or service names to release model VRAM. Never use blanket `pkill python`, `killall`, GPU reset or supervisor replacement. If keeping the service, use the existing supported process manager with separate names, log rotation and restart limits; test restart recovery and continued text-service health. A process left in a shell is not a durable deployment.

## Evidence to return

Return the exact Git commit, source/checkpoint pins, manifest digest, GPU/driver, free and peak VRAM, real frame paths, action/state trace, measured latency, outcome, HTTP/auth/CORS checks, and existing text-service health before/after. Include the new service's startup/stop/restart instructions and HTTPS URL without credentials. Keep weights and tokens private. G1 support, multiworker orchestration, 100k-episode scheduling and paid-compute provisioning remain separate work.

## Sources

- [Pinned OpenPI requirements and installation](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/README.md)
- [Native LIBERO policy inputs](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/src/openpi/policies/libero_policy.py)
- [Native policy inference and RNG](https://github.com/Physical-Intelligence/openpi/blob/215abfb217dbac7d5f1273282331b9b1866c0479/src/openpi/policies/policy.py)
- [JAX allocation controls](https://docs.jax.dev/en/latest/gpu_memory_allocation.html)
