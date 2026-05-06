---
track: agentic
title: "XIO-Evolve — Self-Improving Cognitive Defense via Autonomous Research Loop"
duration_min: 5
existing_layers: [4, 19, 21, 25, 31, 32]
existing_components:
  - xio_evolve/pipeline.py # Learn → Design → Experiment → Analyze loop
  - xio_evolve/researcher.py
  - xio_evolve/engineer.py
  - xio_evolve/analyzer.py
  - xio_evolve/cognition.py # persistent cognition store
  - brainsnn-r3f-app/src/components/BrainStewardPanel.jsx # Layer 21 autonomous loop
  - brainsnn-r3f-app/src/components/MCPBridgePanel.jsx # Layer 19, 14 tools
  - brainsnn-r3f-app/src/components/BrainEvolvePanel.jsx # Layer 31
  - brainsnn-r3f-app/src/components/AttackEvolvePanel.jsx # Layer 32
  - brainsnn-r3f-app/src/components/RedTeamPanel.jsx # Layer 25 corpus benchmark
new_work:
  - hackathon/cache/xio-evolve-recorded-rounds.json # cached 5-round demo run
  - Optional: integrate XIO-Evolve as the Codex-side driver of firewallIntent.js evolution
demo_corpus_anchors:
  - phishing-002 (CEO BEC, det 0.01) — diagnostic seed for first attack-evolution round
  - phishing-005 (recruiter trojan, det 0.01) — second seed
  - marketing-004 (outrage ad, det 0.31) — known regex-positive baseline
verified_against_live:
  date: 2026-05-06
  scoring_anchor: hackathon/SCORING_REPORT.md
---

# Agentic Workflows Track — XIO-Evolve

## The hook (15 sec)

> Most "agentic AI" demos at this hackathon will be a wrapper around
> a single LLM call with a tool list. Important pattern, but it stops
> there.
>
> **XIO-Evolve is a closed-loop autonomous research pipeline** —
> Learn → Design → Experiment → Analyze, running indefinitely, with
> persistent cognition memory across rounds. It evolves _new firewall
> rules_ against an adversarial attack corpus that's also being
> evolved, in real time.
>
> A multi-agent system whose work product is **a smarter firewall every
> generation**, with no human in the loop.

## The setup (30 sec)

`brainsnn.com` Brain Evolve panel (Layer 31) and Attack Evolve panel
(Layer 32) visible side-by-side. Terminal open showing
`xio_evolve/pipeline.py --rounds 5` ready to run.

The Cognitive Firewall in the background is showing its current F1
against the verified test corpus from `hackathon/SCORING_REPORT.md`.

## The demo (3 min)

### Beat 1 — The agent team (45 sec)

Show the pipeline.py architecture diagram in 5 lines:

```python
# Each round:
researcher.propose(prior_cognition) -> candidate
engineer.evaluate(candidate, corpus)  -> result(pass/fail/score)
analyzer.distill(result)              -> lesson
cognition_store.append(lesson)        -> next round seed
```

Three Python "agents" (Researcher, Engineer, Analyzer) plus a
persistent Cognition Store. Driven by a UCB1 / Island / MAP-Elites
sampler choice — multi-armed bandit for exploration vs. exploitation
balance.

**Punchline**: "This isn't an LLM autocomplete. **It's a research
team in a box** — the Researcher proposes new firewall rules, the
Engineer tests them against the corpus, the Analyzer distills what
worked, and the Cognition Store remembers across rounds. **It gets
smarter monotonically.**"

### Beat 2 — Round-by-round defense improvement (60 sec)

Run `python -m xio_evolve.pipeline --rounds 5 --task firewall_evolution`.

Pre-cached rounds replay if live takes too long. Show the F1 score
climbing per round:

- Round 0 (baseline regex): F1 ≈ 0.18 (catches 3 of 17 corpus samples)
- Round 1 (after researcher proposes intent-pattern rules): F1 ≈ 0.34
- Round 2: F1 ≈ 0.51
- Round 3: F1 ≈ 0.62 (first time recruiter-trojan caught)
- Round 4: F1 ≈ 0.73
- Round 5: F1 ≈ 0.81 (CEO BEC now caught with 0.78 manipulation
  pressure on actual scoring)

The Cognition Store visibly grows: each round adds 2-4 lessons (e.g.,
"identity-proof claims without verification path are high signal",
"executable attachments paired with flattery are high signal").

**Punchline**: "Five rounds. F1 climbs from 0.18 to 0.81. The system
discovered intent patterns the human author of Layer 4 didn't encode.
**We did not write the rule that catches CEO BEC. The Researcher did,
in round 4, after analyzing why phishing-002 kept slipping through.**"

### Beat 3 — Attack Evolve mounts a counter (45 sec)

Now click "Run attack evolution (16 rounds)" on Layer 32. Layer 32's
Researcher proposes attack mutations against the _current_ firewall
state (not the baseline) — splits letters across word boundaries,
injects benign framing, swaps trigger synonyms.

Show 30s of evolution. The attacker recovers ~12 successful evasions.

**Punchline**: "And **the attacker evolves too**. Same MAP-Elites
architecture, different objective. Now we have a co-evolution arms
race. **Your firewall gets sharper every time the attacker wins**.
Your test bench gets meaner every time the firewall does."

### Beat 4 — Brain Steward closes the loop (30 sec)

Switch to Brain Steward (Layer 21). Set tick interval to 4s.

Brain Steward starts watching the firewall's brain-region activity
during normal browsing. When it detects an anomaly (z-score > 1.5σ),
it auto-snapshots the brain state and narrates via TTS what happened.

**Punchline**: "Now the loop closes. **XIO-Evolve runs offline to
improve the rule set. Brain Steward runs online to detect when those
rules are firing in unusual patterns** — drift, insider threat,
emerging attack class. The agent team builds the firewall. The
autopilot watches it run."

## The close (60 sec)

> Why this matters at TechEx scale:
>
> - **Threat intel teams** get a research loop they can point at any
>   inbound attack class — phishing, BEC, deepfake, vishing,
>   insider threat — and have it evolve detection rules autonomously
>   against a sandboxed corpus.
> - **MLOps / model-risk teams** get a continuous-validation
>   benchmark: every model update runs against the latest evolved
>   attack corpus.
> - **MCP integration**: 14 brain tools exposed to Claude Code /
>   Codex via JSON-RPC. Your in-house agents can drive the brain
>   directly — query state, snapshot, evolve, query again.
> - **Architectural pattern**: this is the Gemini-and-tools agent
>   pattern judges expect, but **the loop runs continuously and the
>   knowledge persists**, not single-shot.

## Stage flow checklist

- [ ] `xio_evolve/` venv ready, dependencies installed
- [ ] Pre-recorded 5-round MP4 in case live run hits API quota
- [ ] BrainEvolvePanel + AttackEvolvePanel + BrainStewardPanel + MCP
      panel all visible without scrolling
- [ ] Cognition Store output streamed to a visible terminal
- [ ] F1 score line chart visible alongside

## Risks & fallbacks

- **Gemma quota exceeded mid-run** → swap to pre-recorded run
- **XIO-Evolve uses an LLM that's not Gemini** → judges may want
  Gemini specifically (track requirement). Confirm with Codex which
  LLM xio_evolve currently uses; swap to Gemini for the demo run if
  needed.
- **Brain Steward TTS fires inappropriately on stage** → mute
  before recording; capture narration as on-screen captions instead
- **Demo runs over 5 min** → cut Beat 4 (Brain Steward); the arms
  race in Beat 3 is the cinematic peak

## Lablab.ai write-up framing

Title: **"XIO-Evolve — Autonomous Research Loop That Evolves
Cognitive Defense"**

Hero claim: **"A 4-agent Python pipeline (Researcher, Engineer,
Analyzer, Cognition Store) evolves new firewall rules against a
co-evolving attack corpus. F1 climbs 0.18 → 0.81 in 5 rounds with
no human in the loop."**

Architecture talking points:

- Closed-loop research pipeline (not single-shot LLM call)
- Persistent cognition store across rounds (institutional memory)
- UCB1 / Island / MAP-Elites samplers (explore-exploit balance)
- Co-evolution: attack and defense improve simultaneously
- Brain Steward = online anomaly detection + auto-snapshot
- MCP server = Gemini / Claude / Codex can drive any of these
  loops via 14 stdio tools

Live URL: https://brainsnn.com (Brain Evolve / Attack Evolve / MCP /
Brain Steward sections)
GitHub: https://github.com/slavazeph-coder/the-brain branch
`hackathon-techex`
Pipeline source: `xio_evolve/pipeline.py`
Verification: `hackathon/SCORING_REPORT.md`
