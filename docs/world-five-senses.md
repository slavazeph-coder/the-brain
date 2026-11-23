# Find a cart with five senses

Open **World Builder → Can a robot find your cart?** or visit `/world/sense-trial.html`. Match a reference cart, play a decision at a time, inspect what each station reported and compare policies on the same rooms. Under **Change how the robot searches**, change the robot, task, observation budget, strategy or available senses. The loading-bay task accepts any bay meeting cargo requirements and minimum width.

If the robot stops and another reading could help, choose **Keep checking (+14 points)**. The robot stays in the same room and keeps its first observations. Each extra check costs the usual number of points. The visitor can still answer only once per room. When two carts match all five clues, the robot reports both could fit and stops. **Compare strategies** always uses the budget you selected.

## What the trial measures

The environment authors a reference and three candidates. Simulated instruments return categorical observations, including misses. The camera can supply another view, a microphone reports a chime, a contact pad reports handle texture, and a stationary aroma pad reports a local scent category. At a fixed food station, a virtual sampler classifies two noisy sweet/sour readings from a known reference sample. The reference picture illustrates the supplied color cue. The policy operates on readings supplied by the simulation.

Only the operator and evaluator have the room geometry and complete target data. The policy receives the reference, candidate IDs and labels, measured bay widths when relevant, available senses, past observations and budget. It can inspect, ask the simulated visitor a specific question once, select a candidate, or abstain. Selecting a candidate invokes the existing World ground planner on the reviewed simulation map. An independent segment check scores reachability, footprint collisions and keep-out crossings. Observations come from the instrumented stations. The robot travels when a destination is chosen.

The memory policy learns a priority order for clues from 12 seeded practice cases across three training layouts. The fixed-order multisense policy uses the same five channels and navigation. The browser compares them and the sight-only policy on 18 cases across three separate test layouts. Its six visual controls let color alone discriminate. The results also include a wider robot, the delivery task using the same training, and one run per disabled sense. **Download results** saves case-level benchmark outcomes, aggregate metrics and the training summary.

A correct benchmark decision means reaching an eligible target or substantiating absence or ambiguity from the available evidence. An unresolved stop earns no decision credit. The standard cart challenge deliberately includes similar-looking carts. Success on that challenge does not measure raw image recognition, accuracy of physical sense hardware or unrestricted agent learning.

For a larger paired evaluation, this command prints a JSON report using 180 preselected cases. Each of the three test layouts has 20 cases per target condition. Policies share the same seeds and a 14-point budget. The set is public for future regression testing.

```sh
node scripts/world-demo/benchmark-senses.mjs
```

To compare stopping at 14 points with accepting one follow-up, run the paired evaluation on a separate set of 180 rooms. Each condition has 60 cases, equally divided across the three test layouts. Only trials where the robot could take another informative action receive an extra allowance.

```sh
node scripts/world-demo/benchmark-sense-followup.mjs
```

| Strategy | Correct decisions at 14 points | Correct decisions with follow-up | Confirmed two matches, before → after | Wrong choices, before → after | Mean points spent, before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sight only | 0/180 | 0/180 | 0 → 0 | 13 → 13 | 2.24 → 2.24 |
| Five senses, fixed order | 80/180 | 173/180 | 3 → 57 | 4 → 4 | 11.94 → 15.78 |
| Five senses, practice-room memory | 82/180 | 171/180 | 3 → 57 | 6 → 6 | 11.91 → 15.74 |

Both five-sense strategies reached the matching cart in all 60 single-match cases after follow-up. The memory strategy used the extra allowance in 92 rooms. The remaining six wrong choices and three unresolved stops show where the policy still falls short on this set.

## How the research fits

Scentience’s olfaction work motivated the local smell channel. It can help disambiguate visually similar objects. A physical sensor would require its own calibrated readings and evaluation. [Scentience](https://scentience.ai/)

Meta and Oxford’s Autoregressive View Model retrieves spatial context for generating camera views. BrainSNN now uses camera position, optional heading and observed object links to retrieve an existing picture from the showroom. See **Find a saved camera view**. The map also offers another recorded angle on a selected object. Queries outside the supported radius return no image. Headings, when supplied, are in degrees from floor +Z toward +X. Room files without headings support position-only lookup. These controls only change the displayed evidence. The implementation uses the room’s recorded pictures and camera metadata and runs without the AVM network or weights. [Research paper](https://arxiv.org/abs/2611.23417) · [Showroom guide](world-showroom.md)
