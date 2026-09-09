---
type: project
description: BrainSNN engine-first direction, exact-source comparison API, review boundaries and validation.
---

# BrainSNN engine-first direction — September 2026

The owner corrected the September 8 commercial plan: ignore prior clients, focus any acquisition on new clients, and make repositioning brainsnn.com / strengthening the BrainSNN engine the main objective. Do not resume legacy-client outreach on an ambiguous “next”. XIO is one operational workload, not BrainSNN’s product identity.

The homepage leads with “An evidence engine for agent work.” Available analysis, Improve edits, browser-local saved versions and proof missions are separated from the future shared-context learning loop. The existing XIO public snapshot and replays are explicitly scoped to that separate experiment. The office remains an illustration rather than invented live activity.

`/engine` and `POST /api/engine/compare` compare exact original/candidate text with the same deterministic local analysis and firewall. The stateless endpoint accepts two nonblank well-formed Unicode strings up to 8,000 UTF-16 units, a 64KB body and strict optional signal-regression limits; existing API rate limits apply. It calls no model provider and persists no input. Records preserve hashes, full text, source quotation offsets, capped-preview flags, observed signals and runtime. IDs cover measured output as well as inputs/configuration. The decision is always REVIEW_REQUIRED; factual verification, market measurement, accepted work and context promotion are false.

The MCP server exposes brain_compare and brain_promotion_check. ResearchDirector now requires evaluated/promoted, trained, benchmark-valid, explicitly leakage-free records with measured score/latency and matching dataset/split. Missing score is never zero. Invalid champions block instead of disappearing; heterogeneous benchmark pools have no global champion. These checks consume caller declarations; they neither authenticate benchmark provenance nor mutate a registry. The Python neural-mirror research path is separate and unchanged.

Next substantive engine milestone: versioned sourced context that a subsequent task actually consumes, with independent outcomes and reversible promotion. This release does not train neural weights or implement general autonomous workers. Existing robotics/streaming spending constraints remain.

Validation during implementation: 888 unit tests, typecheck and production build passed; compiled HTTP and actual stdio MCP smoke passed. Desktop/mobile comparison and homepage checks passed. Use the production build for full browser QA: default dev-server mode omits crawler metadata and concurrent Vite servers collide on HMR port24678. See brainsnn-r3f-app/docs/engine.md for API/MCP setup and limits. Release/deployment status must be checked separately.
