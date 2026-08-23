---
type: project
description: The Brain — repo structure and deployment
---

# Architecture

## Repo

- GitHub: https://github.com/slavazeph-coder/the-brain
- VS Code: open `the-brain.code-workspace`
- Type: collaborative AI workspace built around BrainSNN creative decision intelligence and interactive brain/neural visualizations

## Structure

```
the-brain/
├── brainsnn-r3f-app/              ← primary deployable React/Vite + Express app
│   ├── src/                       ← product UI, analysis engines, multimodal client workflow
│   │   ├── features/scan/         ← scan composer, browser-local video/audio/STT inputs
│   │   ├── features/results/      ← decision brief and client presentation views
│   │   └── lib/                   ← deterministic analysis, fusion, transcript/audio helpers
│   ├── mcp-server/                ← Node stdio MCP bridge
│   ├── Dockerfile                 ← app image used by Railway service
│   └── package.json
├── docs/                          ← repo/project documentation
├── railway.toml                   ← Railway build/deploy config
├── .ai-memory/                    ← shared AI context (tracked in git)
├── .claude/CLAUDE.md              ← wires Claude to .ai-memory/
├── AGENTS.md                      ← wires Codex to .ai-memory/
└── the-brain.code-workspace       ← VS Code workspace
```

The current `brainsnn-r3f-app` backend is the bundled Express `server.ts`; older references to a committed `brainsnn-r3f-app/server/` FastAPI TRIBE service are stale and should not be treated as current main-branch structure.

## Deployment

- `www.brainsnn.com` is served from Railway.
- The active Railway service builds `brainsnn-r3f-app/Dockerfile`.
- CI runs TypeScript checking, tests, production build, and MCP smoke coverage before changes are merged.
- Railway auto-deploys the connected `main` branch and healthchecks `/healthz`.

## Multimodal video path

### V0.3 browser-local speech-to-text

The video workflow can now generate captions locally in the browser:

- Visual frames are sampled in-browser.
- Audio is decoded to mono PCM in-browser for the energy/dynamics envelope.
- Optional speech-to-text uses Transformers.js 3.8.1 with `Xenova/whisper-tiny.en`, selected because its export supports word-level timestamps in the current browser runtime.
- Whisper receives 16 kHz Float32 mono audio and requests word-level timestamps.
- WebGPU is preferred when available; browser WASM/CPU is the fallback.
- Raw video, pixel buffers, and decoded PCM are not sent to an external speech service by this layer.
- The generated transcript and compact visual/audio features do enter the normal BrainSNN analysis payload.

Transcript timing provenance is explicit:

- `supplied`: operator-provided SRT/VTT/timecodes.
- `local-asr`: browser-local speech model output; timestamps are model-generated review cues and must be verified for critical edits.
- `estimated`: plain transcript aligned heuristically across known video duration.

The client presentation layer must preserve those distinctions and must never label local-ASR timing as measured or user-supplied ground truth.

Detailed implementation and smoke-test instructions live in `brainsnn-r3f-app/docs/local-speech-to-text-v0.3.md`.

## AI Wiring

- Claude: reads `.claude/CLAUDE.md` → `.ai-memory/MEMORY.md`
- Codex: reads `AGENTS.md` → `.ai-memory/MEMORY.md`
- VS Code AI tasks embedded in `the-brain.code-workspace`
