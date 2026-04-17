# BrainSNN TRIBE v2 Server

FastAPI wrapper around Meta's [TRIBE v2](https://github.com/facebookresearch/tribev2) foundation model. Maps the Destrieux fsaverage5 cortical mesh down to BrainSNN's 7 anatomical regions (CTX, HPC, THL, AMY, BG, PFC, CBL) and returns region-mapped activation timeseries plus inter-region flow estimates.

The frontend ([brainsnn-r3f-app](../)) calls this server when its mode toggle is set to **TRIBE v2**. Without this server, the frontend transparently falls back to STDP simulation — so this is an _optional_ upgrade, not a hard dependency.

---

## Endpoints

| Method | Path                | Purpose                                                                   |
| ------ | ------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/health`           | Liveness probe. Returns `{ "status": "ok", "model_loaded": bool }`.       |
| `GET`  | `/scenarios`        | List pre-computed scenario JSON files (sensory burst, memory replay, …).  |
| `GET`  | `/scenarios/{name}` | Fetch a pre-computed scenario by name. No model load required — instant.  |
| `POST` | `/predict`          | Run TRIBE v2 inference on uploaded video / audio / text. ~5–30s per call. |

---

## Local development

```bash
cd brainsnn-r3f-app/server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn api:app --reload --port 8642
```

Then point the frontend at it:

```bash
# in brainsnn-r3f-app/
echo "VITE_TRIBE_API=http://localhost:8642" >> .env
npm run dev
```

The first `/predict` call downloads the TRIBE v2 weights (~2GB) and the Destrieux atlas. Subsequent calls are warm.

---

## Local Docker

```bash
cd brainsnn-r3f-app/server
docker build -t brainsnn-tribe .
docker run -p 8642:8642 --rm brainsnn-tribe
```

The Dockerfile pre-warms the Destrieux atlas at build time so the first request only pays for TRIBE v2 weight download, not atlas fetch.

---

## Deploy to Fly.io (recommended)

Two reasons Fly is preferred:

1. The smallest machine (`shared-cpu-1x`, 1GB) is enough for `/scenarios`-only traffic — frontend works the moment you deploy.
2. Scaling to 4GB for `/predict` workloads is a single command (`flyctl scale memory 4096`).

```bash
cd brainsnn-r3f-app/server
flyctl auth login
flyctl launch --no-deploy --copy-config --name brainsnn-tribe
flyctl deploy
```

After deploy, set the URL in the frontend (Vercel project → Environment Variables):

```
VITE_TRIBE_API=https://brainsnn-tribe.fly.dev
```

---

## Deploy to Railway

Railway's free tier (512MB RAM) cannot run real `/predict` calls. Use a Pro seat with ≥2GB allocated, or stay on `/scenarios`-only mode.

```bash
cd brainsnn-r3f-app/server
railway login
railway init
railway up
```

Set `VITE_TRIBE_API` in the Vercel project to the generated Railway URL.

---

## Environment variables

The server itself reads no env vars. All caching is filesystem-based:

| Path                  | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `/app/.nilearn_cache` | Destrieux atlas + any nilearn-fetched datasets  |
| `/app/.hf_cache`      | HuggingFace download cache (TRIBE v2 weights)   |
| `./cache`             | TRIBE v2 model checkpoint via `from_pretrained` |

On Fly.io these are ephemeral (warm only within a single VM lifetime). Mount a volume if you want persistence across deploys:

```bash
flyctl volumes create brainsnn_cache --size 10
# then add to fly.toml:
# [mounts]
#   source = "brainsnn_cache"
#   destination = "/app/cache"
```

---

## Troubleshooting

| Symptom                            | Likely cause                                                          |
| ---------------------------------- | --------------------------------------------------------------------- |
| `OOMKilled` on first `/predict`    | VM has < 4GB RAM. Scale up.                                           |
| `404` on `/scenarios/foo`          | Scenario JSON not in `server/scenarios/`. Run `python precompute.py`. |
| Frontend toggle stuck in "STDP"    | `VITE_TRIBE_API` not set, or `/health` returns non-200.               |
| Build fails on `tribev2` install   | Missing `git` in container — already handled by the Dockerfile.       |
| `nilearn` complains about no atlas | Network blocked at runtime; rebuild the Docker image to re-warm.      |
