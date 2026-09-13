---
type: project
description: Isolated vLLM candidate launcher, pinned model provenance and finite regression backlog
---

September 13, 2026: user explicitly requested vLLM and continuous website GPU
service after the outbound bridge was live on www.brainsnn.com. Keep the working
llama.cpp configuration available until the vLLM candidate passes real production
adapter, maximum-input, timeout, preemption and recovery checks. GPU utilization
and model memory fraction are different quantities; no artificial burn loop.

- Candidate venv `/workspace/slava/vllm-0.8.5.post1`, Linux x86_64/Python3.10,
  vLLM0.8.5.post1, torch2.6.0+cu124, transformers4.51.3. Installed version inventory
  is `ops/gpu/requirements-vllm-cu124.freeze.txt`, explicitly not a wheel-hash lock.
- Local huihui Qwen3-4B BF16 snapshot revision
  `c9bd464550d4078c72af0dd22aa18d0437868ce3`. Launcher supports a complete SHA256
  manifest stored outside the snapshot and an explicit separately hashed template.
  Transformers4.51.3 itself already reads chat_template.jinja; older memory's
  generalized claim that a separate template is unsupported was inaccurate.
- vLLM child fixes V0/FLASH_ATTN/eager, defaults to bfloat16 and one sequence,
  bounds batched tokens against context, and keeps backend key in environment.
  `VLLM_LD_LIBRARY_PATH` overrides only this child; do not globally replace the
  CUDA12.2 library path still needed by llama.cpp. Never select CUDA stubs.
- Real canary loaded BF16 weights and FlashAttention on driver535.183.01. First
  structured JSON request exposed missing Python.h in Triton's helper compile;
  Python3.10 development headers and C compiler are prerequisites even in eager
  mode. Production vLLM promotion remains a separate real-inference gate.
- Optional `regression-cases.jsonl` contains64 original synthetic cases: the
  existing8 preserved plus56 new Unicode, injection, numerical/context cases and
  four longer documents. Five-field JSON and exact evidence checks only; no
  ground-truth truthfulness metric, training or held-out detector modifications.
  The existing SQLite ledger skips completed case/model/revision/prompt identities
  including failures; --watch idles when done and awaits genuinely new work.
- Local validation:23 supervisor/worker/launcher tests and8 queue tests passed,
  including full installed fake-vLLM invocation, secret exclusion, file tampering,
  library isolation and resumed64-case backlog preserving the seed failure.

Container outer restart and persistence still require host-owner verification.
The in-container supervisor plus outbound HTTPS polling is not proof of24/7
uptime after container recreation. Parent owns SSH, deployment and promotion.
