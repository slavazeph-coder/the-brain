---
type: project
description: The Brain — workspace structure and layout
---

# Architecture

## Repo
- GitHub: https://github.com/slavazeph-coder/the-brain
- Local: /Users/slavaz/the-brain
- Type: collaborative AI workspace — no fixed stack yet, grows with tasks

## AI Wiring
- Claude: reads `.claude/CLAUDE.md` → imports `.ai-memory/MEMORY.md`
- Codex: reads `AGENTS.md` → imports `.ai-memory/MEMORY.md`
- Both AIs share `.ai-memory/` as project context
- VS Code tasks available globally (see `~/Library/Application Support/Code/User/tasks.json`)

## Structure
```
the-brain/
├── .ai-memory/        ← shared AI context (tracked in git)
│   ├── MEMORY.md      ← index
│   ├── architecture.md
│   └── conventions.md
├── .claude/
│   └── CLAUDE.md      ← wires Claude to .ai-memory/
├── AGENTS.md          ← wires Codex to .ai-memory/
└── README.md
```
