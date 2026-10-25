# Brand Brain V0.2

Brand Brain closes the creative-analysis feedback loop with actual post-publish outcomes while keeping outcome prediction separate from Neural Mirror research.

## Current contract

- Outcome record schema: `brainsnn.outcome.v0.1`
- Creative signature schema: `brainsnn.signature.v0.2`
- Primary production storage: Postgres via `/api/v1/brand-brain/*` when `DATABASE_URL` is available.
- Browser `localStorage` under `brainsnn.outcomes.v1` remains a cache/fallback and migrates records to server persistence when sync returns.
- Anonymous pilot workspaces are separated by a random HttpOnly same-origin cookie. Account/team identity is a later auth layer.
- Comparable history is isolated by brand and outcome metric.
- Supported metrics: ROAS, CTR, conversion rate, watch/retention rate, CPA, CPC, and revenue.
- Historical fit is withheld until at least 3 comparable outcomes exist.
- Descriptive feature associations are withheld until at least 8 comparable outcomes exist.
- CPA and CPC correctly treat lower values as stronger outcomes; other current metrics treat higher values as stronger.

## Neural Mirror relationship

A compact Neural Mirror embedding can be attached to a creative signature for provenance/research. The current production CPU Neural Mirror V0.1 is an **untrained architecture baseline**, so it is excluded from Brand Brain commercial similarity.

Neural Mirror features can influence Brand Brain similarity only after explicit gates pass on both compared signatures:

1. model is trained;
2. model and benchmark metadata state validation against recorded neural data;
3. anatomical/reference mapping is compatible;
4. model id/version/reference representation are compatible;
5. commercial-use provenance/licensing is cleared.

Even after those gates pass, Neural Mirror is only one bounded similarity feature. It does not directly mean CTR, ROAS, purchase intent, persuasion, or revenue.

## Claim boundary

Historical fit is a descriptive nearest-neighbor similarity signal over the brand's saved outcomes. It is not a causal estimate, calibrated probability, or guarantee of future performance. Spearman associations describe the saved sample only and do not establish causes.

## Privacy / persistence boundary

V0.2 does not add raw video, sampled frames, decoded PCM, or Whisper waveform data to Brand Brain history. It stores compact BrainSNN creative signatures, selected outcome metric/value, creative label, brand label, timestamps, and model provenance.

Production persistence is server-side Postgres when healthy. The browser keeps a local cache so a client pilot remains usable during temporary server/storage failures. The current anonymous workspace cookie is suitable for a pilot; authenticated organization/user ownership and cross-browser account recovery are the next persistence layer.

## Customer pilot workflow

1. Scan the creative in BrainSNN.
2. Choose the brand/client and metric the campaign is being optimized for.
3. Publish the creative and collect the actual platform outcome.
4. Save the actual result into Outcome Learning. BrainSNN syncs the compact record to the current Postgres workspace when available.
5. After 3 comparable outcomes, use Historical Fit and nearest saved creatives as directional test-prioritization evidence.
6. After 8 comparable outcomes, inspect descriptive feature associations as hypotheses for the next creative iteration.
7. As independently trained Neural Mirror models become benchmarked/licensed, their eligible representations can be introduced without changing the Brand Brain workflow.

Brand Brain should be presented as a decision-support and learning layer, not as a guaranteed ad-performance predictor.
