# BrainSNN Sponsor Studio

Additive production route: `/sponsor/`. It does not replace BrainSNN's existing tools or homepage.

## Delivery

- A responsive, restrained graphite/pearl/cobalt design.
- Actual Unitree G1 reference meshes, pinned to official repository revision `ccfc6fd8430a17ba3dacef9a1e2faf64ff3b0aee`, reconstructed from the G1 23-DOF URDF. Display-only vertex clustering reduces geometry size. Upstream LICENSE is served alongside the model. Cosmetic materials are illustrative.
- Three.js on-surface decals, per-placement brand text/logo, colour, sizing and rotation; front/back/side/orbit and concept PNG export.
- Private applications stored in a separate SQLite database on Railway's `/data` persistent volume. No memory-storage fallback.
- An access-controlled owner dashboard at `/sponsor/admin/`; it lists real applications, supports logo review, approval, decline and deletion.
- Private, approval-gated Stripe Checkout. No public immediate charge and no invented bidders, logos, audience claims or deployed-fleet counts.

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

1. A restricted server-side Stripe API key under `SPONSOR_STRIPE_SECRET_KEY` has appropriate Checkout/customer permissions.
2. A signed webhook endpoint is configured at `https://www.brainsnn.com/api/sponsors/stripe/webhook`, and its secret is in `SPONSOR_STRIPE_WEBHOOK_SECRET`.
3. An active Stripe Tax registration and correct tax classification are confirmed by the merchant/accountant; only then set `SPONSOR_TAX_READY=true`.
4. Test-mode success, decline, cancellation, duplicate delivery, asynchronous payment and invalid-signature scenarios are exercised before real customers pay.
5. Set `SPONSOR_PAYMENTS_ENABLED=true` only after the preceding gates pass.

A connected Stripe app account does not by itself give the web server an API key. Do not mark checkout live just because the app is connected.

## Review workflow

The owner opens the private dashboard and signs in with `SPONSOR_ADMIN_KEY`. Review the campaign brief and logo. Only create an approved quote after hardware, venue, staffing, dates, agreement and tax review are confirmed. Save the returned private invitation immediately; only its hash is stored. It is not automatically emailed. The named company reviews the scope and checks agreement acceptance before Stripe Checkout.

A unique reservation per Robot 001 placement prevents duplicate active agreements. One left/right panel opportunity is sold for each limb category in the founding catalogue, not two separate slots. The preferred side is part of the application. Naming rights do not imply ownership or a takeover of every other placement. Category conflicts and content compatibility require owner review.

Paid state is set only by a valid signed Stripe notification matching the saved session, application, currency and server-side subtotal. A success URL cannot mark an application paid. Refunds, active-contract cancellation and releasing reserved slots require deliberate merchant reconciliation, not an unauthenticated public button.

## Privacy and operations

Essential signed CSRF/session cookies, SameSite/HttpOnly/Secure in production, origin checks, body limits, rate limits, server validation, SQL prepared statements and private authenticated logo retrieval. PNG attachments are capped; preview source files stay local unless opted in. No applicant records or logos are published. The owner can delete uncontracted applications. Daily cleanup removes uncontracted applications after 180 days. Configure database backups and monitor `/api/sponsors/status`.

Application confirmations appear on screen with a reference. There is no email-delivery integration and no automatic marketing enrollment. Optional communications consent is stored separately for the owner's future compliant workflow.

## Rollback

Revert the sponsorship integration commit or remove only `--require ./sponsorship/server.cjs` from the runtime command, redeploy, and leave the existing BrainSNN preloads untouched. Do not delete the `/data` database when rolling back code. Existing non-sponsorship routes are intentionally unchanged.
