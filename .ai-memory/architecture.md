---
type: project
description: The Brain — workspace structure, OpenClaw setup, and submodules
---

# Architecture

## Repo

- GitHub: https://github.com/slavazeph-coder/the-brain (private)
- Local: /Users/slavaz/openclaw-workspace/the-brain
- VS Code: open `the-brain.code-workspace` for multi-root view
- Type: collaborative AI workspace — no fixed stack yet, grows with tasks

## Structure

```
the-brain/
├── agents/
│   ├── awesome-openclaw-agents/   ← 177 agent templates (SOUL.md format)
│   │   └── agents.json            ← machine-readable catalog
│   └── openclaw-agents/           ← 9-agent orchestration system
│       ├── setup.sh               ← one-command install
│       └── agents.yaml            ← routing + definitions
├── ui/
│   └── openclaw-office/           ← React 19 + Vite dashboard UI
│       └── pnpm dev               ← starts dev server
├── .ai-memory/                    ← shared AI context (tracked in git)
├── .claude/CLAUDE.md              ← wires Claude to .ai-memory/
├── AGENTS.md                      ← wires Codex to .ai-memory/
└── the-brain.code-workspace       ← VS Code multi-root workspace
```

## Submodules

All three external repos are git submodules — update with:

```bash
git submodule update --remote
```

## OpenClaw

- Binary: /opt/homebrew/bin/openclaw (v2026.3.11)
- State: ~/.openclaw/
- Config: ~/.openclaw/openclaw.json
- Gateway: ws://127.0.0.1:18789 (launchd service)
- Logs: ~/.openclaw/logs/gateway.log

## AI Wiring

- Claude: reads `.claude/CLAUDE.md` → `.ai-memory/MEMORY.md`
- Codex: reads `AGENTS.md` → `.ai-memory/MEMORY.md`
- VS Code tasks embedded in `the-brain.code-workspace` (OpenClaw + AI tasks)
