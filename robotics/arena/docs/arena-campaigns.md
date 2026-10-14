# Matched robot campaign plans

The Campaigns page now begins with a planner for an exact robot + policy + environment recipe. It uses `BrainSNNArenaProfiles` and follows `BrainSNNExperiment.getState()` without substituting another body. A selected pair that has no registered recipe remains visible and cannot be exported until the user explicitly chooses a separate recipe.

The older browser toy-grid comparison should remain in its own collapsed section below this planner. Its scripted results are unrelated to the robot campaign and must not be presented as model evaluation evidence.

## Integration

Load `arena-campaign.css` with the other stylesheet assets. Add `<div id="arena-campaign-root"></div>` at the top of the Campaigns page. Load `arena-campaign.js` after `arena-profiles.js` and `experiment.js`. It mounts at DOM ready, or the host may call:

```js
BrainSNNCampaign.mount(document.getElementById('arena-campaign-root'));
BrainSNNCampaign.refreshSelection();
```

Call `refreshSelection()` when navigating to Campaigns. The module also listens for the window event `brainsnn:experiment`. Call `refreshSelection(true)` to explicitly follow the current Arena selection and seed again. After the user selects a different campaign recipe, navigation does not overwrite that deliberate choice. The “Use Arena selection” control restores following.

The module only reads the profile registry and experiment selection. It never calls worker, provider, credential or billing APIs. It does not treat a recipe as an installed runtime. All exports have `status: draft`, `execution.state: plan-only`, `workersStarted: 0`, `providerConnected: false`, and `budgetEnforced: false`.

## Interaction

- The selected body, model and current task are preserved. Unknown task IDs stay explicit and are identified as needing worker verification.
- Trial presets are 1, 1,000, 10,000 and 100,000. An editable count supports all integers from 1 to 100,000.
- Total trial episodes and simultaneous workers are separate. Up to 256 planned workers are allowed, never more than the trial count. This is a planning bound, not a claim of available capacity.
- Consecutive seeds have an inclusive start and end. Every seed gets one episode with no automatic retries in the requested plan. Seeds must fit `0…2,147,483,647`.
- Pilot estimates appear only after the user enters completed episodes, elapsed wall seconds, pilot worker count and price per worker-hour.
- Changing the recipe, task, protocol or compute destination clears old pilot measurements. Navigating back to an unchanged Arena selection does not overwrite an edited campaign seed.
- Loading time, storage and transfer allowances are explicit and default to zero. They are not quoted prices.
- Over-budget estimates remain exportable as clearly identified drafts. An external orchestrator must reject or revise them before allocation.

## Estimate semantics

Let `E` be completed pilot episodes, `T` elapsed pilot seconds, `P` allocated pilot workers, `N` planned trial episodes, `W` planned simultaneous workers, `L` loading minutes per worker, and `R` price in USD per worker-hour.

```text
throughput per worker-second = E / (T × P)
runtime worker-hours = N × T × P / (E × 3,600)
loading worker-hours = W × L / 60
ideal wall-hours = runtime worker-hours / W + L / 60
compute cost = (runtime worker-hours + loading worker-hours) × R
total estimate = compute cost + storage allowance + transfer allowance
```

The estimate assumes all pilot workers were allocated for the full pilot duration. Completed episodes include successful and failed trials; this is a throughput measure, not a success-rate measure. Loading must be excluded from entered pilot wall time if it is also supplied as a separate loading allowance.

The estimate assumes identical hardware, policy, task, cameras and recording configuration, plus ideal linear worker scaling. It excludes queue delays, retries, throttling and additional idle time. It reports worker-hours separately from elapsed wall-hours. No default or fabricated episodes-per-second value is used.

For example, 20 completed episodes in 600 seconds on one worker produce 1 episode per 30 worker-seconds. A 100,000-trial plan requires approximately 833.33 runtime worker-hours. Ten workers imply approximately 83.33 ideal elapsed runtime hours; increasing worker count changes wall time, not the aggregate episode work.

## Export contract

`BrainSNNCampaign.buildPlan(input, profile, arenaSelection)` produces schema `brainsnn.campaign.plan.v1` containing:

- Full recipe, checkpoint reference, camera, state, action, controller and timing contracts where declared by the registry.
- Exact recipe/body/model/task/protocol selection, plus provenance of the Arena selection.
- Total episodes, seed strategy/range/count and attempts-per-seed.
- Planned provider preference, worker limit and requested retry behavior.
- USD spending ceiling and loading, storage and transfer allowances.
- User-entered, unverified pilot measurements and a transparent estimate, or null when no pilot was supplied.
- Assumptions and unresolved execution requirements.

It does not claim that checkpoint revisions, container images, simulator versions, saved processors, task IDs or worker contracts have been verified. Those requirements are exported for a real orchestrator to validate and pin before execution. The planned spending ceiling is not enforced by this static frontend.

Validation rejects missing partial pilot data, zero or negative throughput inputs, non-finite numbers, fractional integer fields, seed range overflow and configured maxima. Spending limits must be positive. Zero is valid for a seed and optional extra-cost allowances.

## Checks

```sh
node --check dist/arena-campaign.js
node tests/arena-campaign-math.cjs
node tests/arena-campaign-flow.cjs
```

The arithmetic suite covers 18 cases including multiworker pilot throughput, total-vs-concurrent trials, costs, upper bounds, invalid values, truthful readiness and every registered profile. The DOM fixture suite covers 13 cases including Panda/G1 selection, unsupported pairs, deliberate profile choice, seed preservation, stale-measurement clearing, invalid inputs and JSON download. These are source and DOM checks; they do not validate pixel rendering, real model execution, provider allocation or measured GPU throughput.
