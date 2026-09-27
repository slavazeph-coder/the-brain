# BrainSNN GT3: Spot > Logo > Checkout

## Current release state

The code adds automatic on-car artwork and a guarded Stripe-hosted payment flow.
It does not itself activate collection. On 2026-09-21 the connected live XIO
account had pending Tax settings (head_office missing), no active tax registrations,
and inactive product brainsnn_gt3_sponsorship_2026 with no tax code. BrainSNN's
Railway variable names contained no Stripe runtime key or GT3 webhook secret.
Vehicle access, campaign dates/deliverables, funding and refund conditions are
not confirmed. The public CTA must remain a private checkout request until those
facts are settled. Do not claim a green mock test verifies a live transaction.

## User flow

Choose one of eight panels, upload PNG/JPG/WebP (2 MB maximum), or enter lettering.
The actual local Porsche geometry receives a projected decal automatically. The
same design moves with the chosen panel; one canvas and texture are reused.
Optional size is 60–140%. This is a visualization, not measured print artwork.

Review shows the artwork and server price with name, company and email. Explicit
permission saves a normalized 512x256 PNG, chosen zone/size, contact information
and artwork SHA to private SQLite. The original image stays local. No unreviewed
logo is published to other visitors and no automatic request email is sent.

When launch gates are satisfied, the same form opens hosted Stripe Checkout.
There is no raw card handling on BrainSNN. Dynamic eligible payment methods are
managed in Stripe. The app does not override them with payment_method_types.
Stripe receives only order and artwork hashes, not uploaded image bytes.

## Runtime setup (protected variables only)

Use the existing single-replica service and /data volume. Do not change robot
payment flags, DNS, replicas or the existing sponsor webhook. Set only:

- GT3_STRIPE_KEY: a dedicated least-privilege restricted Stripe API key.
- GT3_STRIPE_WEBHOOK_SECRET: a dedicated endpoint's signing secret.
- GT3_CAMPAIGN_JSON: reviewed owner-approved campaign offer described below.
- GT3_PAYMENTS_ENABLED: leave false until all acceptance and owner setup finish.

The existing SPONSOR_SESSION_SECRET must be durable. Do not rotate it casually:
it signs private order capabilities as well as sessions. Runtime keys belong in
protected Railway variables, never in this document, GitHub, frontend or chat.

The lazy Stripe SDK comes from the already installed sponsorship dependency.
Runtime API version is 2026-07-29.dahlia. Validate supported parameters and RAK
permissions in a real connected sandbox before adding the live key. Required
operations include account/product reads, Tax settings/registrations reads,
Checkout Session create/read and expanded payment/charge reads. Do not use live
customer charges as automated tests.

## Approved campaign offer

GT3_CAMPAIGN_JSON must contain approved:true and nonempty version, merchant,
businessAddress, starts, ends, deliverables, refundPolicy and fundingPolicy.
Dates must be parseable with ends after starts and in the future. These values
are presented before payment and their hash is attached to each session.

Use the correct legal seller, confirmed access/insurance, exact term and content
scope, cancellation and refund conditions, and the minimum funding/purchase
conditions. Do not paste invented examples into production. This release does
not automatically enforce all-or-nothing campaign funding or purchase a car.
The owner must implement any promised conditional-funding refunds operationally
before selling that offer. Payment completion reserves a placement, not a car.

Verify actual tax obligations with the owner/advisor. Configure the real head
office and only registrations already held with the relevant authority. Record
and approve the product tax classification from Stripe's canonical tax-code
list. Activate the existing product only after review. The automatic readiness
check requires the correct charge-enabled XIO account, active product, reviewed
nonzero tax code, active Tax settings/head office and an active CA registration.
This is not a complete worldwide tax-obligation determination.

## Dedicated webhook

Create a new endpoint, do not replace existing ones:
https://www.brainsnn.com/api/gt3/stripe/webhook

Subscribe to checkout.session.completed, checkout.session.expired,
checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
charge.refunded, charge.dispute.created and charge.dispute.closed.
The server verifies the exact raw body HMAC with five-minute timestamp tolerance
and deduplicates event IDs. It fetches canonical Stripe Session/payment data
before marking anything paid. A redirect query never establishes payment.

## Inventory and recovery

SQLite BEGIN IMMEDIATE and a unique zone key prevent two orders obtaining the
same panel. Parameters and a stable idempotency key are persisted before creating
a session. A network timeout retains the hold; a retry reuses the same request.
Only a Stripe-confirmed expired unpaid session releases it. Async processing
retains the hold. Refunds and disputes freeze the order for manual review, not
resale. Automatic refunds are not implemented. A stale uncertain creation over
roughly one hour needs owner reconciliation; never delete its inventory row
until Stripe has definitively ruled out a charge.

Private return capabilities are in the URL fragment and sessionStorage, not query
parameters or public logs. Treat them as confidential links. Their saved design
can be restored after a redirect/reload. Do not share these capabilities publicly.
Draft requests are purged after 180 days on access, bounded to 200 drafts. Paid
transaction data is retained for accounting/support; define a separate backup
and transactional record-retention policy before launch.

## Owner operations

/sponsor/gt3/admin.html now lists saved design requests and legacy proposals.
Use the existing sponsor owner key; it stays in tab memory only for authenticated
PNG downloads. Close the tab when finished. This screen never takes payments.

GET /api/gt3/admin/orders: readiness reasons and private order summaries.
GET /api/gt3/admin/artwork?id=UUID: authenticated PNG attachment.
POST /api/gt3/admin/reconcile: {id}; owner header plus valid GT3 CSRF session.
POST /api/gt3/admin/order-delete: {id}; draft only, owner plus CSRF.
Legacy proposals and robot orders remain separate and unchanged.

## Verification and rollback

Run node --test sponsorship/tests/gt3.test.cjs sponsorship/gt3/tests/checkout.test.cjs
and node sponsorship/gt3/tests/native.mjs after the existing model build.
Payment tests use an injected fake Stripe client with real isolated SQLite.
Native tests use actual model/texture geometry in full Chromium, not a mock car.
Published acceptance is GET-only: it uploads a logo locally to the canvas but
never sends a production lead or payment. Physical iPhone performance is a
separate check, not proven by mobile viewport screenshots.

Before activation verify real sandbox success, decline, SCA, cancellation,
expiration, delayed payment, duplicate webhook, tampered signature, concurrent
buyers, restart persistence, refund/dispute behavior and actual tax line items.
Check account/payment amounts independently and confirm receipts/operational
fulfillment. Then set the separate GT3 flag, verify the public offer and checkout,
and retain a fast shutoff. Setting GT3_PAYMENTS_ENABLED=false blocks new sessions;
existing Stripe sessions must be expired or reconciled separately. Never assume
a local feature flag retroactively cancels an already-issued hosted checkout.
