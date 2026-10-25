> Public-site retirement: The robot campaign now lives only on https://www.xioai.ca/robot-sponsorship/. The BrainSNN Express preload permanently redirects its old public index, checkout and privacy URLs, and the BrainSNN home no longer advertises Robot 001. The shared /api/sponsors service and owner admin remain in place for XIO. Source assets and standalone regression fixtures are retained for compatibility, not exposed as the production page. Payment settings, customer data and the separate GT3 campaign are unchanged.

# BrainSNN Sponsor Studio

Additive production route: `/sponsor/`. It does not replace BrainSNN's existing tools or homepage.

## Delivery

- A responsive, restrained graphite/pearl/cobalt design.
- Actual Unitree G1 reference meshes, pinned to official repository revision `ccfc6fd8430a17ba3dacef9a1e2faf64ff3b0aee`, reconstructed from the G1 23-DOF URDF. Display-only vertex clustering reduces geometry size. Upstream LICENSE is served alongside the model. Cosmetic materials are illustrative.
- Three.js on-surface decals, per-placement brand text/logo, colour, sizing and rotation; front/back/side/orbit and concept PNG export.
- Private applications stored in a separate SQLite database on Railway's `/data` persistent volume. No memory-storage fallback.
- An access-controlled owner dashboard at `/sponsor/admin/`; it lists real applications, supports logo review, approval, decline and deletion.
- Stripe Checkout under either a merchant-published fixed-price campaign or a private approved agreement. No invented bidders, logos, audience claims or deployed-fleet counts.

## Local run

From `brainsnn-r3f-app`:

```
npm ci
npm install --prefix sponsorship --omit=dev --no-audit --no-fund
node sponsorship/build.cjs
SPONSOR_PUBLIC_ORIGIN=http://localhost:8091 node sponsorship/server.cjs
```

Open `http://localhost:8091/sponsor/`. The standalone server intentionally serves only sponsorship routes.

Tests: `SPONSOR_SKIP_PRELOAD=true node --test sponsorship/tests/*.test.cjs`.
Browser QA: `node sponsorship/tests/browser.mjs` after installing Chromium through Playwright. Tests use isolated temporary databases and example.com identities, never the live customer database.

## Production integration

The existing Dockerfile adds the model/bundle build and a sponsorship preload. It follows the existing application's Express preload pattern. `SPONSOR_SKIP_PRELOAD=true` disables automatic mounting when importing the module for tests.

Set `SPONSOR_ADMIN_KEY` and `SPONSOR_SESSION_SECRET` to unique high-entropy values in Railway. Owner keys are never placed in source, URLs or localStorage. Set `SPONSOR_DB_PATH=/data/brainsnn-sponsor.sqlite`, keep one replica, and include this database in the volume backup plan. SQLite supports this single-node launch; migrate to the existing managed Postgres before multi-replica expansion.

Do not enable payments until all of these are verified:

1. A restricted server-side Stripe API key under `SPONSOR_STRIPE_SECRET_KEY` can create Checkout Sessions with the actual request payload. Start with Checkout Sessions write permission and validate the sandbox request as described below.
2. A signed webhook endpoint is configured at `https://www.brainsnn.com/api/sponsors/stripe/webhook`, and its secret is in `SPONSOR_STRIPE_WEBHOOK_SECRET`.
3. An active Stripe Tax registration and correct tax classification are confirmed by the merchant/accountant; only then set `SPONSOR_TAX_READY=true`.
4. Test-mode success, decline, cancellation, duplicate delivery, asynchronous payment and invalid-signature scenarios are exercised before real customers pay.
5. Set `SPONSOR_PAYMENTS_ENABLED=true` only after the preceding gates pass.

A connected Stripe app account does not by itself give the web server an API key. Do not mark checkout live just because the app is connected.

### Runtime configuration and local webhook verification

The public XIO page relays to this service; configure these values on the BrainSNN service that owns `/api/sponsors`, not in a browser bundle:

| Variable | Required value or purpose |
| --- | --- |
| `SPONSOR_DB_PATH` | `/data/brainsnn-sponsor.sqlite` on the existing durable volume; one replica |
| `SPONSOR_PUBLIC_ORIGIN` | `https://www.brainsnn.com` |
| `SPONSOR_ALLOWED_ORIGINS` | `https://www.xioai.ca,https://xioai.ca` |
| `SPONSOR_SESSION_SECRET` | A stable, unique secret; changing it invalidates browser sessions and direct-purchase receipt tokens |
| `SPONSOR_ADMIN_KEY` | A separate unique owner-access secret |
| `SPONSOR_STRIPE_SECRET_KEY` | Restricted API key for the correct Stripe account and mode |
| `SPONSOR_STRIPE_WEBHOOK_SECRET` | Signing secret for this endpoint and the same account/mode |
| `SPONSOR_PAYMENTS_ENABLED` | Keep `false` until payment creation and signed events are verified; `true` enables the payment gate |
| `SPONSOR_TAX_READY` | Keep `false` until the merchant's applicable tax setup is confirmed |
| `SPONSOR_DIRECT_CAMPAIGN_JSON` | Actual published campaign configuration described below; empty disables direct purchasing |

Register a snapshot-event webhook at `https://www.brainsnn.com/api/sponsors/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, and `checkout.session.async_payment_failed`. Use the integration's API version, `2026-07-29.dahlia`. Keep the endpoint and its signing secret active when payment creation is disabled so existing orders can settle.

The webhook verifies signatures locally with the supported Stripe SDK verifier. It requires its signing secret and persistent storage, but makes no Stripe API call and requires no API key or enabled-payment flag. Invalid or missing signatures still fail with HTTP 400. A correctly signed unrelated event can verify endpoint delivery before payment credentials are provisioned; it does not prove Checkout creation or payment processing works.

The runtime's only outgoing Stripe API operation is `checkout.sessions.create` (`POST /v1/checkout/sessions`), so its code-level API permission is **Checkout Sessions: Write**. Webhook verification requires no API permission. Configuring a webhook through an API is a separate operator action requiring **Webhook Endpoints: Write** on that operator's key, not on the deployed checkout key. The runtime does not call Product, Price, Customer, PaymentIntent, Refund, Payout, or Tax Registration APIs directly.

Checkout creates its inline product/price and customer from the submitted session parameters. Test this exact payload in a Stripe sandbox with the restricted key; if Stripe reports an additional missing resource permission, add only that named permission and repeat the test. Stripe recommends mapping observed API operations to permissions and using sandbox request errors to establish the final permission set: https://docs.stripe.com/keys/restricted-api-keys. The source alone does not prove a live key's permissions or account readiness.

### Published direct-purchase campaign

`GET /api/sponsors/purchase-options` reports whether a valid campaign and payment configuration are present. The direct purchase endpoint accepts orders only when both gates are ready. Publishing a real standard offer replaces per-customer manual quote approval; it does not remove the requirement to define what is being sold.

`SPONSOR_DIRECT_CAMPAIGN_JSON` must be one JSON object with these exact fields:

| Field | Validation |
| --- | --- |
| `enabled` | Boolean `true` when the merchant is ready to publish |
| `version` | 3–80 letters, digits, underscores, periods, or hyphens; changes must identify the terms accepted by the buyer |
| `durationDays` | Number `90` |
| `scope` | Actual campaign deliverables and scope, 80–4,000 characters |
| `activationWindow` | Actual activation timing, 10–300 characters |
| `cancellation` | Actual changes, cancellation, and refund terms, 30–2,000 characters |
| `sellUntil` | Nonexpired `YYYY-MM-DD` date, compared against UTC |
| `confirmed` | Object whose `hardware`, `venues`, `staffing`, `artwork`, `tax`, and `terms` fields are each Boolean `true` only after those facts are confirmed |

No ready-to-publish campaign terms are supplied in this repository. The synthetic terms in tests are fixtures, not an approved offer. Keep the environment value empty until real scope, timing, cancellation terms, and confirmations are available. Do not copy test fixtures into production.

Read-only checks after deployment: `/api/sponsors/status` confirms storage and the payment gate, while `/api/sponsors/purchase-options` confirms direct-purchase readiness. These configuration checks do not prove a real payment, tax calculation, or webhook round trip. Keep test and live credentials, webhook secrets, and databases separate.

## Review workflow

The owner opens the private dashboard and signs in with `SPONSOR_ADMIN_KEY`. Review the campaign brief and logo. Only create an approved quote after hardware, venue, staffing, dates, agreement and tax review are confirmed. Save the returned private invitation immediately; only its hash is stored. It is not automatically emailed. The named company reviews the scope and checks agreement acceptance before Stripe Checkout.

A unique reservation per Robot 001 placement prevents duplicate active agreements. One left/right panel opportunity is sold for each limb category in the founding catalogue, not two separate slots. The preferred side is part of the application. Naming rights do not imply ownership or a takeover of every other placement. Category conflicts and content compatibility require owner review.

Paid state is set only by a valid signed Stripe notification matching the saved session, application, currency and server-side subtotal. A success URL cannot mark an application paid. Refunds, active-contract cancellation and releasing reserved slots require deliberate merchant reconciliation, not an unauthenticated public button.

## Privacy and operations

Essential signed CSRF/session cookies, SameSite/HttpOnly/Secure in production, origin checks, body limits, rate limits, server validation, SQL prepared statements and private authenticated logo retrieval. PNG attachments are capped; preview source files stay local unless opted in. No applicant records or logos are published. The owner can delete uncontracted applications. Daily cleanup removes uncontracted applications after 180 days. Configure database backups and monitor `/api/sponsors/status`.

Application confirmations appear on screen with a reference. There is no email-delivery integration and no automatic marketing enrollment. Optional communications consent is stored separately for the owner's future compliant workflow.

## Rollback

Revert the sponsorship integration commit or remove only `--require ./sponsorship/server.cjs` from the runtime command, redeploy, and leave the existing BrainSNN preloads untouched. Do not delete the `/data` database when rolling back code. Existing non-sponsorship routes are intentionally unchanged.

## XIO Sponsorship Checkout

The checkout endpoint supports an optional `returnSite: 'xio'` parameter in POST requests. When set to `'xio'`, payment success and cancellation URLs resolve to `https://www.xioai.ca/robot-sponsorship/checkout/?payment=returned|cancelled` and the Stripe product title includes the placement name (e.g., `XIO Robot 001 / Chest`). No other return destinations are accepted; caller-supplied URLs are rejected with HTTP 400. All credential gates, session verification, payment approval requirements, and webhook behaviors remain unchanged. No production Stripe keys are required for this feature; tests use isolated fake Stripe instances.
