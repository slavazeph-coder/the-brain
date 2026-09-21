---
type: project
description: GT3 automatic logo workflow and gated checkout, with real activation blockers
---

The user requested Spot > Logo > Checkout on www.brainsnn.com/sponsor/gt3/.
The native first-party Porsche renderer remains. Uploads now project automatically
onto one selected panel; no manual placement step. One normalized logo/design is
saved privately with contact details, explicit permission, an idempotent request
and a private HMAC token. No unreviewed brand artwork becomes public.

The GT3-only commerce backend creates Stripe-hosted one-time CAD sessions, uses
server amounts, exclusive SQLite inventory, durable Stripe idempotency, signed raw
webhooks and canonical payment reconciliation. Return parameters cannot mark paid.
Unknown payment outcomes retain inventory, refunds/disputes freeze it for review.
Legacy proposal intake, robot payments and unrelated BrainSNN routes are preserved.

Activation is NOT complete. Reads on 2026-09-21: XIO account
acct_1Sx9KTE2zpmvdOtT is the connected live account; tax settings pending with
head_office missing, active tax registrations empty, product
brainsnn_gt3_sponsorship_2026 inactive with no tax code. BrainSNN Railway has no
runtime Stripe key or GT3 webhook secret. Vehicle access and campaign scope/dates,
funding and refund terms are not confirmed. Do not fabricate these or simply flip
a flag. The UI explicitly saves a checkout request while collection is closed.

Stripe contract tests are mocks. Real model tests and live read-only browser
acceptance are separate. No production leads or payments are created by QA.
Runtime credentials go only into protected Railway variables, never source.
