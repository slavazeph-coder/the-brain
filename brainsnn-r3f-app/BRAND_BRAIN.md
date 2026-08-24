# Brand Brain V0.1

Brand Brain closes the creative-analysis feedback loop with actual post-publish outcomes.

## Current contract

- Outcome record schema: `brainsnn.outcome.v0.1`
- Creative signature schema: `brainsnn.signature.v0.1`
- Storage: browser-local `localStorage` under `brainsnn.outcomes.v1`
- Comparable history is isolated by brand and outcome metric.
- Supported metrics: ROAS, CTR, conversion rate, watch/retention rate, CPA, CPC, and revenue.
- Historical fit is withheld until at least 3 comparable outcomes exist.
- Descriptive feature associations are withheld until at least 8 comparable outcomes exist.
- CPA and CPC correctly treat lower values as stronger outcomes; other current metrics treat higher values as stronger.

## Claim boundary

Historical fit is a descriptive nearest-neighbor similarity signal over the brand's saved outcomes. It is not a causal estimate, calibrated probability, or guarantee of future performance. Spearman associations describe the saved sample only and do not establish causes.

## Privacy boundary

V0.1 does not add raw video to Brand Brain history. It stores the compact BrainSNN creative signature, selected outcome metric/value, creative label, brand label, timestamps, and model provenance in the current browser.

## Customer pilot workflow

1. Scan the creative in BrainSNN.
2. Choose the brand/client and the metric the campaign is being optimized for.
3. Publish the creative and collect the actual platform outcome.
4. Return to the same browser and save the actual result into Outcome Learning.
5. After 3 comparable outcomes, use Historical Fit and the nearest saved creatives as directional test-prioritization evidence.
6. After 8 comparable outcomes, inspect descriptive feature associations as hypotheses for the next creative iteration.

Brand Brain should be presented as a decision-support and learning layer, not as a guaranteed ad-performance predictor.


## Server-backed pilot persistence

Customer pilot history is persisted by the Express API under `/api/brand-brain` when `DATABASE_URL` is configured. The browser stores only an opaque workspace id and bearer capability token plus a one-time legacy-import marker. The server stores only a SHA-256 token hash and verifies it with timing-safe comparison.

Production has no silent memory fallback. If the database is absent or unreachable, `/api/brand-brain/status` reports the persistence failure and the client disables save behavior rather than claiming the outcome was stored. A memory store exists only when `NODE_ENV` is not `production` and `BRAND_BRAIN_MEMORY_FALLBACK=1`.

Outcome data is descriptive evidence for a brand's own history. BrainSNN does not infer causality or convert a small sample into a guaranteed ROAS/CTR/CPA outcome. Neural-response representations and commercial outcome signals remain separate.
