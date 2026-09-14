# Bounded research and drafting worker

`crew_worker.py` implements a real CrewAI `Agent` → `Task` → sequential `Crew`
using CrewAI's native `LLM(custom_openai=True)` at the existing authenticated
`http://127.0.0.1:<GATEWAY_PORT>/v1/chat/completions` gateway. An explicit model
name is mandatory. An abliterated model has exactly the same limited role as
any other model: untrusted draft generation with no approval authority.

## Installation and isolation

CrewAI is pinned to **1.15.21**, whose declared Python range is **>=3.10,<3.14**.
Use a dedicated Python 3.13 environment; do not install it into either the
stdlib supervisor environment or the pinned CUDA/vLLM environment. The host's
Python 3.14 is unsuitable. These constraints and the custom endpoint API are
from the [pinned PyPI release](https://pypi.org/project/crewai/1.15.21/) and
[CrewAI LLM documentation](https://docs.crewai.com/v1.15.21/en/concepts/llms).

From the repository root, on an authorized development machine with disk and
package-network access:

```sh
UV_CACHE_DIR=/private/tmp/brainsnn-uv-cache uv venv --python python3.13 .venvs/crewai
UV_CACHE_DIR=/private/tmp/brainsnn-uv-cache uv pip install --python .venvs/crewai/bin/python -r ops/gpu/requirements-crewai.txt
.venvs/crewai/bin/python -c 'import importlib.metadata; from crewai import Agent, Task, Crew, LLM; print(importlib.metadata.version("crewai"))'
```

On Linux, use an operator-selected writable temporary cache directory instead
of `/private/tmp`. `requirements-crewai.txt` pins the framework; it is **not a
complete transitive wheel/hash lock**. Before operational cutover, record the
resolved environment and test it on the target OS/Python without changing the
existing inference environment.

The present local install was attempted and failed resolving `pypi.org` under
the active sandbox. No existing installed CrewAI package was found in the
inspected local environments/cache. An empty Python 3.13.12 venv was created;
it is not a working CrewAI installation. Dependency install evidence is in
`outputs/orchestration-validation/crewai-install.log`.

## Runtime interface

The canonical runtime calls:

```python
result = run_research(payload, config, cancel_event)
```

`config` is operator configuration only. Required keys:

| Key | Contract |
| --- | --- |
| `CREWAI_PYTHON` | Absolute path to the isolated interpreter |
| `GATEWAY_PORT` | Existing loopback gateway port, 1024..65535 |
| `GPU_API_KEY` | Existing gateway credential, 32..256 characters |
| `SERVED_MODEL_NAME` | Exact model name served by the existing vLLM backend |
| `ORCHESTRATION_TOKEN` | Current active lease token, 32..256 characters |
| `CREWAI_TIMEOUT_SECONDS` | Optional 1..90; default 90, including startup |
| `MAX_OUTPUT_TOKENS` | Optional 128..2048; default 1024 |

The runtime must own an active research lease and healthy inference backend
before calling. The token is sent as `X-BrainSNN-Orchestration-Token`; every
inference call passes through the same scheduler gateway. The worker never
launches/stops vLLM, takes GPU ownership, starts a watchdog, or retries jobs.

The wrapper launches this file's fixed `--child` entry point with config and
payload through stdin. No credentials are in arguments or provider-error
messages. The child receives an allowlist of environment settings, a temporary
working/storage directory, no inherited provider/proxy credentials, and
telemetry/tracing disabled. It is killed as a process group and reaped before
returning on deadline or cancellation. A lease must not be released before the
wrapper returns and the canonical runtime has drained/stopped inference.

One agent, one sequential task, two reasoning iterations, zero agent/provider
error retries, a bounded request timeout, and a 90-second hard parent deadline
limit work. Tools, delegation, code execution, planning, reasoning expansion,
memory, tracing and Crew sharing are disabled. The model cannot select a URL,
model, interpreter, command, tool, spend amount, or execution flag. A child
Python audit guard denies non-gateway socket connections/DNS and process
creation. It is defense in depth, not an OS security boundary; use an
unprivileged runtime account and host egress controls at cutover.

## Evidence packet and result

Only this job payload shape is accepted (1..4 sources, bounded to 24,000 UTF-8
JSON bytes; each source content <=6,000 characters):

```json
{
  "objective": "Draft an API integration offer for human review.",
  "sources": [{
    "id": "s1",
    "title": "Operator supplied product notes",
    "url": "https://example.org/product",
    "content": "BrainSNN exposes a text analysis API."
  }]
}
```

Source URLs are attribution only and are never fetched. The operator must
supply permitted evidence content. Each result includes source content SHA256
references and a canonical packet SHA256. The draft contract contains a title,
1..8 claims, factual/proposal segments and limitations. Every claim references
a supplied source and an exact nonempty quote contained in that source. Every
factual segment exactly repeats one referenced claim; unsupported factual
additions, missing/duplicate references and extra fields fail validation.

Quote presence proves source provenance only. It does not establish that a
claim follows from its quote, that the source is true/current, or that a
proposal is sensible. `evidence_validation` explicitly records that semantic
human review is still required. The model's raw output is parsed strictly;
malformed or unsupported outputs fail with `research_contract_invalid`.

The stdlib parent revalidates the draft and creates the fixed envelope:
`status=pending_human_review`, `external_execution_enabled=false`,
`external_spend_usd=0`, and separate required approvals for outreach,
publication and spend. These values cannot be assigned by the prompt/model.
There is no outbound outreach/publication/payment implementation in this
worker. A draft is neither an approval nor evidence of a sale.

Failures use stable, non-sensitive `ResearchError.code` values:
`invalid_research_payload`, `invalid_research_config`, `crewai_unavailable`,
`research_timeout`, `research_cancelled`, `research_contract_invalid`,
`inference_unavailable`, or `research_failed`. Missing packages, incompatible
Python, wrong package version and unavailable inference never yield a
successful synthetic result. Scheduler transport retry policy remains owned
by the canonical runtime; hardware fault clearance cannot be delegated to
CrewAI.

## Local validation and remaining gate

```sh
python3 -m unittest discover -s ops/gpu/tests -p test_crew_worker.py -v
CREWAI_TEST_PYTHON="$PWD/.venvs/crewai/bin/python" python3 -m unittest discover -s ops/gpu/tests -p test_crew_worker.py -v
```

The first command runs stdlib evidence/auth/config/lifecycle tests and clearly
skips the integration class. The second **requires** the real pinned installed
package and socket permission. It executes actual CrewAI against a clearly
labeled controlled loopback OpenAI response adapter, then tests unavailable
inference. It fails if the selected interpreter lacks the package; it never
replaces CrewAI with a mock. This adapter is orchestration/transport evidence,
not model-quality or real-vLLM evidence.

Actual current evidence: **13 stdlib tests passed; one real-integration class
skipped**. Tests include hard cancellation/timeout against real sleeping child
processes and a real unavailable-dependency child invocation. Output is saved
at `outputs/orchestration-validation/crewai-contract-tests.log`. The parent
session separately confirmed loopback socket binding is forbidden by this
sandbox, so real CrewAI integration is blocked by both package installation
and socket permissions. No live model, GPU, renderer, paid API, production
mutation or deployment was used by this component.

Before deployment, complete the real package/controlled-adapter tests, then
run one bounded operator-supplied source packet through the owned vLLM lease.
Verify exact served-model routing, evidence quality, request bounds,
cancellation/draining, and human-review state. Coordinate that validation
with the existing runtime and recovery monitor under the main cutover runbook.
