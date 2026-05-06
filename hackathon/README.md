# BrainSNN @ TechEx Hackathon

**Event**: Transforming Enterprise Through AI (TechEx, lablab.ai)
**Window**: 2026-05-11 → 2026-05-19
**Mode**: Online submission (recorded MP4 + live URL + per-track write-ups)
**Branch**: `hackathon-techex` ([on GitHub](https://github.com/slavazeph-coder/the-brain/tree/hackathon-techex))
**Live URL**: https://brainsnn.com (Railway, us-east4, "Affective Intelligence for Online Content")
**Prize pool**: $10K across 5 tracks

## TL;DR for any AI picking this up cold

We are submitting one BrainSNN to all 5 TechEx tracks, leveraging the
existing 100+ layer canonical product. The hackathon work is mostly
integration, framing, and recording — not net-new code. The single
Codex pickup that unblocks 4 of 5 scenarios is
**`brainsnn-r3f-app/src/utils/firewallIntent.js`** — full spec at
[INTEGRATION.md](INTEGRATION.md).

Read order if you have 10 minutes:

1. [INTEGRATION.md](INTEGRATION.md) — what Codex needs to build first
2. [VERIFICATION.md](VERIFICATION.md) — what's already live
3. [SCORING_REPORT.md](SCORING_REPORT.md) — TRIBE numbers for the corpus
4. [DEMO_SCRIPT.md](DEMO_SCRIPT.md) — the 5-min recording

## Folder map

```
hackathon/
├── README.md                 ← you are here (start with TL;DR above)
├── LAYERS.md                 ← top-5 demo-worthy layers per track + secret weapons
├── VERIFICATION.md           ← live findings from running brainsnn-r3f-app locally
├── SCORING_REPORT.md         ← TRIBE scores for every corpus sample
├── INTEGRATION.md            ← firewallIntent.js interface spec for Codex
├── DEMO_SCRIPT.md            ← master 5-minute recording flow
├── demo-corpus/              ← 20 input samples used in stage demos
│   ├── README.md
│   ├── phishing/             (6 samples — Security)
│   ├── marketing/            (4 samples — Enterprise + brand safety)
│   ├── robot-prompts/        (3 samples — Physical AI)
│   ├── ar-overlays/          (3 samples — Physical AI)
│   ├── business-scenarios/   (3 samples — Enterprise Problem-Solving)
│   └── intel-corpus/         (3 samples — Data Intelligence: Gartner / 10-K / research paper)
├── scenarios/                ← 5 per-track demo scripts (full beat-by-beat narratives)
│   ├── security-cognitive-firewall.md
│   ├── agentic-xio-evolve.md
│   ├── physical-ai-warehouse.md
│   ├── enterprise-customer-service-defense.md
│   └── data-intelligence-knowledge-brain.md
└── submissions/              ← 5 per-track lablab.ai write-ups (≤500 words each)
    ├── security.md
    ├── agentic.md
    ├── physical.md
    ├── enterprise.md
    └── intel.md
```

## Two-AI lane contract

Both Claude (in `claude` CLI) and Codex (in `codex` CLI / PenguineWalkOS
on GitHub) work on this branch.

| Lane                            | Owner  | Folders / files                                                                                                               |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Scenarios / collateral / corpus | Claude | `hackathon/` exclusively                                                                                                      |
| Deploy / extensions / firewall  | Codex  | `brainsnn-r3f-app/src/utils/firewallIntent.js` (new), `brainsnn-r3f-app/server/`, `Dockerfile`, `railway.toml`, Fly.io config |

**Sync ritual** (every evening or session end):

1. `git pull --rebase origin hackathon-techex`
2. Append a dated entry under "## TechEx Hackathon — Started 2026-05-06" in
   `the-brain/.ai-memory/MEMORY.md` describing what landed and what's next.
3. `git push origin hackathon-techex`

**Conflict resolution**: whoever picks up the conflict first resolves it.
Don't force-push.

## Track mapping

| Track                        | Primary scenario                       | Hero layers                                                                         | Status                                 |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| Enterprise Security          | security-cognitive-firewall.md         | L4 firewall, L31 brain-evolve, L32 attack-evolve, L70 explainer, L42 counter-draft  | Scripted, blocked on intent classifier |
| Agentic AI Workflows         | agentic-xio-evolve.md                  | xio_evolve pipeline, L19 MCP bridge, L21 brain steward, L31/L32 arms race           | Scripted, ready to demo                |
| Physical AI & Robotics       | physical-ai-warehouse.md               | L59 audio firewall, 3D brain (R3F), Gemma 4 multimodal                              | Scripted, ready to demo                |
| Enterprise Problem-Solving   | enterprise-customer-service-defense.md | L4 firewall, L42 counter-draft, L88 persona simulator, L23 immunity score           | Scripted, blocked on intent classifier |
| Enterprise Data Intelligence | data-intelligence-knowledge-brain.md   | L18 knowledge brain, L33 multimodal RAG, L34 vector-graph fusion, L53 echo detector | Scripted, ready to demo                |

## Codex pickup priority (Day 1)

1. **`brainsnn-r3f-app/src/utils/firewallIntent.js`** — LLM intent
   classifier per [INTEGRATION.md](INTEGRATION.md). Without this, 4 of
   5 scenarios are weakened. Per-corpus expected outputs are in
   INTEGRATION.md so test-driven implementation is straightforward.
2. **Fix `hidden-truth` template false-positive** in
   `brainsnn-r3f-app/src/utils/cognitiveFirewall.js` — the medical
   pre-op briefing in `demo-corpus/robot-prompts/robot-003-medical-soothing.md`
   incorrectly trips this template. Either narrow the regex or add an
   LLM gate per template hit.
3. **Confirm Gemma keys** are set on the Railway service powering
   brainsnn.com (Counter-Draft / Layer 42 needs them).
4. **Decide TRIBE v2 Fly.io deploy** — the modes selector currently
   shows TRIBE v2 as an option. Either ship to Fly.io
   (`flyctl deploy` from `brainsnn-r3f-app/server/`) or hide the mode
   for the hackathon.
5. **Run a full Layer 32 evolution** (`Run attack evolution (16
rounds)`) and capture a screen recording of the F1 deltas — needed
   for Beat 3 of [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
6. **(Stretch)** Pre-cache intent classifier responses for all 20
   corpus samples to `hackathon/cache/intent-scores.json` so the live
   demo doesn't depend on Gemma latency.

## Verification gates (local + live)

Before submitting any track:

1. `cd brainsnn-r3f-app && npm run build` — ✅ verified clean (2026-05-06, 2.04s)
2. `cd ui/brainsnn-viewer && npm run build` — ✅ verified clean (1.94s)
3. `cd ui/brainsnn-site && npm run build` — ✅ verified clean (1.97s)
4. `curl -I https://brainsnn.com` → ✅ 200 (Railway us-east4, last deploy 2026-05-02)
5. Live mic test on Layer 59 audio firewall — pending Day 1 (needs real mic)
6. XIO-Evolve dry run: `cd xio_evolve && python -m xio_evolve.pipeline --rounds 3` — pending Day 1
7. MCP bridge tool list: 14 tools returned — pending Day 1
8. Recorded MP4 ≤100 MB at 1080p, ≤5 min, captions verified — pending Day 7

## Submission checklist (May 18–19)

- [ ] All 5 [submissions/](submissions/) write-ups reviewed
- [ ] Recorded MP4 uploaded to lablab.ai for each track entry
- [ ] Live `brainsnn.com` smoke-tested from a clean browser
- [ ] GitHub repo visibility confirmed (public or judge access on the
      `hackathon-techex` branch)
- [ ] Discord channel monitored for judge Q&A through May 19

## Plan reference

Detailed day-by-day plan with risk register lives at:
`/Users/slavaz/.claude/plans/lets-condense-the-plan-scalable-teacup.md`
(local-only; not in repo by design).

## What's been shipped (commit log)

| Commit                                                                 | What                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [bb1bda7](https://github.com/slavazeph-coder/the-brain/commit/bb1bda7) | hackathon/ skeleton + lane contract + 4 corpus samples                           |
| [804e86f](https://github.com/slavazeph-coder/the-brain/commit/804e86f) | Physical AI + Security scenarios + 2 robot prompts                               |
| [a9baf0b](https://github.com/slavazeph-coder/the-brain/commit/a9baf0b) | 100-layer catalog (LAYERS.md) + live verification (VERIFICATION.md)              |
| [1c8fd08](https://github.com/slavazeph-coder/the-brain/commit/1c8fd08) | 13-sample corpus expansion + Security rewrite + scoring report                   |
| [524e722](https://github.com/slavazeph-coder/the-brain/commit/524e722) | Agentic + Enterprise + Data Intelligence scenarios                               |
| (next)                                                                 | INTEGRATION + DEMO_SCRIPT + 5 submissions + 3 intel-corpus docs + README refresh |
