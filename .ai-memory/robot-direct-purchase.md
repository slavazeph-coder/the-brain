---
type: project
description: Self-service robot image-and-pay flow, no invitation required, with merchant setup gates
---
Direct purchasing uses the existing private sponsorship database and unique placement ledger. Published standard campaign scope/cancellation/version and operational confirmations must be set once in SPONSOR_DIRECT_CAMPAIGN_JSON before the public purchase route can activate. Existing Stripe key/webhook/tax gates still apply. No per-customer manual approval is needed after that standard offer is actually ready. No keys, production records or payment gates changed. Direct holds release only on verified terminal Stripe events; retries preserve a single Stripe idempotency key. Native tests use real disposable SQLite and fake SDK calls, not real Stripe transactions.
