# Hybrid implementation result

Implemented in the existing queue/worker/UI; **not installed, activated, or deployed**. No Mac dependency installation, secret reads, model calls, spending, or `.ai-memory` changes were performed.

## Behavior and preserved gates

- Research payload accepts optional `engine`: `crewai` (legacy/default) or `swarms-crewai`. Unknown engines/settings fail validation before leasing. Engine participates in durable payload/idempotency and appears in the private operations UI and result provenance.
- Hybrid runs two real Swarms `Agent` instances sequentially: one proposal agent (up to two alternatives), then an independent critic. One loop and one total model attempt per Swarms agent; no tools, delegation, auto teams, recursion, planning, persistent memory, fallback providers, or scheduler. Existing single-agent CrewAI executor follows: three agents total, one Swarms round, inference concurrency one. CrewAI's existing iteration/retry limits remain unchanged.
- Both framework subprocesses share the existing research timeout (default/max 90 seconds). Each Swarms completion has the configured `MAX_OUTPUT_TOKENS` cap (128–2048, default 1024); its HTTP timeout is at most 30 seconds. Cancellation kills/reaps the owned process group before lease release. There is no simulated-success fallback.
- Handoff is strict JSON with exact keys, bounded text/lists, unique proposal IDs, source references, complete critique coverage, schema version, and original source packet hash. Duplicate JSON keys/nonfinite numbers/fences are rejected. Parent validates again, persists a content-addressed artifact and acknowledged job checkpoint, then passes the validated artifact to CrewAI as untrusted suggestions, never evidence or authority. CrewAI's exact-quote/factual-reference validation and atexit stdout fix remain.
- Owner authentication, durable scheduler, exclusive lease/heartbeat fences, GPU quarantine, video priority, checkpoints, review requirements, and external-execution/spend gates remain. No new service or scheduler was added. `install.py` includes the new stdlib adapter file.
- Children receive a scrubbed environment and temporary working/home directory. The Swarms HTTP adapter disables proxies and redirects and sends only the configured model and gateway/lease credentials to the fixed loopback gateway. Shared audit guard runs before framework import and denies other DNS/connect destinations, datagram sends, and subprocess execution.

## API verification and pin

Pin: **swarms==15.0.2**, in `ops/gpu/requirements-swarms.txt`, independently isolated from **crewai==1.15.21** and vLLM. [PyPI release metadata](https://pypi.org/project/swarms/15.0.2/) confirms the release and wheel SHA256 `2b7f9c789e4d084598b19415cb935558e399df9eef165a05f736d92f590b90b1`.

Read [upstream Agent source](https://raw.githubusercontent.com/kyegomez/swarms/master/swarms/structs/agent.py) and [package metadata](https://raw.githubusercontent.com/kyegomez/swarms/master/pyproject.toml), not inferred API names. Verified named constructor controls, `Agent.run(task=...)`, and `call_llm`. Source retry loop treats `retry_attempts=1` as one attempt, not one retry. The subclass overrides only the model-call hook with the bounded stdlib loopback transport; real Swarms still manages the agent run. Exact provider JSON is captured before framework history formatting. Runtime rejects a mismatched version or missing named control parameter instead of silently accepting `**kwargs`.

**Limit:** inspected source is upstream master reporting 15.0.2; the release wheel was not downloaded/imported here. Installed-wheel parity and real framework execution remain mandatory parent gates. No claim that remote integration already passed.

## Local verification

Logs: `outputs/hybrid-validation/`.

- Focused Python: **43 tests passed**, two installed-framework suites explicitly skipped.
- Queue/API: **22 passed**, including engine allowlist, durable selection and idempotency.
- App offline suite: **894 passed**.
- Production build and TypeScript validation: passed. Existing bundle-size advisory remains.
- Full Python attempt: 63 tests run, 15 errors from sandbox-denied socket binds; two installed-framework suites skipped. Subsequent focused run covers the final hybrid changes.
- Desktop/mobile Playwright attempt blocked at server startup: `listen EPERM 127.0.0.1:4186`. Extended existing browser scenario to queue hybrid research and verify the selected engine and provenance. Parent must rerun all four scenarios.

## Exact parent remote install and tests

Run from the **updated checkout root** on the existing remote host with disk available; do not install into the GPU/vLLM environment or on the Mac. Reuse the parent's `/workspace/slava/brainsnn-crew-venv`; do not duplicate its install. These commands are instructions only and were not executed here. Package retrieval is setup-time network access; framework tests use a synthetic loopback endpoint and fixture credentials, never paid inference.

```sh
python3.13 -m venv /workspace/slava/brainsnn-swarms-venv
/workspace/slava/brainsnn-swarms-venv/bin/python -m pip download --no-cache-dir --no-deps --only-binary=:all: --dest /workspace/slava/brainsnn-swarms-wheel swarms==15.0.2
/workspace/slava/brainsnn-swarms-venv/bin/python -c 'from pathlib import Path; import hashlib; p=Path("/workspace/slava/brainsnn-swarms-wheel/swarms-15.0.2-py3-none-any.whl"); assert hashlib.sha256(p.read_bytes()).hexdigest()=="2b7f9c789e4d084598b19415cb935558e399df9eef165a05f736d92f590b90b1"'
/workspace/slava/brainsnn-swarms-venv/bin/python -m pip install --no-cache-dir /workspace/slava/brainsnn-swarms-wheel/swarms-15.0.2-py3-none-any.whl
/workspace/slava/brainsnn-swarms-venv/bin/python -m pip check
/workspace/slava/brainsnn-crew-venv/bin/python -m pip check
mkdir -p outputs/hybrid-validation
/workspace/slava/brainsnn-swarms-venv/bin/python -m pip freeze > outputs/hybrid-validation/swarms-remote.freeze.txt
/workspace/slava/brainsnn-crew-venv/bin/python -m pip freeze > outputs/hybrid-validation/crewai-remote.freeze.txt
SWARMS_TEST_PYTHON=/workspace/slava/brainsnn-swarms-venv/bin/python CREWAI_TEST_PYTHON=/workspace/slava/brainsnn-crew-venv/bin/python python3 -m unittest discover -s ops/gpu/tests -v
```

If the parent's CrewAI installation did not complete, finish it only in its existing interpreter:

```sh
/workspace/slava/brainsnn-crew-venv/bin/python -m pip install --no-cache-dir -r ops/gpu/requirements-crewai.txt
```

The real hybrid suite asserts three sequential authenticated loopback requests, fixed model/token limits, no tools, proposal/critique handoff reaching real CrewAI, invalid-contract rejection before CrewAI, redirect denial, timeout and cancellation. The original real CrewAI suite must also pass, including clean single-JSON stdout at interpreter exit. Neither suite permits a missing/mismatched configured installation to be silently skipped.

On the parent machine with the existing frontend dependencies and permitted loopback sockets, run from the updated checkout:

```sh
cd brainsnn-r3f-app
node --test scripts/orchestration.test.mjs
npm run test:offline
npm run lint
npm run build
npx playwright test --config playwright.ops.config.ts
```

Do not activate/deploy until these pass. Eventual operator configuration uses `SWARMS_PYTHON=/workspace/slava/brainsnn-swarms-venv/bin/python` and the existing `CREWAI_PYTHON`; this change leaves `SWARMS_PYTHON` blank in the example by default.

## Remaining limitations

Transitive dependencies are resolved remotely, not fully locked here; preserve the remote freeze and `pip check` evidence. The audit guard is Python-level defense, not an OS sandbox against malicious native dependencies; use an unprivileged worker and OS egress restrictions for that threat model. No installed-package or actual vLLM compatibility/quality claim is made. Model agreement and source-ID membership do not establish truth, entailment, sales, or payment. Human review stays mandatory. A retried job reruns the bounded pipeline under existing retry gates; intermediate hybrid checkpoint reuse is not implemented. No deployment or unrelated cleanup was performed.
