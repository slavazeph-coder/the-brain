---
type: project
description: BrainSNN engine-first direction, exact-source comparison API, review boundaries and validation.
---

# BrainSNN engine-first direction — September 2026

The owner corrected the September 8 commercial plan: ignore prior clients, focus any acquisition on new clients, and make repositioning brainsnn.com / strengthening the BrainSNN engine the main objective. Do not resume legacy-client outreach on an ambiguous “next”. XIO is one operational workload, not BrainSNN’s product identity.

## Visual correction — September 9

The owner rejected the muted teal, square-panel homepage as having ruined BrainSNN’s previous colour and feel and become complicated/messy. Restore the pre-PR139 BehaviourHome visual identity (reference8597a4830fcedf5948cf7a04af98aa54191d8963): near-black #05070b, cyan #68eaff, violet #947cff, gradient B mark, pill controls, rounded translucent panels and spacious typography. Strategy/engine improvements are not authorization to replace that visual identity.

`/` now reuses BehaviourHome with the original “Build a mind. Give it a world. Give it a mission.” headline, clear available-tool copy, and three main sections. The detailed prior homepage moves intact to `/office`; it is linked in the footer. Home does not fetch XIO’s operational feed. The comparison workspace retains its functionality with matching colours and rounded controls. Keep technical API contracts and operational ledgers on their dedicated surfaces rather than flooding the homepage. Do not reintroduce old-client outreach or unsupported autonomous-learning claims.

Verification: 889 unit tests, typecheck, production build and compiled comparison API smoke passed. The full production browser suite passed99 tests with five expected viewport skips; final contrast correction also passed the focused desktop/mobile homepage checks. CUA screenshots checked desktop/mobile and refreshed the homepage social card. The first Documents checkout stalled on file I/O; implementation/verification finished in a clean temporary clone, with final GitHub release status recorded in global memory.

## Previous engine-first implementation

The prior homepage led with “An evidence engine for agent work.” Available analysis, Improve edits, browser-local saved versions and proof missions are separated from the future shared-context learning loop. The existing XIO public snapshot and replays are explicitly scoped to that separate experiment. The office remains an illustration rather than invented live activity.

`/engine` and `POST /api/engine/compare` compare exact original/candidate text with the same deterministic local analysis and firewall. The stateless endpoint accepts two nonblank well-formed Unicode strings up to 8,000 UTF-16 units, a 64KB body and strict optional signal-regression limits; existing API rate limits apply. It calls no model provider and persists no input. Records preserve hashes, full text, source quotation offsets, capped-preview flags, observed signals and runtime. IDs cover measured output as well as inputs/configuration. The decision is always REVIEW_REQUIRED; factual verification, market measurement, accepted work and context promotion are false.

The MCP server exposes brain_compare and brain_promotion_check. ResearchDirector now requires evaluated/promoted, trained, benchmark-valid, explicitly leakage-free records with measured score/latency and matching dataset/split. Missing score is never zero. Invalid champions block instead of disappearing; heterogeneous benchmark pools have no global champion. These checks consume caller declarations; they neither authenticate benchmark provenance nor mutate a registry. The Python neural-mirror research path is separate and unchanged.

Next substantive engine milestone: versioned sourced context that a subsequent task actually consumes, with independent outcomes and reversible promotion. This release does not train neural weights or implement general autonomous workers. Existing robotics/streaming spending constraints remain.

Validation during implementation: 888 unit tests, typecheck and production build passed; compiled HTTP and actual stdio MCP smoke passed. Desktop/mobile comparison and homepage checks passed. Use the production build for full browser QA: default dev-server mode omits crawler metadata and concurrent Vite servers collide on HMR port24678. See brainsnn-r3f-app/docs/engine.md for API/MCP setup and limits. Release/deployment status must be checked separately.
