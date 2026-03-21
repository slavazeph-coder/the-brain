# The Brain — AI Memory

> Shared by Claude Code and Codex. Keep under 200 lines.
> Last updated: 2026-03-16

## Purpose

Central AI workspace — OpenClaw hub, agent library, and UI. Claude + Codex collaborate here.

## Architecture

→ see [architecture.md](architecture.md)

## Conventions

→ see [conventions.md](conventions.md)

## OpenClaw Status

- Gateway: running at ws://127.0.0.1:18789
- Version: 2026.3.11
- Agents: main, imessage
- Cron jobs: workspace-git-sync (3h), memory-cleanup-weekly, daily-self-review

## Active Work

<!-- Both AIs append notes here as they work -->

### PenguinWalk Arena — Shipped 2026-03-21

Club Penguin-style AI debate arena live at https://penguinwalk.co

**What shipped:**

- ArenaHome with 3D animated penguins (React Three Fiber + @react-spring/three)
- 10 animation states with spring physics (waddle, belly flop, dizzy, snowball, etc.)
- Battle card chat UI with per-model colors and personality system
- Pre-scripted demo debates (zero LLM cost, SSE replay)
- 4-tier monetization: Demo → Free (3 credits) → Basic $19/mo → Pro $49/mo
- Tier-gated debate route with dynamic model selection per tier
- TierGate auth modal, CreditMeter, pricing page
- Stripe checkout/webhook stubbed (ready to wire)
- Railway Postgres added, schema deployed

**Next up:**

1. Rigged GLTF penguin models (biggest visual jump — replace coded geometry with bone-rigged .glb)
2. Interactive environment (ice rink, snowfall, audience NPCs)
3. Content-reactive animations (sentiment → expressions, @mention reactions)
4. Stripe keys + real payments
5. Sound design (typing, victory jingle, crowd reactions)
