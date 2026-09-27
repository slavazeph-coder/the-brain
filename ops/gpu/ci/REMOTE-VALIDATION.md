# Remote GPU validation for PR #143

CPU CI proves the *implementation*. It proves nothing about Simon's RTX 4090.
This directory adds the path that produces real evidence, from a GitHub-hosted
runner, against the real container — and keeps the two kinds of claim apart.

Two workflows:

| Workflow | Trigger | Secrets used | Purpose |
| --- | --- | --- | --- |
| `.github/workflows/gpu-host-keyscan.yml` | manual | none | print the host keys a runner sees, so they can be pinned after out-of-band comparison |
| `.github/workflows/gpu-remote-validation.yml` | manual | SSH key + pinned known_hosts | phases 3–15 of remote validation, sanitized evidence artifact |

`gpu-runtime.yml` is unchanged and still runs CPU validation on pull requests.
Remote credentials are never reachable from a `pull_request` event.

## One-time bootstrap (operator)

Everything below is host-side or GitHub-admin work. It cannot be done from CI,
because GitHub never reveals a secret after creation and because only Simon can
authorize a key on his container.

**1. Create a dedicated CI key.** Do not reuse a personal key. No passphrase —
a passphrase-protected key cannot be used in `BatchMode`.

```bash
ssh-keygen -t ed25519 -a 100 -N '' -C 'brainsnn-gpu-ci' -f ~/.ssh/brainsnn_gpu_ci
```

**2. Send Simon only the public half** (`~/.ssh/brainsnn_gpu_ci.pub`) and ask him
to add it to the same `authorized_keys` mechanism he used for the existing key.
Never send the private half anywhere.

**3. Pin the host identity.** Scan from a machine you trust, and separately run
the `GPU Host Keyscan` workflow. Compare the fingerprints. They must match.

```bash
ssh-keyscan -p 40008 142.179.227.252 | tee /tmp/known_hosts
ssh-keygen -lf /tmp/known_hosts
```

**4. Store credentials and variables.**

```bash
gh secret   set BRAINSNN_GPU_SSH_PRIVATE_KEY --repo slavazeph-coder/the-brain < ~/.ssh/brainsnn_gpu_ci
gh secret   set BRAINSNN_GPU_KNOWN_HOSTS    --repo slavazeph-coder/the-brain < /tmp/known_hosts
gh variable set BRAINSNN_GPU_SSH_HOST --repo slavazeph-coder/the-brain --body '142.179.227.252'
gh variable set BRAINSNN_GPU_SSH_PORT --repo slavazeph-coder/the-brain --body '40008'
gh variable set BRAINSNN_GPU_SSH_USER --repo slavazeph-coder/the-brain --body 'root'
```

The endpoint is a rented Vast container: host, port and host key can all change
when it is recreated. Re-run steps 3–4 when that happens.

## Running it

```bash
gh workflow run gpu-remote-validation.yml --repo slavazeph-coder/the-brain \
  --ref codex/simon-4090-runtime -f level=connectivity
```

Levels are cumulative:

- `connectivity` — phases 3–6. Needs nothing on the container but SSH + PyTorch.
- `install` — adds phases 7–9: deploys the exact PR SHA, installs the runtime,
  starts the supervisor with inference still unconfigured, reports compatibility.
  Add `-f install_vllm=true -f vllm_version=<exact>` to build the isolated venv.
- `model` — adds phases 10–13. Requires `-f model_revision=<40-hex>` and, for a
  first download, `-f allow_model_download=true`.
- `recovery-and-queue` — adds phases 14–15.

Choose `vllm_version` from what the `07-compatibility.txt` evidence actually
shows (driver, CUDA, Python, torch, VRAM, free disk). This workflow refuses to
install a floating "latest" ML package.

## What each marker does and does not mean

| Marker | Proves | Does **not** prove |
| --- | --- | --- |
| `SSH_EXTERNAL_OK` | a GitHub runner authenticated to the container | anything about the GPU |
| `GPU_VISIBLE_OK` | `nvidia-smi` reports an RTX 4090 in this container | that CUDA runs |
| `GPU_COMPUTE_OK` | a real, correctness-checked CUDA kernel executed | that a model loads |
| `WORKSPACE_PERSIST_OK` | files survive SSH session teardown | survival of container stop/recreate |
| `SUPERVISOR_PERSIST_OK` | the control process survives logout | that inference works |
| `REAL_MODEL_READY` | the backend health check reports ready | response quality |
| `BRAINSNN_REAL_GPU_INFERENCE_OK` | production `gpuInference.js` validated a real model response | production routing, or Railway |
| `REAL_GPU_RECOVERY_OK` | the supervisor restarted its own inference child and served again | recovery from a Vast preemption |
| `BACKGROUND_CHECKPOINT_OK` | the finite queue created a ledger and yielded to foreground | sustained utilization |

Telemetry captured during the probe is a short bounded sample. It cannot support
a claim of 99% useful utilization, and nothing here measures uptime.

## Known host constraints (observed 2026-09-10, from the Vast machine listing)

Machine 15904, `king-Legion-T7-34IRZ8`, 1x RTX 4090, 24.6 GB, 32 vCPU / 64 GB,
Calgary AB, reliability 99.86%. Three facts change how this must be run:

- **The endpoint is a dynamic residential IP.** The listing reports
  50.99.12.201 while the address supplied by email was 142.179.227.252. Both
  reverse-resolve to `*.abhsia.telus.net` in Calgary, i.e. the same TELUS line
  after a lease rotation. Treat `BRAINSNN_GPU_SSH_HOST` and
  `BRAINSNN_GPU_KNOWN_HOSTS` as perishable, and re-pin both whenever the
  instance is restarted or recreated. Neither address answered on port 40008
  while the instance was in the stored (stopped) state.
- **`Max CUDA: 12.2`.** That implies a ~535-series driver. Pick a vLLM release
  whose bundled torch targets cu121/cu124 rather than the newest wheel line,
  and confirm against `07-compatibility.txt` before pinning `vllm_version`.
- **`failed to inject CDI devices: unresolvable CDI devices`** appears on the
  machine listing. Until that is resolved host-side, a container can start with
  no GPU visible, in which case `GPU_VISIBLE_OK` fails at phase 4 and nothing
  downstream is meaningful. This is a host-side fix (regenerate the CDI spec,
  restart the container runtime), not something CI can work around.

A stopped Vast instance has no SSH listener. `connectivity` failing with a
connection timeout most likely means the instance is not running, not that the
credentials are wrong.

## Not covered, and why

- **Container restart persistence** — GitHub cannot stop or recreate a Vast
  container. Simon must configure the runtime as the container's supervised
  startup command and then perform one controlled restart. The intended
  foreground command is
  `<verified python3 path> /workspace/slava/brainsnn-gpu-runtime/runtime.py run`.
  Do not blindly replace the existing entrypoint — SSH may depend on it.
- **Independent backup restore** — needs an approved off-container destination.
  SQLite state must be captured with `sqlite3 .backup` or an equivalent API, not
  by copying a live WAL database.
- **Production HTTPS route, Railway integration, fallback drill** — needs an
  approved TLS edge in front of the loopback gateway. No provider has been
  approved, so none was invented.

## Security properties

- Remote validation is `workflow_dispatch` only, with `permissions: contents: read`.
- `StrictHostKeyChecking=yes` against a pinned `known_hosts`. There is no
  insecure fallback path anywhere in the workflow.
- The private key is written with `umask 077`, parse-checked without being
  printed, and shredded at the end of the job.
- vLLM stays on `127.0.0.1:8000`; the gateway stays on `127.0.0.1:8787`. The
  runner reaches the gateway only through an authenticated SSH local forward, so
  the adapter test runs against the real gateway with nothing exposed publicly.
  The step fails if a non-loopback listener is detected on 8000.
- `runtime.env` is never printed. The gateway key is read into a runner variable
  that is registered with `::add-mask::` before use, and the evidence package is
  scrubbed and then re-scanned for credential shapes before upload.
- Only the inference process whose PPID matches the recorded supervisor PID is
  ever signalled. Unrelated GPU jobs are read about, never touched. No GPU
  clocks, power limits, persistence mode, entrypoint or host state is modified.
