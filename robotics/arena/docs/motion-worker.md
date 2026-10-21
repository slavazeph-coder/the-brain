# Reachy Mini motion worker (text-to-motion)

Status 21 October 2026: **the real 0.8B planner, flow-matching generator and reachability projection have run end to end on CPU, through the website, into the Arena page.** No GPU run of this worker has happened yet. The RTX 4090 was recorded as unavailable on 17 October; GB10 is unqualified for this stack.

Public page: `/arena/motion/` (source `brainsnn-r3f-app/public/arena/motion/`). Worker source: `workers/motion/`.

## What it is

[reachy-motion-generator](https://github.com/pham-tuan-binh/reachy-motion-generator) by Binh Pham (Apache-2.0, pinned at `96497d69a31cc89da209f224bd9c1fee1834b864`) splits text-to-motion in two:

1. **Planner.** A LoRA fine-tuned Qwen model (0.8B, 4B or 27B) turns an instruction into a short recipe: `go`, `hold` and `osc` segments over ears, head pitch/roll/yaw/height, body yaw and an energy channel.
2. **Generator.** A 21.8M-parameter flow-matching transformer turns the expanded plan into 25 Hz motion for Reachy Mini's nine degrees of freedom. Every frame is projected into the Stewart platform's reachable set with the SDK's analytical IK.

`workers/motion/app.py` serves the upstream `/generate-dense` API unchanged, adds a constant-time bearer key, a 16 KiB body cap, `/health`, model revision pins and a CPU engine (the upstream engine assumes CUDA graphs). The website calls it server-side only: `POST /api/motion/generate` validates the instruction, forwards it, then rebuilds every returned frame (rigid head pose, bounded translation, antenna and body ranges, monotonic 25 Hz time, at most 28.8 s) before the browser sees it. Prompts and motions are not stored.

The models drive Reachy Mini's head, antennas and body yaw only. They do not control humanoid arms, locomotion or grasping; another body needs retargeting, safety limits and likely more training data.

## Measured so far

| Where | Planner | Result |
|---|---|---|
| 4-vCPU cloud container, bf16, plain transformers, no optimised linear-attention kernels | 0.8B (`3561b10c…`) | 26–35 s per request (planner 25–35 s, generator 0.65–0.95 s for 1–2 variants, reachability ≤ 9 ms); 44.5 s while headless Chromium shared the CPU |

Recipes were valid on all five tried prompts (two greetings, sneeze, curious customer, passing robot dog); the 0.8B sneeze builds up and then snaps the head down, the correct direction. All 48 pre-generated 27B example moves and the CPU outputs pass the website validator.

The author's published latencies (0.17 s / 0.29 s / 0.8 s for 0.8B / 4B / 27B, RTX PRO 6000, FP8, MTP speculative decoding, CUDA graphs) and quality scores have **not** been reproduced on BrainSNN hardware.

## GPU worker (RTX 4090 when available)

The 4B planner reports ~12 GB with FP8 weights. vLLM reserves memory up front: alone on the card it takes 80%; next to the resident text services pass `--gpu-memory-utilization` with a share that leaves them their memory, and check `nvidia-smi` before and after. Do not change the existing text service, its environment or the driver to make room.

```bash
cd robotics/arena
docker build -f workers/motion/Dockerfile -t brainsnn-motion-worker .
sudo install -d -m 700 /etc/brainsnn && sudo install -m 600 /dev/null /etc/brainsnn/motion.env
echo "MOTION_WORKER_KEY=$(openssl rand -hex 32)" | sudo tee /etc/brainsnn/motion.env >/dev/null
docker run -d --name brainsnn-motion --restart unless-stopped --gpus all --ipc=host \
  -p 127.0.0.1:8000:8000 --env-file /etc/brainsnn/motion.env -v brainsnn-motion-cache:/root/.cache \
  brainsnn-motion-worker --bundle medium=binhpham/reachy-mini-motion-planner-4b@1b60d8f16b85473ceb20e3b62e464780c532b519 \
  --gpu-memory-utilization 0.45
KEY=$(sudo sed -n 's/^MOTION_WORKER_KEY=//p' /etc/brainsnn/motion.env)
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:8000/health
```

The first start downloads the bundle and compiles kernels (several minutes); the cache volume keeps both. The 27B (`7dc91cd3a22b6c30c2be5c309573e7b37ed53a74`, ~40 GB) does not fit a 24 GB 4090. Qualify on the 4090: FP8 kernels on compute capability 8.9, startup, memory beside the text services, latency for n = 1/2/4, and the validator accepting every response.

Publish the loopback port through HTTPS only (a TLS reverse proxy or an HTTPS tunnel such as Cloudflare Tunnel). The website rejects a non-loopback `http://` worker and requires the key for every remote worker. The existing outbound GPU bridge (`/api/gpu-worker`) carries text inference only; routing motion through it would need a new operation and a larger result cap.

## GB10

ARM64 + Blackwell (compute capability 12.1). The upstream `vllm/vllm-openai:v0.30.0` image, FP8 path and CUDA graph capture are unverified there. Start with the CPU-mode worker or plain transformers on the GPU (`--device cpu` is the only non-vLLM mode implemented here), then qualify a vLLM build for ARM64 separately. The 27B planner fits GB10's unified memory on paper only; measure it before offering it.

## CPU worker (local development and qualification)

```bash
cd robotics/arena
python -m venv .venv-motion
.venv-motion/bin/pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
.venv-motion/bin/pip install -r workers/motion/requirements-cpu.txt
.venv-motion/bin/python -m workers.motion.app --device cpu --port 8765 \
  --bundle low=binhpham/reachy-mini-motion-planner-0.8b@3561b10c2483c30307a2a2c4ab7d4a213206706d
```

Without `MOTION_WORKER_KEY` it only listens on loopback. Point the website at it:

```bash
MOTION_INFERENCE_URL=http://127.0.0.1:8765 MOTION_INFERENCE_EFFORTS=low MOTION_INFERENCE_TIMEOUT_MS=120000 npm run dev
```

## Website configuration

| Variable | Meaning |
|---|---|
| `MOTION_INFERENCE_URL` | Worker base URL. HTTPS, or `http://` on loopback (SSH tunnel, local development). |
| `MOTION_INFERENCE_KEY` | The worker's `MOTION_WORKER_KEY` (32–256 characters). Required for any non-loopback URL. |
| `MOTION_INFERENCE_EFFORTS` | Comma list of loaded planners, first is the default: `high` (27B), `medium` (4B), `low` (0.8B). Default `medium`. |
| `MOTION_INFERENCE_TIMEOUT_MS` | Whole-request deadline, clamped to 2 000–120 000 ms. Default 20 000. |

Unset, `/api/motion/status` reports `not_configured` and the page plays the pre-generated examples only. Limits: one request in flight per web process, 10 generations per minute per IP, at most 4 variations, instructions up to 300 characters.

## Tests

- `python -m unittest tests/test_motion_worker.py` (from `robotics/arena`): key check, chunked body cap, loopback guard, bundle and revision parsing. No model is loaded.
- `brainsnn-r3f-app/src/server/motionWorker.test.js` (in `npm test`): configuration, request bounds, response rebuilding and rejection of implausible poses, failure mapping, timeout and concurrency.
- `node scripts/test-arena-route.mjs` covers `/arena/motion/` routing and its published assets.

## Licences

Code, models (Hugging Face model cards) and dataset card: Apache-2.0. The 3D model, meshes and passive-joint kinematics come from 8bitkick/reachy_mini_3d_web_viz (Apache-2.0); see `public/arena/motion/robot/ATTRIBUTIONS.md`. The generator is trained on Pollen Robotics' emotions and dances libraries; check those dataset terms, and the base Qwen licences, before redistributing weights commercially.
