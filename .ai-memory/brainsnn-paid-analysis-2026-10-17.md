---
type: project
description: Prepaid Gemini episode analysis, cost controls, deployment gates and credential isolation
---

# Paid Arena analysis — 2026-10-17

The owner approved implementation, merge and deployment of a separate BrainSNN
analysis package: C$50 prepaid, fixed accepted quotes (minimum C$2), no automatic
top-ups or promised analysis count, target at least50% contribution margin under
configured cost bounds. Failures are not charged to customers; a separate owner
reserve bounds failed/uncertain provider costs. This is not a guarantee of net
profit under refunds, disputes or unmodeled costs.

Implementation is in `brainsnn-r3f-app/arena-analysis/` and the optional panel in
`public/arena/arena-analysis.js`, mounted inside existing Inspect. Selected camera
frames and bounded telemetry produce evidence-linked Gemini hypotheses/experiments,
not robot control, training, a score or a certified diagnosis. Original manifests
remain unchanged; sidecars bind to source hashes and exact selected input digest.

Use dedicated `ARENA_ANALYSIS_GEMINI_API_KEY`, never legacy `GEMINI_API_KEY`:
the latter would also enable older public endpoints. Use dedicated
`ARENA_ANALYSIS_STRIPE_KEY` + webhook secret. SQLite lives on the existing /data
volume with exactlyone process/replica; test/live mode is permanently pinned.
Stripe settled CAD fees must be known before funding becomes spendable.

Quotes bound32k input/32768 combined generated tokens,6observations/12images512px,
20% contingency and full input/output/thinking at leastUS$4/20 per million.
Current configured rates/FX must cover20min (10min quote+10min execution).
One provider call, no retries; unknown costs retain the internalhold and freeze
that workspace.7day sidecar/metadata retention; no inputpixels stored inledger.
Google provider retention is separate and linked beforeupload acceptance.

Code can be deployed disabled. At implementation time Railway production had
none of the dedicated analysis credentials/configuration; Stripe connection
required reauthentication. No paid provider or payment call was made. Activate
only after actual delivery/usage validation, sandbox fulfillment/replay/refund
checks, livepayment setup, currenttax/rate/FX review, fundedfailure reserve and
verified persistentbackup. See `arena-analysis/README.md` and `ADMIN.md` for
configuration, smoke gates and audited localreconciliation.
