# The Brain — AI Instructions

Read `.ai-memory/MEMORY.md` for project context before starting work.
When you learn something useful, append it to the relevant file in `.ai-memory/`.

## Memory format
```
---
type: user | feedback | project | reference
description: one-line description
---
```

## After updating memory
Run `~/.ai-memory/memory-sync.sh --dir .ai-memory/ push` to commit and push.
On session start, run `~/.ai-memory/memory-sync.sh --dir .ai-memory/ pull` to get latest.
