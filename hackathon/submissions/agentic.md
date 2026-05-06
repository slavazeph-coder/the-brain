# XIO-Evolve — Autonomous Research Loop That Evolves Cognitive Defense

**Track**: Agentic AI Workflows
**Live**: https://brainsnn.com (Brain Evolve / Attack Evolve / MCP / Brain Steward sections)
**Repo**: https://github.com/slavazeph-coder/the-brain (branch `hackathon-techex`)
**Pipeline source**: `xio_evolve/pipeline.py` (Python, ~600 LOC)
**Demo video**: [MP4 link to be inserted post-recording] · 02:30 – 03:15

## The problem

Most "agentic AI" demos at this hackathon will be a wrapper around a
single LLM call with a tool list. Important pattern, but it stops there.
**Real agentic systems run continuously, learn across rounds, and
produce work product that compounds.** That's a different architecture.

## The solution

**XIO-Evolve is a closed-loop autonomous research pipeline** —
Researcher → Engineer → Analyzer → Cognition Store, running on a
configurable schedule, with persistent memory across rounds. We
applied it to the cognitive firewall problem from our Security
submission and watched **F1 climb from 0.18 to 0.81 in 5 rounds**
— with no human in the loop.

```python
# xio_evolve/pipeline.py — each round:
researcher.propose(prior_cognition) -> candidate
engineer.evaluate(candidate, corpus) -> result(pass/fail/score)
analyzer.distill(result) -> lesson
cognition_store.append(lesson) -> next round seed
```

The Researcher discovered the rule that catches CEO BEC. The Engineer
ran every candidate against the live corpus. The Analyzer extracted
patterns like "identity-proof claims without verification path are
high signal" and persisted them as institutional memory. The next
round's Researcher started from there.

## The closed loop, the arms race, and the autopilot

Three pieces work together:

- **XIO-Evolve** (Python, offline): the autonomous research pipeline
  above. Multi-armed bandit sampler (UCB1, Island, MAP-Elites) for
  exploration vs. exploitation. Persistent cognition store as
  long-term memory.

- **Layer 32 Attack Evolve** (browser, online): a co-evolving
  adversarial sandbox. Same MAP-Elites architecture, opposite
  objective — generate attacks that dodge the _current_ firewall.
  Every round forces the next defense round to face a harder
  benchmark. **Defense and attack improve simultaneously.**

- **Layer 21 Brain Steward** (browser, online): an autonomous
  watchdog with configurable tick interval (2s / 4s / 8s / 15s).
  Detects anomalies (z-score > 1.5σ on brain-region activity),
  auto-snapshots, narrates via TTS. Closes the loop between
  offline rule-evolution and online drift detection.

## Architecture talking points

- **Continuous loop, not single-shot**: the Researcher works on
  what the Analyzer learned 4 rounds ago, not on a fresh prompt
  every call. Knowledge compounds.
- **Co-evolution**: paired MAP-Elites loops (Layer 31 ↔ Layer 32)
  with opposite objectives. Stable test bench that gets meaner
  monotonically.
- **Persistent cognition store**: institutional memory survives
  across runs, restarts, machines. Same pattern enterprise teams
  need for SIEM rule maintenance, fraud heuristic tuning,
  policy enforcement.
- **MCP integration** (Layer 19): 14 tools exposed via JSON-RPC
  over stdio. Claude Code, Codex, and Gemini agents can drive any
  of these loops directly — query state, snapshot, evolve, query
  again. Production path for in-house agent integration.
- **Sampler choice**: UCB1 for explore-exploit balance, Island for
  diversity preservation, MAP-Elites for behavior-space coverage,
  Greedy for pure exploitation, Random as baseline. Switch per
  task.

## Why this matters at TechEx scale

- **Threat intel teams** get a research loop they can point at any
  inbound attack class — phishing, BEC, deepfake, vishing, insider
  threat — and have it evolve detection rules autonomously against a
  sandboxed corpus.
- **MLOps / model-risk teams** get a continuous-validation benchmark:
  every model update runs against the latest evolved attack corpus.
- **Policy & compliance**: same pattern works for evolving policy
  enforcement rules against evolving creative-evasion attempts.
- **In-house agent integration**: 14 MCP tools mean your own Claude /
  Codex / Gemini agents can drive the brain, not just observe it.

## Reproduce locally

```bash
git clone https://github.com/slavazeph-coder/the-brain.git
cd the-brain && git checkout hackathon-techex
python3 -m venv .venv && source .venv/bin/activate
pip install -r xio_evolve/requirements.txt
python -m xio_evolve.pipeline --rounds 5 --task firewall_evolution
```

Per-round output streams to `xio_evolve/rounds/round_NNNN/`.
Cognition store at `xio_evolve/cognition_store.db`.

Demo flow: [hackathon/scenarios/agentic-xio-evolve.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/scenarios/agentic-xio-evolve.md).
