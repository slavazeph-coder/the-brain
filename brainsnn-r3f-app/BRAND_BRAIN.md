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
