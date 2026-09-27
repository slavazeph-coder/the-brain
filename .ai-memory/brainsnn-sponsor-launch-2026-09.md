---
type: project
description: Sponsor Studio launch handoff and remaining operational gates
---

The user approved the XIO midnight Sponsor Studio and asked to continue. Preserve the theme, real G1 geometry, catalogue prices, server-side applications and approval-gated payments.

This pass adds a small homepage/footer doorway, public placement-only share links and downloadable plain-text application confirmations after the existing server-confirmed success transition. No applicant email, company, artwork, private reference or checkout token is included in a shared URL. Confirmation files explicitly distinguish an application from a reservation, invoice or payment. No new tracking, dependencies or persistent browser data.

Native tests cover invalid links and privacy. Dedicated browser tests use only isolated temporary databases, never production submissions or transactions. Existing Sponsor Studio regression checks remain unchanged.

Verified before this pass: canonical www.brainsnn.com/sponsor/ and application API responding; eight slots open; owner endpoint401; one replica with /data volume. Bare brainsnn.com/sponsor/ still404. Runtime SPONSOR_STRIPE_SECRET_KEY and SPONSOR_STRIPE_WEBHOOK_SECRET absent. SPONSOR_PAYMENTS_ENABLED remains disabled. No automatic confirmation email integration. The previously connected Stripe account had no active Tax registrations configured; confirm again with merchant/accountant before activation. Do not infer CRA registration from Stripe state.

Production payment enablement requires secure runtime keys, signed webhook configuration, applicable tax review, real test-mode scenarios and agreed campaign scope. Do not disclose keys or silently enable charges. Apex redirect/DNS requires registrar access. No mailbox delivery was added by this pass.
