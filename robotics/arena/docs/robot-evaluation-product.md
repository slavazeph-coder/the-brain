# BrainSNN robot evaluation product

Decision updated 17 October 2026 after the owner explicitly corrected the commercial direction: focus on the robot arcade and paid robotics testing. Generic Python audits and manual recording-review services are not the product focus.

## Buyer and promise

Build for a robotics engineer choosing whether to promote a policy checkpoint. The paid outcome is a reproducible answer to a release question: which agreed tasks/conditions passed, which regressed, what it cost, and which recorded observations support the result. The arcade is the front door for selecting a task, watching one run and inspecting the failures. A managed evaluation campaign is the commercial unit.

Current bundled execution is Panda / π₀.₅ LIBERO behind the pinned OpenPI interface. The catalogue does not supply generic hosted inference for every listed robot or customer checkpoint. Supporting a buyer's compatible private checkpoint requires preflight of its identity, preprocessing, observations, actions and controller; compatibility must not be inferred from a model name.

## Simple customer offer

The public site has two primary choices: **Robot arcade** and **Pricing**. Keep robot/model selection and practice challenges visible. Review, text-detector Evidence, Lab, the catalogue and extra space tools remain secondary destinations.

Lead with one planned product: **one policy, ten episodes, an outcome report and retained evidence**. One episode is one task attempt; task successes, completed task misses and execution errors stay separate. The initial recipe is Panda + π₀.₅ on the ten LIBERO Spatial tasks. Public hosted testing remains unavailable until the real GPU pilot is verified. A visible illustrative runtime price and its assumptions help visitors plan; it is not an executable quote or purchase action.

Customers should not need to choose providers, calculate worker-hours, enter a spending model, upload operator JSON or run a CLI to understand this offer. Those existing tools stay under a closed **Operator tools** disclosure. Larger packs are a short future-capacity note, not competing products to buy today. Do not attach the text detector’s holdout statistics to robotics claims.

## Pack ladder

| Pack | Useful customer question | Delivery gate |
| --- | --- | --- |
| 10 completed episodes | Does this exact policy/environment run correctly, and where do the first failures occur? | First real saved pilot, then ten sequential episodes with complete evidence and measured costs. The code adds this bounded runner; actual GPU acceptance remains outstanding. |
| 1,000 completed episodes | Did a candidate improve the agreed task/condition matrix without introducing regressions? | Measured ten-episode receipt, paired baseline/candidate protocol, useful distinct conditions, bounded queue/storage/cancellation and a profitable private quote. A pair consumes two episodes. |
| 100,000 completed episodes | Which rare failures remain across a meaningful robustness distribution? | Validated perturbation families and held-out conditions, tested multiworker scheduler, calibrated simulator/policy contract, sustained throughput, failure sampling and real cost controls. Currently a planning size. |

Counts mean complete policy episodes, not simultaneously running robots. Infrastructure errors and partial evidence need their own accounting and replacement policy. Customer-facing acceptance must specify the denominator, retries, unknown outcomes and retention rather than hide them inside a success rate. A deliberately repeated condition can measure repeatability; it does not create additional scene coverage.

## Why someone would pay

Raw simulated episode count is already available through strong open-source tools. NVIDIA Isaac Lab-Arena provides configurable scenes/embodiments/tasks, policy client-server integration, parallel evaluation and per-episode analysis. Its public repository also labels the current release alpha with evolving APIs. This makes a new generic simulation engine an expensive immediate detour. [Official repository](https://github.com/isaac-sim/IsaacLab-Arena).

LeRobot already exposes LIBERO evaluation with task selection, episodes per task and environment batch size. Its documentation separates these quantities. BrainSNN should reuse compatible evaluators over time and make private execution, result comparison and evidence delivery easier. [Official LeRobot evaluation documentation](https://huggingface.co/docs/lerobot/libero).

RoboArena studies distributed evaluation on physical robot platforms; simulation results alone do not establish the same real-world validity. BrainSNN's first pack should clearly describe its simulator and success checker. [RoboArena paper](https://arxiv.org/abs/2506.18123).

Our proposed differentiation is a small managed release gate: a pinned checkpoint and test matrix, a clear distinction between task and infrastructure failures, inspectable evidence, and a comparison the engineer can reproduce. That is a product hypothesis, not established willingness to pay or a claimed research advantage.

## Build order

1. Finish the real ten-episode runner and importable campaign report using the existing single-session worker and native recordings.
2. Qualify the isolated policy/renderer stack on available hardware while preserving the resident GB10 text service. Save one accepted pilot, then the ten-episode pack. The website release does not qualify the GPU.
3. Measure full wall time, model/environment startup, inference latency, output bytes, error/rework rate and actual compute cost. Check a few fixed conditions against the upstream evaluator before publishing comparative performance.
4. Add compatible private checkpoint selection and paired baseline/candidate reports, then offer a bounded robotics evaluation pilot to a team with a release decision. Public purchase needs an executable, costed offer.
5. Add actual useful perturbations and a durable multiworker queue only after the narrow evaluation is accepted. A 100,000-episode button is not a substitute for those capabilities.

## Pricing rule

The owner explicitly restored public pricing transparency after the first simplification pass hid the commercial scale and price anchor. Keep the 10 / 1,000 / 100,000 episode choices and visible, editable example pricing. The historical illustration is in **USD**: `100,000 / 500 × US$0.60 / (1 − 0.30) = US$171.43`. That is US$120 of assumed runtime plus US$51.43 service margin allowance, a 30% gross margin (not a 30% markup). It assumes 500 episodes per worker-hour, equivalent to 7.2 seconds per episode. This has not been measured for Panda/π₀.₅ or any named local policy.

The illustration excludes startup, storage, transfers, retries, external inference, operator support and taxes. It is a runtime-price scenario, not an all-in quote, a delivery-time promise or available 100,000-episode capacity. Keep hypothetical estimates separate from measured pilot reports and executable plans. The owner correction supersedes the earlier blanket removal of public example prices, but does not establish performance, costs, margins or availability.

For an executable delivery quote, let `C` be all-in expected compute, startup/idle time, evidence storage/transfer, execution failures, support/operator time and payment costs. Quote only after measuring the exact recipe. A target contribution margin `m` requires a price above `C / (1 - m)` when all proportional fees have already been included consistently; add monthly overhead allocation to assess net operating profitability.

The owner reports C$0 monthly revenue and approximately C$100 monthly cash costs. One profitable small robotics campaign could cover that carrying cost; throughput and buyer willingness to pay remain unknown. Buying another GPU, dropping the resident model or offering unlimited trials is not required to build the narrow runner.

Sources checked 17 October 2026. None of these sources supplies BrainSNN pricing, measured local throughput, customers or actual revenue.
