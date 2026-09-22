---
type: project
description: Self-service robot image-and-pay flow, no invitation required, with merchant setup gates
---
Direct purchasing uses the existing private sponsorship database and unique placement ledger. Published standard campaign scope/cancellation/version and operational confirmations must be set once in SPONSOR_DIRECT_CAMPAIGN_JSON before the public purchase route can activate. Existing Stripe key/webhook/tax gates still apply. No per-customer manual approval is needed after that standard offer is actually ready. No keys, production records or payment gates changed. Direct holds release only on verified terminal Stripe events; retries preserve a single Stripe idempotency key. Native tests use real disposable SQLite and fake SDK calls, not real Stripe transactions.

2026-09-22 checkout recovery: `/quote` now publishes `canResumeCheckout` and `/checkout` accepts `resumeOnly:true`. Pending/direct orders can only reopen an attached, valid Stripe session with more than 60 seconds remaining. Legacy session creation revalidates unchanged approved state and invitation under the SQLite write lock; ambiguous failures retain the attempt and inventory hold. Known signed events arriving before session attachment return retryable 503 without dedupe. Tested with disposable SQLite, competing-connection races and mock Stripe calls; no live charging validated. XIO frontend repair is tracked in XioAISolutions/XIO-AI-EXO PR19. Merchant credentials, webhook, tax and actual campaign terms remain required before live payment activation.

