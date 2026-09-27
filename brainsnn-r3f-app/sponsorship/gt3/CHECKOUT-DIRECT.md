# Direct GT3 checkout update

This extends CHECKOUT-OPERATIONS.md. All activation, credential, campaign, tax,
webhook and inventory safeguards there still apply. Nothing in this release
enables live payment collection or creates actual payment transactions.

## Customer flow

Choose space, upload logo (or enter brand text), accept artwork/offer terms,
continue directly to hosted Stripe Checkout. No name/company/email dialog appears
on BrainSNN during an open paid offer. Stripe collects contact/payment details
once. The approved campaign offer remains visible before consent.

When collection is closed, the same page explicitly offers a private non-binding
design request and asks only for an email. It is not a paid reservation. Prices
remain unchanged planning floors, not auction bids or a revenue guarantee.

The visible selector is a keyboard-operable glass listbox. The hidden original
select remains solely to retain the native renderer's event contract. No iframe,
additional 3D renderer, external fonts or runtime asset hosts were introduced.

## API and persistence

POST /api/gt3/designs uses the same signed session/CSRF, bounded PNG validation,
request idempotency and SQLite storage. intent=pay requires actual payment
readiness and the exact accepted terms hash before an anonymous design is saved.
intent=request requires a valid email. The old /orders validation is unchanged;
a client cannot bypass it by adding intent flags.

After saving, the existing protected /checkout endpoint creates or reuses the
exclusive hosted session. A lost response reuses the durable order/session keys.
Canonical verified session data, not redirect parameters, supplies payer contact
information. Contact updates do not change the original immutable order digest
or break the private return capability.

Customer artwork remains private. No buyer logo becomes a public sponsor claim.
All pre-existing tax, product, campaign and credential launch gates remain closed
until the owner actually configures and approves them. An inactive live product,
pending tax settings or missing credentials cannot be bypassed from this UI.

## Verification

Run the original GT3/backend tests plus tests/direct.test.cjs. The latter uses
mocked Stripe with real isolated SQLite. tests/native.mjs validates actual model
geometry, automatic decals, menu keyboard behavior, responsive layout, illustrated
use-case cards, email-only intake and a mocked hosted-checkout round trip.

production-readonly.mjs runs the same applicable checks against the published
site, restricted to GET/HEAD. Its local image upload is only a browser preview,
not a production customer submission. No automated live charges are performed.

Use-case cards are illustrative concepts, not client case studies. Vehicle access,
venue permissions, dates, deliverables and performance need separate confirmation.
