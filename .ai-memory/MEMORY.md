# The Brain — AI Memory

> Shared by Claude Code and Codex. Keep under 200 lines.
> Last updated: 2026-04-12

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

### BrainSNN + TRIBE v2 — Started 2026-04-05

3D brain viewer with Meta's TRIBE v2 foundation model for real neural predictions.

**What shipped:**

- React Three Fiber 3D brain with 7 regions (CTX, HPC, THL, AMY, BG, PFC, CBL)
- 3D neural flow grid: GPU-animated TubeGeometry pathways with custom GLSL shaders
- Signal pulse waves radiate through the connectome web when regions fire
- Secondary cross-links between adjacent pathways create mesh/web visual
- Three data modes: Simulation (STDP), TRIBE v2 (real fMRI predictions), Live EEG
- TRIBE v2 FastAPI server: maps fsaverage5 cortical mesh to 7 regions via Desikan-Killiany
- Pre-computed scenario packs (sensory burst, memory replay, emotional salience, executive)
- EEG input via Web Bluetooth (Muse) and Web Serial
- WebM recording + GIF export via FFmpeg.wasm
- Quality tiers: low/high/ultra with PerformanceMonitor auto-switching
- Inspector panel with sparklines, pathway analysis, region details

- Cognitive Firewall: regex-based content manipulation scoring (4 dimensions + evidence)
- Gemma 4 deep analysis engine: AI-powered manipulation detection via Google AI Studio or Ollama
  - Multimodal support: text, images, video, audio
  - Auto-routes through Gemma 4 when VITE_GEMMA_API_ENDPOINT is configured
  - Falls back to regex scoring when API unavailable
  - Supports Google AI Studio API and OpenAI-compatible endpoints (Ollama/vLLM)

- Session Intelligence: brain state snapshots with save/load/compare/export/import/report
- Neural Analytics Dashboard: sparkline trends, Pearson correlation matrix, z-score anomaly detection, threshold alerts
- Neural Narrative Engine: real-time human-readable brain activity narration
- Toast notification system for alerts, exports, mode switches
- Keyboard shortcuts (Space, b, r, 1-3, s, e, q, ?) with help modal
- Share & Embed: shareable URLs with encoded brain state, iframe embed codes, JSON export
- Onboarding walkthrough: 7-step guided tour for first-time users
- Vercel deployment config + .env.example

**Stack:** React 18, Vite, React Three Fiber, Three.js, postprocessing, FastAPI, TRIBE v2, Gemma 4

**18 Layers:**
1. 3D Brain Viewer (R3F)  2. Neural Flow Grid (GLSL)  3. TRIBE v2 (Meta fMRI)
4. Cognitive Firewall (regex)  5. Gemma 4 (AI deep analysis)  6. Snapshots
7. Analytics Dashboard  8. Narrative Engine  9. Toast Notifications
10. Keyboard Shortcuts  11. Share & Embed  12. Onboarding Walkthrough
13. Split Brain View (side-by-side 3D comparison)
14. AI Voice Narrator (Web Speech API)
15. Analysis Plugin System (sentiment, readability, credibility)
16. WebSocket Live Sync (multi-user rooms + chat)
17. Activity Heatmap Timeline (canvas color matrix)
18. Knowledge Brain — Second Brain system (LLM-Wiki framework, gap detection, self-learning)
    - Real file system scanner (find/tree output, Obsidian vault import)
    - LLM-Wiki markdown generator (auto-creates structured wiki from knowledge map)
    - Gemma 4 knowledge intelligence (AI gap analysis, learning path generation)
    - Knowledge mode in 3D viewer (regions relabeled as knowledge domains)
    - Error boundaries around heavy panels
    - Accessibility: focus-visible styles, prefers-reduced-motion, ARIA hints
