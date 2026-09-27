# BrainSNN GPU runtime

Deployment package for Simon's interruptible RTX 4090 container: a supervised inference backend, authenticated gateway, optional outbound website worker and finite evaluation queue. The installer copies control files and creates private keys; it does not download a model or Python ML dependency. Production activation and uninterrupted operation require separate verification.

September 13 validation reached Simon's RTX 4090 using CUDA 12.2.2 and a pinned
llama.cpp build. Three direct adapter analyses completed in roughly 1.9 seconds.
The compiled app, actual Python worker and HTTP broker also passed a private
end-to-end GPU test: 1.882-second analysis, local fallback after worker loss, and
1.784-second analysis after recovery. Killing the model child recovered under the
same supervisor in 12 seconds. Seven of eight finite evaluation cases passed;
one exact-evidence case failed on Unicode quotation and remains recorded. An
off-container private backup restored with SQLite integrity verified. These
bounded checks do not establish continuous uptime. Subsequent production checks
on `https://www.brainsnn.com` passed two GPU analyses in approximately 2.3 and
2.2 seconds after the outbound bridge deployment.

If SSH times out or Vast reports `failed to inject CDI devices`, start with [host-recovery.md](host-recovery.md). It separates the host/container repair from application deployment and explains how to verify the complete current SSH endpoint.

The public BrainSNN website stays on Railway. Its server uses either a configured HTTPS inference base or the optional outbound HTTPS worker below; deterministic/local analysis remains available during container loss. Both the gateway (`127.0.0.1:8787`) and model backend (`127.0.0.1:8000`) bind to loopback. Never expose port 8000 or forward backend administrative endpoints.

## What runs

- A Python standard-library supervisor restarts a crashed/unhealthy model process with capped backoff. `/health` returns 503 until the model is ready. Startup allows 15 minutes for a first model load; sustained health failures thereafter restart it.
- A Bearer-authenticated gateway permits text-only `GET /v1/models` and nonstreaming `POST /v1/chat/completions`. It limits body/response sizes, output tokens, and concurrency. Keys are not in CLI arguments, child environments are filtered, redirects and arbitrary backend URLs are absent, and request bodies are not logged by the gateway.
- An optional finite background worker starts after foreground requests have been idle. A foreground request cancels a background upstream connection, requests SIGTERM/checkpoint, and kills the worker's process group after the configured grace. It then forwards the foreground request. GPU memory is not retained through SIGSTOP. Background inference cancellation depends on backend disconnect handling; verify this with the selected backend.
- Logs rotate at 5 MiB plus three backups. Status contains actual read-only `nvidia-smi` utilization/memory/temperature samples. Missing GPU telemetry is reported as unavailable. No power limit, clock, persistence mode or another user's process is changed.
- Low disk space or an excessive checkpoint directory pauses background work and prevents new model launches. Existing checkpoints are not silently deleted. This is an admission guard checked every poll, **not a filesystem quota**: each job must bound its own outputs and temporary model downloads must fit the disk.
- A successful finite background job parks; it is not rerun to inflate utilization. Failed jobs retry with delay. An optional finite backup command is supervised separately and time-bounded.
- An optional outbound worker maintains two authenticated HTTPS long polls to the existing Railway app. It restarts independently after crashes and reconnects with capped backoff. It never accepts a URL, command or arbitrary request headers in a job.

## Install after SSH access is restored

Run inside the container, from a transferred repository checkout:

```sh
python3 ops/gpu/install.py --destination /workspace/slava/brainsnn-gpu-runtime
```

This copies files and creates three distinct random keys in owner-only `runtime.env`. It does not start anything. It preserves an existing config when rerun, so add new optional fields explicitly when upgrading. Keep this directory on a verified persistent mount; the September 13 container's `/workspace/slava` is currently on its overlay filesystem, with no separate persistent volume verified. Never copy SSH private keys into the container. Keep credentials out of Git and backup manifests.

Verify `nvidia-smi`, Python version, free disk, container lifecycle and mount persistence before selecting an isolated vLLM environment. Pin the exact compatible vLLM package and model commit after that inspection, and record a package lock/file with hashes. Do not overwrite Simon's existing PyTorch environment. The launcher accepts an absolute local model directory with a full 40-character model commit or, only with `ALLOW_MODEL_DOWNLOAD=1`, a model repository plus that commit. It does not enable remote model code. Local model directories require operator provenance; `MODEL_MANIFEST` additionally verifies all weight/configuration/tokenizer files at each launch.

Current primary references reviewed September 9, 2026:

- [vLLM GPU installation requirements and CUDA/PyTorch binary compatibility](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/): select wheels after inspecting the actual driver; installing a random latest version into the preinstalled environment is inappropriate.
- [vLLM OpenAI-compatible serving](https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/) and [security guidance](https://docs.vllm.ai/en/stable/usage/security/): the backend should remain on a trusted network; an API key alone does not protect every backend endpoint.
- [Qwen3-4B-Instruct-2507 publisher model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507): one text-serving candidate with an Apache-2.0 model card and documented vLLM usage. This is a candidate, not a preselected quality result. Its model download is multiple gigabytes, and actual 4090 memory/latency behavior remains unmeasured.

Edit the private `runtime.env` as literal `KEY=VALUE` lines. It is not shell-sourced, supports no shell expansion, and command values are JSON argument arrays:

```ini
INFERENCE_COMMAND=["/workspace/slava/vllm-0.8.5.post1/bin/python","/workspace/slava/brainsnn-gpu-runtime/vllm_launch.py"]
VLLM_EXECUTABLE=/workspace/slava/vllm-0.8.5.post1/bin/vllm
MODEL_PATH=/workspace/slava/models/Huihui-Qwen3-4B-Instruct-2507-abliterated-bf16
MODEL_REVISION=c9bd464550d4078c72af0dd22aa18d0437868ce3
MODEL_MANIFEST=/workspace/slava/vllm-setup/verified-model-manifest.json
CHAT_TEMPLATE_PATH=/workspace/slava/models/Huihui-Qwen3-4B-Instruct-2507-abliterated-bf16/chat_template.jinja
CHAT_TEMPLATE_SHA256=65adea29f923a4eda2dad1f080cd6ac9458dea65bd581f9fc086e3e7d556d4db
SERVED_MODEL_NAME=brainsnn-local
MAX_MODEL_LEN=4096
GPU_MEMORY_UTILIZATION=0.50
VLLM_DTYPE=bfloat16
VLLM_MAX_NUM_SEQS=1
VLLM_MAX_BATCHED_TOKENS=4096
```

These September 13 candidate settings target the observed driver `535.183.01`.
They do not switch the running backend by themselves. The isolated dependency
selection is vLLM `0.8.5.post1`, PyTorch `2.6.0+cu124`, torchvision `0.21.0+cu124`,
torchaudio `2.6.0+cu124`, transformers `4.51.3`, xformers `0.0.29.post2` and
triton `3.2.0`; preserve the resolved package inventory and downloaded wheel
hashes with the deployment receipt. Driver compatibility, GPU memory and the
actual serving contract still require candidate inference tests before promotion.

The checked-in [candidate inventory](requirements-vllm-cu124.freeze.txt) records
the installed Linux x86_64 / Python 3.10 environment. It is an exact-version
`pip freeze`, not a cryptographic wheel lock. The parent deployment receipt also
retains the resolved wheel-hash lock. A reproduction recipe in a **new, empty**
environment is:

```sh
apt-get install python3.10-venv python3.10-dev build-essential
python3.10 -m venv /workspace/slava/vllm-0.8.5.post1
/workspace/slava/vllm-0.8.5.post1/bin/python -m pip install pip==25.1.1
/workspace/slava/vllm-0.8.5.post1/bin/python -m pip install --index-url https://download.pytorch.org/whl/cu124 torch==2.6.0+cu124 torchvision==0.21.0+cu124 torchaudio==2.6.0+cu124
/workspace/slava/vllm-0.8.5.post1/bin/python -m pip install -r /workspace/slava/brainsnn-gpu-runtime/requirements-vllm-cu124.freeze.txt
/workspace/slava/vllm-0.8.5.post1/bin/python -m pip check
```

Do not reuse that destination if an environment already exists. Python development
headers and a C compiler are required even with eager mode: the first structured
JSON request compiles Triton's CUDA helper. The real canary loaded the BF16 model
and ran FlashAttention on driver 535 before exposing this missing-header failure;
an ordinary health response alone would not have found it. Do not install a new
host driver or put CUDA stub libraries on the runtime search path.

The launcher fixes `VLLM_USE_V1=0`, `VLLM_ATTENTION_BACKEND=FLASH_ATTN`, eager
execution, disabled custom all-reduce and vLLM generation defaults. It passes the
backend secret only as `VLLM_API_KEY`, never `--api-key`. These behaviors use the
pinned [vLLM server](https://github.com/vllm-project/vllm/blob/v0.8.5.post1/vllm/entrypoints/openai/api_server.py)
and [engine arguments](https://github.com/vllm-project/vllm/blob/v0.8.5.post1/vllm/engine/arg_utils.py).
Transformers 4.51.3 already supports a separate
[chat_template.jinja file](https://github.com/huggingface/transformers/blob/v4.51.3/src/transformers/tokenization_utils_base.py);
the explicit template option makes the selected bytes verifiable rather than
working around an assumed lack of support.

`MODEL_MANIFEST` is a JSON object with `revision` matching `MODEL_REVISION` and a
`files` array of `{ "path": "relative/file", "sha256": "64-lowercase-hex" }`.
The operator must obtain those hashes from the selected immutable repository
snapshot, not bless unknown local weights after the fact. Extra metadata fields
such as `repository` and file `size` are permitted. Include every local
`.safetensors`, `.json`, `.jinja`, `.model`, `.txt`, `.bin` and `.py` file, including
`config.json` and at least one safetensors shard. Keep the manifest **outside**
the model directory to avoid trying to hash itself. Hash verification adds model
read time to startup. The optional template requires its own full SHA256, with
line endings preserved; a mismatch aborts launch.

The vLLM child normally preserves the runtime's inherited library path. If that
path includes the existing CUDA 12.2 toolkit or stub libraries, use an explicit
`VLLM_LD_LIBRARY_PATH` in private config after verifying driver discovery. An empty
value removes `LD_LIBRARY_PATH` for vLLM only; a nonempty value must be a list of
existing absolute directories separated by colons, without `stubs`. Preserve any
required real NVIDIA driver directory. Do not change the supervisor's shared
library path to make vLLM work, because the existing llama.cpp backend uses it.

The 50% allocation is a fraction of total VRAM, **not a GPU utilization target**.
`MAX_MODEL_LEN` is per request and `VLLM_MAX_BATCHED_TOKENS` must be at least that
large. Validate the application's largest allowed input plus its output budget;
4096 tokens may be insufficient, in which case increase both limits together
after measuring memory. Keep the current llama.cpp configuration available for
rollback until real adapter, deadline, disconnect/preemption and crash-recovery
tests pass against vLLM. Explicit model loading is separate from installing this
control package.

For a compatible, separately installed `llama-server`, the installer also includes
`llamacpp_launch.py`. Select it with the same supervisor and a verified local GGUF:

```ini
INFERENCE_COMMAND=["/usr/bin/python3","/workspace/slava/brainsnn-gpu-runtime/llamacpp_launch.py"]
LLAMACPP_EXECUTABLE=/workspace/slava/llama.cpp/build/bin/llama-server
MODEL_PATH=/workspace/slava/models/verified-model.gguf
MODEL_SHA256=<verified-64-character-content-sha256>
MODEL_REVISION=<same-verified-content-sha256>
GPU_LAYERS=99
BACKEND_PARALLEL=2
MAX_MODEL_LEN=8192
INFERENCE_JSON_SCHEMA_FILE=
```

`MAX_MODEL_LEN` is the per-request context length. llama.cpp divides context across
parallel slots, so the launcher passes `MAX_MODEL_LEN * BACKEND_PARALLEL` as its
total `--ctx-size`. Account for that combined KV cache when sizing VRAM.

Use the actual Python and binary paths on the container. Build llama.cpp against
a CUDA toolkit compatible with its driver; do not upgrade the host driver from
inside the container. Keep `INFERENCE_JSON_SCHEMA_FILE` empty for BrainSNN. Its
adapter sends `response_format=json_object`; adding a global grammar caused a
400 sampler initialization error in the real CPU model test. JSON syntax does
not guarantee the complete analysis contract, so real inference validation remains
required. The supervisor forwards only the named llama.cpp settings and the
backend credential; the launcher keeps that credential in an owner-only file.

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

For a larger finite backlog, select `regression-cases.jsonl` in the same command.
Its first eight entries preserve the seed case identities/content, followed by
56 original synthetic additions: Unicode and multilingual exact quotations,
embedded role/JSON instructions, numeric uncertainty, benign urgency versus
pressure, source context and four longer documents. Existing terminal results,
including failures, remain recorded and are not repeated for the same model
revision. Upgrading the installer copies this optional corpus but preserves the
active config and default eight-case queue.

The tests measure five-field JSON validity and exact source evidence only; they
do not assign a ground-truth persuasion score or replace the production adapter's
larger output contract. This set does not change the detector's held-out corpus,
train weights or automatically promote a model. A fresh model revision gets new
ledger identities so backend quality can be compared without overwriting prior
results. After 64 cases finish, `--watch` idles until approved work changes. Useful
continuous load requires new evaluation or user jobs; repeating finished tests
merely to report 99% utilization would add no new evidence.

Direct GPU training is an **optional job contract**, not an installed training loop. It needs an approved dataset, objective, evaluation split and resumable implementation. Keep a resident inference model plus a training model within measured memory limits; otherwise plan explicit time-slicing/model release and website fallback during model reload. Do not set minimum free memory to zero for direct training. The free-memory gate applies at job start; the job must enforce its own allocation limit thereafter.

Every direct worker must handle SIGTERM, checkpoint frequently during training (at least every 30–60 seconds), and exit within the configured two-second foreground grace; slow model-weight writes require periodic completed checkpoints rather than starting a giant write on SIGTERM. `checkpoint.save_json` provides atomic/fsynced JSON cursors. Large weights need framework-native atomic checkpoint writes plus versioned manifests and bounded retention. Preserve the last independently verified checkpoint. Abrupt Vast eviction/SIGKILL cannot trigger final checkpoint work. No automatic unreviewed promotion to production is implemented.

`BACKUP_COMMAND` is optional JSON argv for a **finite, operator-configured** copy to separately durable storage. It receives checkpoint/runtime paths but no GPU API tokens. SQLite live backups must use the SQLite backup API or a quiesced DB, not a lone copy of a live WAL database file. Keep large weights/datasets out of ordinary Git; use Git for source/manifests and independently durable storage for data. A same-container copy is not an eviction-safe backup. Test restoration before claiming recoverability.

## Connect the website

### Outbound HTTPS through the existing Railway application

This option needs no inbound GPU port, public model endpoint, tunnel account or
new DNS record. The GPU worker makes outbound requests to the app, receives only
one of two fixed operations, calls its local gateway and posts the result back.
The existing production adapter still performs the exact same full output
validation, deadlines and deterministic fallback. `/api/engine/compare` is unchanged.

The broker is **one Node process in one replica**. Railway configuration checked
September 13 has one `us-west2` replica. Explicitly acknowledge this with the flag
below; do not enable it for multiple replicas or clustered Node processes. Job
state is deliberately ephemeral and contains at most two total queued/leased
requests. Restart or rolling deployment can discard requests; those callers fall
back locally. This is a transport for live requests, not a durable training ledger.

Set these server-side Railway variables after deploying the bridge code:

```ini
GPU_INFERENCE_TRANSPORT=outbound
GPU_INFERENCE_MODEL=brainsnn-local
GPU_INFERENCE_TIMEOUT_MS=15000
GPU_BRIDGE_SINGLE_REPLICA=1
GPU_BRIDGE_WORKER_KEY=<new-random-secret-of-at-least-32-characters>
```

Generate a distinct random bridge key and store the same value privately in the
GPU runtime config. It must differ from all three existing GPU keys. The worker
key is never a `VITE_*` variable and never travels to the local model gateway.
Outbound mode uses neither `GPU_INFERENCE_URL` nor `GPU_INFERENCE_KEY`.

Add these literal lines to the GPU's owner-only `runtime.env`:

```ini
BRIDGE_COMMAND=["/usr/bin/python3","/workspace/slava/brainsnn-gpu-runtime/bridge_worker.py"]
GPU_BRIDGE_URL=https://www.brainsnn.com/api/gpu-worker
GPU_BRIDGE_WORKER_KEY=<same-private-Railway-worker-key>
```

Use the actual Python path, then stop/start the runtime to load the changed
configuration. The supervisor passes only the worker URL/key and its fixed
loopback gateway port/key to this child. It does not pass backend/background
credentials or unrelated application variables. Existing configs without these
fields keep working with bridge mode disabled.

`https://www.brainsnn.com` and
`https://the-brain-production.up.railway.app` passed TLS and `/healthz` checks.
The bare `brainsnn.com` currently redirects only `/` through a different service;
its `/healthz` returns 404. Use one of the verified hostnames as the worker base.
The worker rejects non-HTTPS URLs, embedded credentials, query strings, redirects
and any path other than `/api/gpu-worker`.

Worker endpoints authenticate before parsing, bound result bodies to 64 KiB,
and cap concurrent long polls at two. Jobs expire after 14 seconds, within the
app's 15-second default deadline; adapter cancellation removes them immediately
and late/duplicate results return 410. An offline worker becomes stale after
30 seconds and subsequent requests fall back immediately. A request already
computing may continue until the local gateway's 12-second deadline: broker
cancellation discards its result, it does not claim immediate GPU cancellation.
Two worker threads and gateway concurrency limits bound this tail. HTTP socket
timers and a process watchdog also recover from slow responses or stalled DNS.

Railway supports HTTPS long polling within its published request limits:
[Public networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits).
The 20-second polls reconnect with capped backoff after outages. Supervisor
restart, outer container startup and off-container recovery remain separate
operational requirements; polling is not evidence of 24/7 uptime.

Before production, exercise the actual worker and adapter through a private SSH
forward to the GPU gateway. Set `GPU_API_KEY` privately in the test process env,
point `GATEWAY_PORT` at the local forward and run:

```sh
node ops/gpu/ci/bridge_probe.mjs
```

The probe starts a temporary localhost HTTP broker, generates a separate worker
key, launches the real Python worker, verifies unauthorized requests fail,
executes three validated analyses and confirms fallback when the broker closes.
It prints only result metadata. The worker's `GPU_BRIDGE_ALLOW_LOOPBACK_HTTP=1`
exception is used by this local test only, and accepts literal `127.0.0.1` only.

### Direct HTTPS inference endpoint

Create a stable authenticated HTTPS route/tunnel to `127.0.0.1:8787` using the chosen operator account. TLS termination and request rate limits belong at that managed edge; do not publicly expose this stdlib HTTP listener directly. Only the gateway's allowlisted paths should traverse it. Use the gateway's `GPU_API_KEY` as the Railway server-side Bearer key, not the backend/background keys. Keep it out of browser `VITE_*` configuration. Set the adapter model to the exact `SERVED_MODEL_NAME` and its base URL to `https://<configured-host>/v1`.

No tunnel account/domain or public mapping is guessed or created here. Validate external unauthorized requests fail, models/analysis succeed with the key, and killing/restarting the model makes BrainSNN fall back then recover. Keep the total client deadline above the gateway's 12-second inference deadline plus up to two seconds of background shutdown.

## CPU-only validation

From the repository root:

```sh
python3 -m unittest discover -s ops/gpu/tests -v
python3 -m unittest discover -s ops/gpu -p 'test_evaluate_queue.py' -v
node --test ops/gpu/test_bridge_transport.mjs
```

The supervisor tests use temporary local HTTP servers/processes and no ML model/GPU load. They cover no-work configuration, backend crash recovery, authentication/endpoint and text-input restrictions, foreground checkpoint preemption, finite-worker completion, graceful process shutdown and atomic checkpoint preservation. Hardware, real model inference, tunnel availability, actual utilization, automatic container restart and off-container restoration require remote validation.
