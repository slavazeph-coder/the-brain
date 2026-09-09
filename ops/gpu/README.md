# BrainSNN GPU runtime

Prepared deployment files for Simon's interruptible RTX 4090 container. **Not a live deployment:** SSH access, driver/CUDA compatibility, model quality, persistence, and the authenticated production route still need verification. No model or Python ML dependency is downloaded by these scripts.

The public BrainSNN website stays on Railway. Its server calls an authenticated OpenAI-compatible `/v1` base over an operator-configured HTTPS tunnel; deterministic/local analysis remains available during container loss. This runtime binds both the gateway (`127.0.0.1:8787`) and vLLM (`127.0.0.1:8000`) to loopback. Never expose port 8000 or forward vLLM administrative endpoints.

## What runs

- A Python standard-library supervisor restarts a crashed/unhealthy model process with capped backoff. `/health` returns 503 until the model is ready. Startup allows 15 minutes for a first model load; sustained health failures thereafter restart it.
- A Bearer-authenticated gateway permits text-only `GET /v1/models` and nonstreaming `POST /v1/chat/completions`. It limits body/response sizes, output tokens, and concurrency. Keys are not in CLI arguments, child environments are filtered, redirects and arbitrary backend URLs are absent, and request bodies are not logged by the gateway.
- An optional finite background worker starts after foreground requests have been idle. A foreground request cancels a background upstream connection, requests SIGTERM/checkpoint, and kills the worker's process group after the configured grace. It then forwards the foreground request. GPU memory is not retained through SIGSTOP. Background inference cancellation depends on backend disconnect handling; verify this with the selected backend.
- Logs rotate at 5 MiB plus three backups. Status contains actual read-only `nvidia-smi` utilization/memory/temperature samples. Missing GPU telemetry is reported as unavailable. No power limit, clock, persistence mode or another user's process is changed.
- Low disk space or an excessive checkpoint directory pauses background work and prevents new model launches. Existing checkpoints are not silently deleted. This is an admission guard checked every poll, **not a filesystem quota**: each job must bound its own outputs and temporary model downloads must fit the disk.
- A successful finite background job parks; it is not rerun to inflate utilization. Failed jobs retry with delay. An optional finite backup command is supervised separately and time-bounded.

## Install after SSH access is restored

Run inside the container, from a transferred repository checkout:

```sh
python3 ops/gpu/install.py --destination /workspace/slava/brainsnn-gpu-runtime
```

This copies files and creates three distinct random keys in owner-only `runtime.env`. It does not start anything. It preserves an existing config when rerun. Keep this directory on the container's **verified persistent mount**; `/workspace` persistence has only been reported by email so far. Never copy SSH private keys into the container. Keep credentials out of Git and backup manifests.

Verify `nvidia-smi`, Python version, free disk, container lifecycle and mount persistence before selecting an isolated vLLM environment. Pin the exact compatible vLLM package and model commit after that inspection, and record a package lock/file with hashes. Do not overwrite Simon's existing PyTorch environment. The launcher accepts a local model directory or, only with `ALLOW_MODEL_DOWNLOAD=1`, a model repository plus a full 40-character commit revision. It does not enable remote model code. Local model directories still require operator provenance/digest verification.

Current primary references reviewed September 9, 2026:

- [vLLM GPU installation requirements and CUDA/PyTorch binary compatibility](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/): select wheels after inspecting the actual driver; installing a random latest version into the preinstalled environment is inappropriate.
- [vLLM OpenAI-compatible serving](https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/) and [security guidance](https://docs.vllm.ai/en/stable/usage/security/): the backend should remain on a trusted network; an API key alone does not protect every backend endpoint.
- [Qwen3-4B-Instruct-2507 publisher model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507): one text-serving candidate with an Apache-2.0 model card and documented vLLM usage. This is a candidate, not a preselected quality result. Its model download is multiple gigabytes, and actual 4090 memory/latency behavior remains unmeasured.

Edit the private `runtime.env` as literal `KEY=VALUE` lines. It is not shell-sourced, supports no shell expansion, and command values are JSON argument arrays:

```ini
INFERENCE_COMMAND=["/workspace/slava/vllm-venv/bin/python","/workspace/slava/brainsnn-gpu-runtime/vllm_launch.py"]
VLLM_EXECUTABLE=/workspace/slava/vllm-venv/bin/vllm
MODEL_PATH=/workspace/slava/models/verified-model-snapshot
MODEL_REVISION=<verified-immutable-snapshot-digest>
SERVED_MODEL_NAME=brainsnn-local
MAX_MODEL_LEN=8192
GPU_MEMORY_UTILIZATION=0.60
```

The 60% VRAM allocation and 8K context are initial conservative limits, not measured capacity guarantees. Tune based on real memory use, latency and queue throughput; a VRAM fraction is **not a GPU utilization target**. A model may still fail to fit. Explicit model loading is intentionally separate from installing this control package.

## Start, stop, health and container restart

```sh
python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py check
python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py start
python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py status
python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py stop
```

`start` survives an SSH disconnect and confirms the supervisor process, not model readiness. `status` separately reports backend readiness, whether the process is still running, and stale telemetry. The foreground `run` action is preferable under an existing container process manager. Only one supervisor may own the runtime lock.

**A background process alone does not survive a stopped/recreated container.** Simon must add this command to the existing container's supported startup hook/process supervisor and ensure the container itself is restarted by Vast/its owner:

```sh
/usr/bin/python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py run
```

Use the actual Python path verified on that container. Run it alongside the existing SSH/init service, or as a managed foreground child with its own restart policy. Do not replace the current entrypoint blindly; that can remove SSH. This package requires neither Docker-in-Docker nor systemd and cannot configure the host's Vast startup policy from inside the container. Reboot/recreate the container once in a controlled test and confirm the supervisor, tunnel, model and checkpoint storage return without an SSH session. A supervisor crash requires the outer process manager to restart it.

## Useful background work and checkpoints

The supplied `evaluate_queue.py` uses the **same resident inference model**, avoiding a second model's VRAM allocation. It performs bounded structured-analysis and exact-source-evidence regressions against eight original synthetic cases. These checks do not establish factual accuracy, scientific neural validity or that any model has been trained. This tiny seed queue cannot keep a 4090 at 99% utilization; it is a smoke/evaluation starting point.

Once a real model is ready, this enables the useful seed queue and watches for newly approved cases:

```ini
BACKGROUND_COMMAND=["/usr/bin/python3","/workspace/slava/brainsnn-gpu-runtime/evaluate_queue.py","--cases","/workspace/slava/brainsnn-gpu-runtime/evaluation-cases.jsonl","--watch"]
BACKGROUND_LABEL=BrainSNN structured analysis and exact evidence regression queue
BACKGROUND_MIN_FREE_MB=0
BACKGROUND_IDLE_SECONDS=60
```

Confirm the Python path. The supervisor supplies `INFERENCE_MODEL=brainsnn-local`, `BRAINSNN_GPU_MODEL_REVISION` (from the verified `MODEL_REVISION`), `BRAINSNN_GPU_BASE_URL`, `BRAINSNN_GPU_API_KEY` (the separate background key), `BRAINSNN_CHECKPOINT_DIR`, and `BRAINSNN_RUNTIME_DIR`. Set an immutable model commit or verified local snapshot digest before running evaluation; replacing weights under a stable served alias must create new evaluation identity. Background calls must include `X-BrainSNN-Background: 1`. Only supervised background workers are admitted. Setting `BACKGROUND_MIN_FREE_MB=0` explicitly selects an API-based worker that loads no separate model; GPU start gating is unnecessary for that mode. An authenticated models health check does not interrupt work.

The SQLite ledger in `checkpoints/gpu-evaluations.sqlite` persists completed case/model/revision/prompt digests; finished cases are not repeated to burn GPU. A preempted incomplete case is retried later. With `--watch`, the worker waits for newly appended/changed cases; without it, exit zero parks the supervisor's worker slot. To admit new work after finite completion:

```sh
python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py stop
python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py resume-background
python3 /workspace/slava/brainsnn-gpu-runtime/runtime.py start
```

Direct GPU training is an **optional job contract**, not an installed training loop. It needs an approved dataset, objective, evaluation split and resumable implementation. Keep a resident inference model plus a training model within measured memory limits; otherwise plan explicit time-slicing/model release and website fallback during model reload. Do not set minimum free memory to zero for direct training. The free-memory gate applies at job start; the job must enforce its own allocation limit thereafter.

Every direct worker must handle SIGTERM, checkpoint frequently during training (at least every 30–60 seconds), and exit within the configured two-second foreground grace; slow model-weight writes require periodic completed checkpoints rather than starting a giant write on SIGTERM. `checkpoint.save_json` provides atomic/fsynced JSON cursors. Large weights need framework-native atomic checkpoint writes plus versioned manifests and bounded retention. Preserve the last independently verified checkpoint. Abrupt Vast eviction/SIGKILL cannot trigger final checkpoint work. No automatic unreviewed promotion to production is implemented.

`BACKUP_COMMAND` is optional JSON argv for a **finite, operator-configured** copy to separately durable storage. It receives checkpoint/runtime paths but no GPU API tokens. SQLite live backups must use the SQLite backup API or a quiesced DB, not a lone copy of a live WAL database file. Keep large weights/datasets out of ordinary Git; use Git for source/manifests and independently durable storage for data. A same-container copy is not an eviction-safe backup. Test restoration before claiming recoverability.

## Connect the website

Create a stable authenticated HTTPS route/tunnel to `127.0.0.1:8787` using the chosen operator account. TLS termination and request rate limits belong at that managed edge; do not publicly expose this stdlib HTTP listener directly. Only the gateway's allowlisted paths should traverse it. Use the gateway's `GPU_API_KEY` as the Railway server-side Bearer key, not the backend/background keys. Keep it out of browser `VITE_*` configuration. Set the adapter model to the exact `SERVED_MODEL_NAME` and its base URL to `https://<configured-host>/v1`.

No tunnel account/domain or public mapping is guessed or created here. Validate external unauthorized requests fail, models/analysis succeed with the key, and killing/restarting the model makes BrainSNN fall back then recover. Keep the total client deadline above the gateway's 12-second inference deadline plus up to two seconds of background shutdown.

## CPU-only validation

From the repository root:

```sh
python3 -m unittest discover -s ops/gpu/tests -v
python3 -m unittest discover -s ops/gpu -p 'test_evaluate_queue.py' -v
```

The supervisor tests use temporary local HTTP servers/processes and no ML model/GPU load. They cover no-work configuration, backend crash recovery, authentication/endpoint and text-input restrictions, foreground checkpoint preemption, finite-worker completion, graceful process shutdown and atomic checkpoint preservation. Hardware, real model inference, tunnel availability, actual utilization, automatic container restart and off-container restoration require remote validation.
