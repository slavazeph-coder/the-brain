# BrainSNN Project Review

Implemented on `codex/world-project-review-20261118`, based on `d4dd4be`.
See `docs/world-project-review.md` and the exact API contract in
`docs/world-project-review-contract.md`.

## Entry points and scope

- World Builder's **Review this project** opens the shared studio on the selected
  retained job's exact verified `scene.json` bytes. `/world/review.html` supports
  an original compiled scene file or an explicitly authored example.
- Initial scope is preliminary wall/floor finish alternatives, not arbitrary
  CAD generation. Source geometry remains unchanged. Quantities are inferred
  from compiler components, with validated hosted-opening deductions.
- Four editable rate rows start empty and unreviewed. Priced lines require
  amounts, source, date and a human rate review. Missing prices remain unpriced;
  the known subtotal is not represented as a complete estimate.

## Trust and execution boundaries

- `public/world/project-review.mjs` prepares immutable source/brief/rate inputs,
  validates component/rate references, calculates integer-cent line totals and
  hashes the complete approval/export report. Do not let model quantities or
  totals replace the deterministic calculations.
- Local comparisons are fixed templates and explicitly do not call an AI model.
- `src/server/projectReview.js` uses the existing owner session, explicit send
  consent and an injected model provider. Sequence: planner, code pricing,
  estimator, at most one planner revision and repricing, final reviewer. Maximum
  four provider calls. Recorded transcripts contain actual completed stages.
- `server.ts` supplies Gemini with zero hidden retries, the process spend ceiling,
  cancellation and a per-call timeout. Settings: `WORLD_REVIEW_ENABLED`,
  `WORLD_REVIEW_MODEL` with existing `GEMINI_MODEL` fallback. No browser API key.
- Owner-only model execution is separate from visitor/worker credentials.
  Request/concurrency/deadline/hourly budgets are per process. A provider that
  ignores cancellation retains its compute slot until it settles.
- Human approval is self-reported preliminary scope review, bound to exact input
  and report hashes. It never upgrades metric, certification, physical robot or
  final-quotation validation. Changes must invalidate calculations and approval.
- Proposal HTML escapes all project/model strings and embeds the complete inert
  receipt. JSON preserves source metadata, rates, quantities and team trace.

## Verification boundaries

`tests/world/project-review.test.mjs` checks calculations, source binding and
approval/export invariants. Server tests exercise real loopback HTTP with an
explicit fixture provider. `tests/world/project-review-browser-smoke.mjs` covers
desktop/phone UI, owner sessions, rates, downloads, cancellation and stale
decisions with authored provider output. The unified workspace browser test
covers retained-job integration. CI runs Chromium and WebKit.

These fixtures do not qualify real provider quality, camera reconstruction,
measured dimensions, market prices, a signed approval identity or production
deployment. Keep these claims distinct when reporting results.

The repository's optional `~/.ai-memory/memory-sync.sh` helper was absent in the
implementation environment; the memory update travels with the normal git change.
