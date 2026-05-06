# BrainSNN @ TechEx Hackathon

**Event**: Transforming Enterprise Through AI (TechEx, lablab.ai)
**Window**: 2026-05-11 → 2026-05-19
**Mode**: Online submission (recorded MP4 + live URL + per-track write-ups)
**Branch**: `hackathon-techex`
**Live URL**: https://brainsnn.com (Railway, us-east4)
**Prize pool**: $10K across 5 tracks

---

## Why this folder exists

Everything that's hackathon-only lives in `hackathon/`, isolated from the
main product surface. That keeps `main` clean for ongoing BrainSNN
development while we layer demos, scripts, scenarios, and submission copy
on top of the existing 35+ layers.

## Folder map

```
hackathon/
├── README.md              ← you are here
├── demo-corpus/           ← input samples used in stage demos
│   ├── phishing/          ← Security track
│   ├── marketing/         ← Enterprise Problem-Solving track
│   ├── robot-prompts/     ← Physical AI track
│   ├── ar-overlays/       ← Physical AI track
│   └── business-scenarios/← Enterprise Problem-Solving track
├── scenarios/             ← multi-turn demo scripts (per-track stories)
├── submissions/           ← per-track lablab.ai write-ups
└── DEMO_SCRIPT.md         ← end-to-end 5-min recorded demo flow
```

## Two-AI lane contract

Both Claude (in `claude` CLI) and Codex (in `codex` CLI / PenguineWalkOS
on GitHub) work on this branch. To avoid stepping on each other:

| Lane                        | Owner  | Folders                                                                                                                       |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| UI / scenarios / collateral | Claude | `hackathon/`, `brainsnn-r3f-app/src/components/LiveMicCapture.jsx` (new)                                                      |
| Deploy / extensions         | Codex  | `brainsnn-r3f-app/server/`, `brainsnn-r3f-app/src/utils/firewallIntent.js` (new), `Dockerfile`, `railway.toml`, Fly.io config |

**Sync ritual** (every evening or session end):

1. `git pull --rebase origin hackathon-techex`
2. Append a dated entry under "## Hackathon-TechEx Active Work" in
   `.ai-memory/MEMORY.md` describing what landed and what's next.
3. `git push origin hackathon-techex`

**Conflict resolution**: whoever picks up the conflict first resolves it.
Don't force-push.

## Track mapping (v2 plan)

| Track                         | What we already have                                                                               | What we're adding                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Enterprise Problem-Solving    | Cognitive Firewall + Gemma 4 multimodal + 35 layers                                                | Customer-service scenario script (5-min)    |
| Enterprise Security           | Layer 4 (Cognitive Firewall), L25 (Red Team), L27 (Adversarial), L32 (Attack Evolve)               | Intent classifier upgrade + phishing corpus |
| Agentic AI Workflows (Gemini) | XIO-Evolve (Python L→D→E→A loop), L21 (Brain Steward), L19 (MCP Bridge with 14 tools)              | Demo of XIO-Evolve evolving firewall rules  |
| Physical AI & Robotics        | 3D BrainSNN viz (R3F, 35 layers), Gemma 4 file-upload audio                                        | `LiveMicCapture` component (`getUserMedia`) |
| Enterprise Data Intelligence  | L18 (Knowledge Brain), L33 (Multimodal RAG), L34 (Vector-Graph Fusion), Neural Analytics Dashboard | Polish + scenario wrapper                   |

## Verification gates (local + live)

Before submitting any track:

1. `cd brainsnn-r3f-app && npm run build` — ✅ clean
2. `cd ui/brainsnn-viewer && npm run build` — ✅ clean
3. `cd ui/brainsnn-site && npm run build` — ✅ clean
4. `curl -I https://brainsnn.com` → 200
5. Live mic test on Physical AI scene
6. XIO-Evolve dry run: `cd xio_evolve && python -m xio_evolve.pipeline --rounds 3`
7. MCP bridge tool list: 14 tools returned
8. Recorded MP4 ≤100 MB at 1080p, ≤5 min, captions verified

## Submission checklist (May 18–19)

- [ ] All 5 `submissions/*.md` write-ups reviewed (≤500 words each)
- [ ] Recorded MP4 uploaded to lablab.ai for each track entry
- [ ] Live `brainsnn.com` smoke-tested from a clean browser
- [ ] GitHub repo visibility confirmed (public or judge access)
- [ ] Discord channel monitored for judge Q&A through May 19

## Plan reference

Detailed day-by-day plan with risk register lives at:
`/Users/slavaz/.claude/plans/lets-condense-the-plan-scalable-teacup.md`
