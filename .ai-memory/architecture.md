---
type: project
description: The Brain — repo structure and deployment
---

# Architecture

## Repo

- GitHub: https://github.com/slavazeph-coder/the-brain (private)
- VS Code: open `the-brain.code-workspace`
- Type: collaborative AI workspace built around the BrainSNN 3D brain viewer

## Structure

```
the-brain/
├── brainsnn-r3f-app/              ← the deployable: 100+-layer 3D brain viewer
│   ├── src/                       ← React 18 + R3F frontend
│   │   └── components/brain/      ← Neural flow grid (shaders, FlowTube, PulseWave)
│   ├── server/                    ← FastAPI + TRIBE v2 inference (optional backend)
│   ├── mcp-server/                ← Node stdio MCP bridge for Claude Code / Codex
│   └── package.json
├── ui/
│   └── brainsnn-site/             ← marketing landing page (served at / by Railway)
├── docs/screenshots/              ← panel shots + demo GIF used by the README
├── Dockerfile                     ← Railway image: builds brainsnn-site (/) + app (/app)
├── railway.toml                   ← Railway build/deploy config
├── .ai-memory/                    ← shared AI context (tracked in git)
├── .claude/CLAUDE.md              ← wires Claude to .ai-memory/
├── AGENTS.md                      ← wires Codex to .ai-memory/
└── the-brain.code-workspace       ← VS Code workspace
```

## Deployment

- brainsnn.com is served by **Railway** from the repo-root `Dockerfile`:
  the marketing site (`ui/brainsnn-site`) is served at `/`, and the app
  (`brainsnn-r3f-app`) under `/app`.
- CI/CD: `.github/workflows/brainsnn-app-deploy.yml` runs test → smoke →
  deploy, then healthchecks the live service. Railway also auto-deploys
  pushes to `main` (gated by "Wait for CI").

## AI Wiring

- Claude: reads `.claude/CLAUDE.md` → `.ai-memory/MEMORY.md`
- Codex: reads `AGENTS.md` → `.ai-memory/MEMORY.md`
- VS Code AI tasks embedded in `the-brain.code-workspace`
