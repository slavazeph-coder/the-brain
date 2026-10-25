# Paid episode analysis

An optional service inside Arena Inspect. The client selects at most six
observations and twelve verified image derivatives, previews exactly what is
uploaded, receives a fixed CAD quote, and accepts it before Gemini is called.
The response is an evidence-linked hypothesis sidecar; it never edits the
recording, scores a robot, controls hardware, or launches training.

The offer is a **C$50 prepaid balance**, plus applicable tax, with **C$2 minimum
per accepted analysis**. There is no subscription, automatic top-up, unlimited
usage or promised analysis count. A usable, structurally valid review settles
the accepted price once. Abstaining because the selected evidence is insufficient
is a usable review when it includes the missing information. Technical failures
do not debit the customer. Unknown provider usage pauses that workspace and keeps
the internal worst-case reserve until the operator reconciles it.

## Cost controls

Quotes reserve the full 32,768 generated-token cap, including reasoning, and a
conservative input bound: UTF-8 metadata bytes, 6,144 prompt/schema tokens, and
1,280 tokens per image. The request is capped at 32,000 input tokens, 100 events,
512-pixel image edges and 8 MiB. One provider call runs globally at a time; all
attempts, including failures, count toward six per hour and twenty per day.

The integer-cent calculation is:

```text
provider bound = ceil((input bound × input rate + 32768 × output rate) × CAD/USD)
cost bound     = ceil((provider bound + infrastructure + support) × 1.20)
quote          = max(C$2, ceil(cost bound / (1 − 0.50 − payment fee fraction)))
```

Rates are USD per million tokens; the implementation includes that divisor and
rounds upward at each currency boundary. The payment fraction is at least the
largest fee on the customer's available funding lots. Stripe credit is only
issued after its CAD balance transaction confirms the actual payment fee.
Quotes cover at least a 50% contribution margin against these bounds. The
operator must keep infrastructure, support and FX allocations current. This
does not guarantee net profit: refunds, disputes, downtime, taxes and costs
outside the configured bounds remain business expenses. Unspent prepaid money
is a liability, separate from earned analysis revenue.

The owner failure reserve funds failed calls and overhead; exhausted reserves
stop new work. A timeout never means the provider bill is zero. Unexpected
provider/fee overruns pause paid execution for review. Do not clear that pause
by deleting or replacing a funded ledger.

Published standard Gemini rates checked 2026-10-17 are US$2 input / US$10 output
per million until November 30, then US$4 / US$20 from December 1. Quotes enforce
the higher rates and assume no cache discount. Sources:
[Google pricing](https://ai.google.dev/gemini-api/docs/pricing),
[combined output/reasoning limit](https://ai.google.dev/gemini-api/docs/latest-model),
[image resolution](https://ai.google.dev/gemini-api/docs/media-resolution).

## Production configuration

Deployment is safe with all feature flags unset: the inspector remains local,
capabilities report unavailable, and checkout cannot take payments. Never make
public purchases available merely because the code has deployed.

| Variable | Required value or meaning |
| --- | --- |
| `APP_URL` | Canonical HTTPS website origin, currently `https://www.brainsnn.com` |
| `ARENA_ANALYSIS_GEMINI_API_KEY` | Dedicated server-only paid Gemini key; never use a `VITE_` variable or the legacy `GEMINI_API_KEY` |
| `ARENA_ANALYSIS_STRIPE_KEY` | Dedicated restricted/server Stripe key; production requires live mode |
| `ARENA_ANALYSIS_STRIPE_WEBHOOK_SECRET` | Secret for this service's dedicated webhook |
| `ARENA_ANALYSIS_DB_PATH` | Persistent SQLite file, normally `/data/arena-analysis/ledger.sqlite` |
| `ARENA_ANALYSIS_SINGLE_REPLICA` | `true` only with exactly one server process/replica |
| `ARENA_ANALYSIS_STORAGE_CONFIRMED` | `true` for a separately verified persistent mount outside Railway; Railway mount is checked automatically |
| `ARENA_ANALYSIS_FAILURE_RESERVE_CENTS` | Owner-funded failure budget in CAD cents; no default funding |
| `ARENA_ANALYSIS_MAX_OUTSTANDING_COST_CENTS` | Maximum outstanding provider + overhead holds; default 1000 |
| `ARENA_ANALYSIS_PRICING_JSON` | Current reviewed rates, cost allocations and bounded FX, below |
| `ARENA_ANALYSIS_TAX_MODE` | `registered` with an active Stripe Tax registration, or explicitly reviewed `not_required` |
| `ARENA_ANALYSIS_TAX_CODE` | Reviewed Stripe product tax code when tax is registered |
| `ARENA_ANALYSIS_PROVIDER_VERIFIED` | `true` after a real bounded provider smoke test returns valid evidence refs and complete usage |
| `ARENA_ANALYSIS_PAYMENT_VERIFIED` | `true` after payment/replay/refund fulfillment tests pass in an isolated sandbox |
| `ARENA_ANALYSIS_ENABLED` | `true` after the provider/storage/budget configuration is ready |
| `ARENA_ANALYSIS_PAYMENTS_ENABLED` | `true` last, after production webhook/account/tax setup is verified |

Example shape only; **these illustrative cost and FX values are not approved
operating assumptions**. Replace them and both expiry timestamps with reviewed
values. Missing, stale, or less than twenty minutes of valid coverage disables
new quotes. Do not set long expiries to bypass exchange-rate review.

```json
{
  "version": "reviewed-rates-and-fx-YYYY-MM-DD",
  "validUntil": "YYYY-MM-DDTHH:MM:SSZ",
  "fxValidUntil": "YYYY-MM-DDTHH:MM:SSZ",
  "usdToCad": 1.60,
  "inputUsdPerMillion": 4,
  "outputUsdPerMillion": 20,
  "infraCents": 10,
  "supportCents": 20,
  "paymentFeeBps": 860,
  "marginBps": 5000,
  "contingencyBps": 2000,
  "outputTokenLimit": 32768
}
```

The volume must have private, tested backups and enough free space before money
is accepted. Use SQLite's online backup mechanism or a provider snapshot with
the application quiesced; copying only the live `.sqlite` file can omit WAL
transactions. Restore to an isolated host and verify accounting totals before
reopening service. Never run a second replica against this file. Restart recovery
marks interrupted work uncertain, releases customer holds, and retains internal
expense holds. The test/live mode pin is permanent; sandbox tests use their own
database and deployment, never production customer balances.

## Payment fulfillment and launch validation

Create the dedicated webhook at
`https://www.brainsnn.com/api/arena/analysis/webhook` with:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- `charge.refunded`, `charge.updated`
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

The raw signature is verified before parsing. The server retrieves payment
state from Stripe and checks mode, metadata, checkout identity, package amount,
currency, payment success, tax and fees. Returning from checkout never credits
the balance. Replays are idempotent. Asynchronous methods wait for paid status;
missing fee settlement retries fulfillment rather than issuing guessed credit.
Keep the webhook active even while new purchases are disabled.

In a separate sandbox, exercise paid, unpaid, delayed-payment, duplicate,
out-of-order refund/dispute, rejected-signature, changed-evidence and two-tab
cases. Then verify a bounded real provider call with owned, non-sensitive
recording data and reconcile its usage against the quote. This release's tests
use fixture payments/providers; they are not a production payment or model
validation. The live credential/account smoke tests remain an activation gate.

For refunds, freeze the workspace, inspect pending/reserved analyses and the
unspent liability, and use the authorized Stripe Dashboard workflow. Let the
verified webhook apply the cumulative reversal. Do not manufacture local
credits or assume a won dispute restores them. Any refund is conservatively
deducted from prepaid principal up to its full amount; mixed tax/principal
refunds need individual review. Operational commands are in [ADMIN.md](ADMIN.md).

## Data and evidence boundaries

No analysis network calls happen until the visitor opens the optional panel.
Preview stays in the browser; getting a quote uploads only selected derivatives
and bounded telemetry to BrainSNN. Accepting the quote sends that same digest-bound
evidence to Google. Original recordings and unselected prompt contents remain
local. The server checks derivative bytes; original/manifest identities remain
client-declared, not authenticated robot execution.

Input image bytes are never written to the ledger. Result sidecars and selected
metadata remain retrievable for seven days, then are removed from the live
ledger by periodic cleanup. Financial/audit records remain. Backups must follow
their own retention policy; do not promise immediate deletion from backups.
Recovered sidecars omit derivative pixels and disclose that verification limit.

Provider requests use `store:false`, no tools and no automatic retries. This is
not a zero-retention promise: Google's
[abuse monitoring policy](https://ai.google.dev/gemini-api/docs/usage-policies)
describes 55-day retention. The UI links that policy before upload acceptance.
Customer sessions use HttpOnly, Secure, SameSite cookies, same-origin CSRF
checks and hashed bearer/recovery credentials in storage. Recovery credentials
are shown once and never written to localStorage or logs.

## Verification

```sh
npm run lint
npm test
npm run build
node ../robotics/arena/tests/arena-analysis-browser.cjs
node ../robotics/arena/tests/arena-inspector-browser.cjs
```

The browser tests need Playwright Chromium (or the explicit local
`PLAYWRIGHT_CHROMIUM_PATH` override). CI installs Chromium. The normal application
test command and production Docker build include the financial, provider,
evidence, HTTP and owner-operation tests.
