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
