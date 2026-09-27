---
type: project
description: PR143 local revalidation and separate Vast host CDI/network recovery requirements
---

# GPU host recovery — September 9, 2026

The owner supplied screenshots of Vast machine15904, RTX4090, with publicIP50.99.12.201 and a cropped `failed to inject CDI devices: unresolvable CDI devices` error. The previously emailed endpoint142.179.227.252:40008 still times out before authentication. A single TCP-only check of50.99.12.201:40008 also timed out, but that port is not confirmed for the screenshotIP. Do not silently combine the new address with an old instance port.

The CDI error is a host/container startup issue; it may prevent the background container's SSH from starting, but the precise fault and connection to the timeout remain unverified. Need host nvidia-smi, toolkit/runtime versions, full container State.Error and current port mapping. Newer toolkit JIT-CDI failures can surface as unresolved devices; do not assume missing YAML or blindly upgrade/reinstall the host.

Revalidated implementation9702bde on Node22:904 app tests,11 runtime tests,7 queue tests, lint/build, deterministic API smoke and5 HTTP mock-GPU checks passed. No app defect found. Added ops/gpu/host-recovery.md with official NVIDIA/Vast references and conditional operator steps. No remote command ran, no host repair performed, no production variables changed and no email sent. Private keys were not read/copied.

The original dirty ~/the-brain remains preserved. PR143 is draft. Hermes handoff lives at ~/.hermes/handoffs/brainsnn-4090.md; Codex readiness watcher remains active until ownership is explicitly coordinated. Real GPU validation, durable startup/backups and useful ongoing workload remain pending.

## September 13 — llama.cpp deployment plumbing

Reverified PR143 at `b7c5c7eca74c965af8c5dca79705c701b4a0efa3`: CI, runtime/queue and actual CPU model smoke all succeeded. Code inspection before GPU deployment found that `install.py` omitted `llamacpp_launch.py` and `Runtime.child_env` omitted its configuration, preventing a configured llama.cpp deployment from starting. Fixed in `1c7ea0a8883fb2f15515568be034204d4df81943`; 12 runtime tests and 7 queue tests pass. The new regression actually installs the package, runs the installed launcher through the filtered environment, verifies effective flags and private key-file handoff, rejects changed model content and checks configuration preservation.

Do not set the optional `INFERENCE_JSON_SCHEMA_FILE` for BrainSNN. The real CPU workflow recorded that a global `--json-schema` conflicts with the adapter's per-request `response_format=json_object`, producing HTTP400 sampler initialization failures. The successful smoke leaves global grammar off; output still requires full adapter validation.

Hugging Face's immutable GGUF API revision `c9e90669eeb205d5af35c28a3e9983fc9293c2ec` confirms file `Huihui-Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf` has 2497281312 bytes and SHA256 `b1324e2f1bd2e0610d591f54f93e38d90b187f69d1f215f4cace349eade678d7`. Use the verified digest for `MODEL_SHA256` and evaluation `MODEL_REVISION`.

Current app integration has no outbound worker bridge. A future bounded authenticated HTTPS pull broker could use existing Railway TLS, but an in-memory broker would require a confirmed single application process/replica; multi-replica operation needs shared state. No bridge is implemented by this runtime fix. Coordinate actual SSH/GPU deployment state through current shared memory; old endpoint and CDI observations above are historical.

## September 13 — outbound bridge implemented and hardware tested

The subsequent implementation adds optional `GPU_INFERENCE_TRANSPORT=outbound`, an authenticated two-job in-memory HTTP broker, and a supervisor-managed Python worker using the fixed loopback gateway. `GPU_BRIDGE_SINGLE_REPLICA=1` explicitly gates this mode; the checked Railway service configuration has one us-west2 replica. Use `https://www.brainsnn.com/api/gpu-worker` (or the existing Railway domain): those hosts pass TLS and health checks, whereas bare `brainsnn.com` routes through a different redirect service and returns404 for API paths. No secret values were inspected for this configuration audit.

The existing adapter still validates all fields and falls back deterministically; the comparison path is unchanged. Broker cancellation removes pending state and rejects late results; already running GPU work can last until the gateway's12-second deadline. Exactly two worker loops bound that tail. The worker refuses redirects/remote plaintext/arbitrary job URLs and has total HTTP deadlines plus a supervisor-restart watchdog for DNS stalls. Single-replica memory loss on app restart/rolling deploy causes bounded fallback, not durable request replay.

Parent task's real GPU receipt is `outputs/4090-deep-access/real-outbound-gpu-http-20260913.json` in its workspace: compiled app with production preloads + actual Python worker + broker + SSH-forwarded GPU passed1.882-second initial inference,14.007-second fallback after worker loss, and1.784-second recovered inference. Unauthorized worker requests returned401 and deterministic comparison remained unchanged. Parent also verified model-child crash recovery in12 seconds and restored a private off-container backup. The finite evaluation queue passed7/8 cases; Unicode exact quotation failed and is recorded. Website activation, outer container restart support and sustained utilization remain separate work.

The cross-language worker regression is `ops/gpu/test_bridge_transport.mjs`, run in GPU Runtime CI with Node and Python. It intentionally does not run inside the app Dockerfile's `npm test`, because the production Node image has no Python dependency. `MAX_MODEL_LEN` now means per-request context consistently: llama.cpp receives total context multiplied by `BACKEND_PARALLEL` (8192×2 by default).
