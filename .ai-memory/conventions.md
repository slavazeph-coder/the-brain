---
type: project
description: The Brain — coding conventions and collaboration rules
---

# Conventions

## Memory Updates
- Both AIs write to `.ai-memory/` when they learn something worth keeping
- Update `MEMORY.md` index when adding new topic files
- Keep `MEMORY.md` under 200 lines — detail goes in topic files

## Collaboration
- Claude: architecture, planning, complex reasoning, code review
- Codex: implementation, boilerplate, repetitive edits, tests
- Use `/with-codex <task>` in Claude to split work

## Git
- Commit `.ai-memory/` changes so both AIs stay in sync via git pull
- Short, descriptive commit messages
