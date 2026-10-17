# Local analysis ledger operations

Run these commands on the single service host against its persistent database,
as the operating-system user that owns the file. They make no network calls,
cannot issue payments or credits, and never print recovery credentials,
customer session tokens, uploaded images, or model output. Keep database backups
private; they contain financial records and retained analysis results.

Use the same `ARENA_ANALYSIS_FAILURE_RESERVE_CENTS` and
`ARENA_ANALYSIS_MAX_OUTSTANDING_COST_CENTS` values as the service. These values
describe owner-funded limits, not additional customer credit. Missing reserve
configuration is reported as zero. `--db` must name an existing absolute regular
file; the CLI refuses to create a new ledger or follow a symlink.

## Inspect balances and unresolved expenses

```sh
node arena-analysis/admin.cjs status --db /data/arena-analysis/ledger.sqlite
```

The response separates unspent customer liabilities, reserved balances, earned
analysis revenue, provider expenses, fixed allocations, payment fee bounds and
dispute fees. It also lists up to 100 unresolved jobs and recent owner actions.
This is an operational accounting view, not a claim of net profit. Rates and FX
bounds must remain valid for at least 20 minutes when quoting: a ten-minute
acceptance window followed by up to ten minutes of provider execution.

`refundedPaymentFeeBoundCents` identifies the proportional payment-fee portion
associated with returned credit. It is a subset of `paymentFeeBoundCents`, not an
additional expense to sum twice. After partial refunds, future quotes allocate
the retained fee over the smaller nonrefunded funding amount. If that leaves no
workable margin, quoting and new top-ups require owner review. Past charges do
not increase; refunds and disputes can still produce business losses.

The ledger is permanently pinned to `test` or `live` when the configured payment
service first opens it. Switching modes requires a separate empty database.
An older unpinned ledger containing financial records cannot be relabeled live.
The owner CLI reports the pin and cannot change it.

## Reconcile an interrupted or ambiguous provider request

First check provider billing and whether a usable result reached the customer.
If actual cost is still unknown, leave the reservation in place. Do not assume a
timeout or disconnected browser means no provider charge. Include all billed
input, output and thinking tokens, currency conversion and applicable provider
charges when determining the actual CAD cost; round up to whole cents.

Only after confirming there is no usable delivered result and no customer charge
due:

```sh
node arena-analysis/admin.cjs reconcile \
  --db /data/arena-analysis/ledger.sqlite \
  --job job_REPLACE_WITH_EXACT_ID \
  --actual-provider-cost-cents 15 \
  --confirm-no-result-no-charge \
  --reason 'Provider invoice reviewed; interrupted job delivered no result'
```

The job becomes `failed`; the client remains uncharged. The actual provider
expense plus the reserved fixed allocation consumes the owner failure reserve,
and the unknown-cost hold is released. An identical repeat does not duplicate
expenses. A different cost for an already reconciled job is rejected. Costs above
the original ceiling pause further paid work; investigate and correct pricing
before a separately reviewed service recovery. This CLI cannot clear that pause.

If a usable result was delivered but its charge or expense is unclear, do not use
this no-result reconciliation command. Preserve the hold for individual review.

## Freeze or clear an owner freeze

```sh
node arena-analysis/admin.cjs freeze \
  --db /data/arena-analysis/ledger.sqlite \
  --workspace ws_REPLACE_WITH_EXACT_ID \
  --reason 'Owner reviewing a payment reconciliation discrepancy'

node arena-analysis/admin.cjs unfreeze \
  --db /data/arena-analysis/ledger.sqlite \
  --workspace ws_REPLACE_WITH_EXACT_ID \
  --reason 'Owner verified payment funding and resolved the discrepancy'
```

Unfreeze only clears an owner-applied flag. It cannot override unresolved
provider costs, disputes, negative/reversed balances, usage limits or the global
cost pause. Won disputes remain frozen pending individual financial review; this
release deliberately has no arbitrary credit-restoration command.

The commands do not perform application-startup recovery, so inspecting the
ledger while the service is running cannot turn active jobs into uncertain jobs.
Every successful mutation records its reason and timestamp in the owner audit
table. Do not put secrets, personal information or media into reasons.
