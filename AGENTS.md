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
Run `git add .ai-memory/ && git commit -m "memory: <what changed>" && git push`
so the other AI can pull the latest context.
