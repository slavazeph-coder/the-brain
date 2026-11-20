# Project Review shared contract

Implementation contract for `public/world/project-review.mjs`. All source geometry is immutable. Quantities are inferred from compiled geometry, never physically verified by this workflow.

## Request and normalized input

`await prepareProjectReview({sceneText, sourceLabel, brief, rates})`

- `sceneText`: exact UTF-8 `brainsnn.scene.v1` JSON, maximum 256 KiB; metric units and a valid stable component graph required; maximum 128 components.
- `sourceLabel`: bounded display name (160 characters).
- `brief`: `{title, goal, constraints, currency, budget}`; currency is `CAD` (default), `USD`, `EUR` or `GBP`; budget is a finite nonnegative number or `null`.
- `rates`: maximum 16 `{id,label,task,low,high,source,asOf,reviewed}` records. Tasks: `wall-finish` or `floor-finish`; unit is always square metres. `low` and `high` are numbers or `null`; zero is valid. Reviewed rates require both numbers, source text and an ISO calendar date. `defaultReviewRates()` returns four blank, unapproved rows: `wall-standard`, `wall-premium`, `floor-standard`, `floor-premium`.

Normalized immutable input contains `{schema,inputSha256,source,components,brief,currency,rates}`. `source` contains the existing scene binding fields (`sceneSha256`, `sourceSha256`, `contentSha256`, `revision`, `units`, `coordinateFrame`) plus `label`, `declaredSource`, `origin` (`authored-example` or `compiled-model`), and validation flags fixed false. `components` contain `{componentId,sourceName,label,kind,centre,size,yaw,task,quantity}`. `kind` is `wall`, `floor`, `object` or `opening`; `task` is the compatible rate task or `null`; `quantity` is `null` or `{value,unit:'m2',gross,openingDeduction,basis,evidence:'inferred'}`. Floor identification uses the fixed compiler name `floor_observed`, never an editable label. Yaw follows the renderer convention in `sceneInventory`.

Normalized inputs are immutable instances returned by preparation. Re-run preparation from the original request when restoring a session; a parsed normalized object cannot be passed directly as authority. Normalized rate rows contain `unit:'m2'`; original request rate rows do not include a unit field.

The input hash binds exact source bytes, source label, normalized brief and rates. Keep the original request in the UI for POST; the server independently calls `prepareProjectReview` and sends only compact input to the provider. Do not send client-computed quantities as authority.

## Proposal and pricing

`localProposal(input)` (also exported as `createLocalProposal`) returns a proposal from fixed local templates, with no model execution claim.

`validateProposal(input, raw)` returns a fresh validated proposal:

```
{
  options: [
    {id:'option-a',title,summary,items:[{componentId,rateId}],assumptions:[],questions:[]},
    {id:'option-b',title,summary,items:[{componentId,rateId}],assumptions:[],questions:[]}
  ],
  questions: []
}
```

Exactly two options, maximum 32 distinct component items per option; only existing component and compatible rate references; no model-supplied quantities, geometry, totals, approvals or extra fields. Lists of assumptions/questions have maximum 12 strings, each 500 characters. Titles maximum 100, summaries maximum 1200.

`priceProposal(input, proposal)` independently validates references and returns `{schema,inputSha256,source,brief,currency,options,questions,findings,validation}`. Each option retains title/summary/assumptions/questions and contains:

- `items`: `{componentId,rateId,label,task,quantity,unit,quantityBasis,evidence,rateLabel,rateLow,rateHigh,rateSource,rateDate,rateReviewed,priced,low,high}`. Missing/unapproved rates have `priced:false` and null money fields.
- `knownSubtotal:{low,high}`: sum of priced lines only, in currency units rounded to cents per line.
- `subtotal`: same range only when `complete:true`, otherwise `null`.
- `complete`: every selected item has an approved price and at least one item exists; this never means whole-project or measured completeness.
- `unpricedCount` and `budgetStatus` (`not-set`, `incomplete`, `within`, `over`, `overlap`).

The base calculation report makes no AI claim. Server may attach validated commentary and execution provenance to its own result envelope. Local UI must label its run as local templates/calculations.

The optional AI extension is exactly `execution`, `reviews` and `transcript` together, matching `src/server/projectReview.js`. Core validates the execution order, configured provider declaration, bounded findings and references, original input hash, each proposal digest, final proposal and calculation identity before approval/export. Estimator/reviewer findings are included in the Markdown customer brief; full validated transcript is retained in JSON. Local calculations leave these three fields absent.

## Approval and export

`await approveReview(input, report, {optionId,reviewer,note,acknowledged:true})` returns an explicitly self-reported approval bound to `inputSha256` and the exact canonical report SHA. Source, scope, rate, commentary or report changes invalidate it. Reviewer required; note may be blank. Approval does not certify geometry or a final quotation; provisional/unpriced results may be approved only for preliminary scope review, and retain that status.

`await validateApproval(input,report,approval)` returns a validated cloned approval or throws on stale/malformed input. `await exportReviewJSON(input,report,approval=null)` returns bounded JSON text, validating any approval. `await exportReviewMarkdown(input,report,approval=null)` produces an inert text brief. `reviewInputHash(input)` returns the normalized input digest for integrity checks.

`demoSceneText()` returns a small authored metric fixture with stable IDs and visibly synthetic source metadata; no real capture, real rates or measured result is implied.
