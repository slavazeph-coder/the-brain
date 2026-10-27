# Hermes: GPU tasks for World Builder (October 23, 2026)

What the site needs from the GB10 and the 4090. Each item lists what "done" means. Keep tokens, worker URLs and SSH
details out of the repository; send them to the owner directly.

## 1. 4090: dense reconstruction, scored (highest value)

The metric scene path is on brainsnn.com (#217). On real photos the CPU reconstruction is accurate where it has
points (1.5 cm median against the ETH3D laser scan) but covers almost nothing: 2.1% of the room within 5 cm. Dense
MapAnything should change that.

- Run the `mapanything-apache` smoke on the 4090 (CUDA, offline weights pinned in `mapanything_apache.py`).
- Run it on the 12 ETH3D office photos named in `docs/world-studio-implementation.md`, uploaded with their original
  names (downscale to 3024 × 2016; the worker caps photos at 24 MP).
- Score it: `python -m robotics.world_worker.benchmark_eth3d --reconstruction JOB/output --eth3d office --out report.json`
  (needs scipy).

Done when the report is posted. Beat the CPU baseline on completeness, and record metres per unit: about 1.0 means
MapAnything's predicted scale is right without a tape measure. Also record peak GPU memory and time.

## 2. GB10: the always-on production worker

**October 24: the GB10 is rented out, so run this worker on the 4090 until it returns.** Use the same kit and the
same done check. A Claude cloud session cannot reach the 4090 over SSH (its network allows HTTPS only), so this is
yours or the owner's to deploy. Status and next steps: `docs/world-builder-handoff.md`.

- **Object names (#224).** Install `robotics/world_worker/requirements-naming.txt` in the scene engine's environment.
  Put a **newly rotated** `ANTHROPIC_API_KEY` in `/etc/brainsnn/world-worker.env`; the key shared in chat on
  October 24 must not be used. `adapters.gb10.json` already gives `scene-usd` that secret, `source_job` and
  `object_naming`.
- **Done for names when:** after a walkthrough, a measured distance and both approvals in the calibration card, the
  scene dialog shows "Named: N objects by claude-opus-5-5".

- Update to `main` (#213, #216, #217) and run the worker with `adapters.gb10.json`. `scene-usd` now takes `video` and
  `cloud`.
- Add `mapanything-apache` (GB10 or 4090) to the same worker, so the site gets dense clouds and metric scenes from one
  connection.
- Put it behind TLS, with a stable hostname rather than a quick tunnel, and give the owner the URL and an operator token.
  `robotics/world_worker/deploy/` has a systemd unit, an environment template and a Cloudflare named-tunnel template.

Done when `python -m robotics.world_worker.check_worker --url https://... --require scene-usd:video,cloud --upload-probe`
passes from outside the host, and brainsnn.com connects to it and builds a metric scene from a walkthrough: measure a
distance, then use "Build metric simulation scene (GLB, USD, IFC)".

## 3. Detections into the simulation scene

Since #224, separated objects can be named by Claude from the frames. Reviewed detections still matter: they win over
model names, and they can name things separation does not find.

`scene-usd` never passes `--detections`, so worker scenes have walls and floor but no furniture. The compiler already
lifts 2D boxes with camera poses, but it does not read review decisions.

- Pass only reviewed detections (accepted or edited in the Understand panel, or from the GB10 vision model after
  review), with each frame's `cameraFromCloud` pose.
- Keep unplaced detections in `scene.json` with their reason.

Done when a walkthrough scene shows detected boxes and the dialog's "Detected" line counts them.

## 4. Housekeeping

- Remove the SSH host and key path from the progress log on `hermes/world-builder-gb10`; the repository is public.
- Port the receipts work from `hermes/world-builder-gb10` onto `main` as one focused PR.
- #212 and #215 are superseded by #213 and #216; the owner decides whether to close them.

## 5. Lyra 1 on the GB10: approved for a measured trial (October 24, 2026)

The owner approved staging Lyra 1 on the GB10 under the NVIDIA Open Model License. Lyra 2 stays excluded: its checkpoint
licence is research-only. The 4090's 24 GB is too small for Lyra 1's documented peak of about 43 GB with full offloading.

The approval's conditions:
- **Safeguards stay on.** Run Cosmos-Guardrail1 and Llama-Guard-3-8B as the upstream downloader provisions them. The
  single-image entry point sets `disable_guardrail = True`; never copy that. Record the Llama 3.1 terms that come with
  Llama Guard.
- **Batch job in an isolated environment.** Do not change the shared production environment. Use the free headroom next
  to the two LLMs. If it does not fit, run in a slot where the 35B is paused; never stop the 27B. A run that does not
  fit is a failed admission, not a reason to drop checks.
- **Measure before anything is wired in.** Follow the staged plan in `docs/world-generative-qualification.md`: a
  decoder-only sample, then fresh-image generation with guardrails on. Record peak memory, time, input and weight
  hashes, the PLY hash, and that the PLY loads in Chromium and WebKit.
- **Labels when it ships.** Every output is a generative preview that planning never uses, and `metric_verified` stays
  false. The site credits NVIDIA Cosmos.

Done when the receipts are posted for review. Nothing goes on brainsnn.com until the owner has seen them.

## 6. LingBot-Map on the 4090: qualify the streaming engine (October 27, 2026)

`robotics/world_worker/lingbot_map_stream.py` adds `lingbot-map-stream`. It runs one walkthrough video (or 3–12 photos in
order) through LingBot-Map (Apache-2.0 code, `robbyant/lingbot-map`), which poses every frame of a long walk in one
streaming pass. COLMAP folds on repeated surfaces instead. Each pair of consecutive frames is then checked: the
model's turn between them against the turn their own SIFT matches give. The result is written to `capture.consistency`,
which the site already shows as an error when it reads `folded`. It uses the same frames as `colmap-sparse`, so the
two engines can be compared directly.

It has never run with real weights. Cloud sessions can't download the 4.6 GB checkpoint. On the CPU, with random
weights, the real architecture returned the shapes and camera conventions the adapter reads (`tests/world/test_lingbot_map.py`).

1. **Environment.** A separate venv, Python 3.11:
   - `pip install -r robotics/world_worker/requirements-lingbot.txt` (CUDA 12.8 wheels; see the file);
   - a clean clone of `github.com/robbyant/lingbot-map` at `b9dd1b1de535e6d36e777fb42b8433c781bfd783`, not pip-installed
     (the adapter imports it from that checkout and refuses any other copy).
2. **Pin the checkpoint.**
   - Download `lingbot-map.pt` from `robbyant/lingbot-map` on Hugging Face, and record the revision.
   - Run `python robotics/world_worker/lingbot_map_stream.py --hash-checkpoint /path/to/lingbot-map.pt`.
   - Put its `sha256` in `MODEL_SHA256` in a PR. `lingbot-map-long.pt` is the same size, so the size alone proves nothing.
   - The adapter loads tensors only (`weights_only=True`). If the file holds anything else, it refuses: report that,
     and don't loosen the check.
3. **Configure.**
   - Copy the `lingbot-map-stream` entry from `adapters.example.json`.
   - Set `WORLD_LINGBOT_SOURCE_DIR` and `WORLD_LINGBOT_MODEL_PATH`. Optionally set `WORLD_LINGBOT_BACKEND=flashinfer`
     (default `sdpa`, which needs no JIT toolchain).
   - Prove it with `check_worker --require lingbot-map-stream:video`.
4. **Score it on the synthetic room**, next to COLMAP's Oct 26 column in `scripts/world-demo/benchmark/README.md`:
   - render: `build_office.py -- OUT --frames 60 --width 960 --height 540`;
   - run: `run_benchmark.py OUT --jobs <worker>/jobs --engine lingbot-map-stream --refs refs-lingbot`;
   - record from `refs-lingbot/truth-score.json` and the job's `reconstruction.json`: camera alignment RMS, the turn check
     (pairs checked, median and worst disagreement), room width and depth error, withheld spans usable and within
     tolerance, peak GPU memory and time.
5. **One real phone video** (the owner's garage walk, 2:20). Record `capture.consistency`, time, peak memory, and whether
   the site proposes a planning map from it.

Done when the hash-pin PR and the receipts from steps 4 and 5 are posted. Leave the entry `enabled: false` on any
public worker until the owner has seen them. LingBot-Map's scale is the model's own: a measured distance is still
needed, and `metric_verified` stays false.
