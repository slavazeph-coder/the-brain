---
type: project
description: Watch Your Step terrain inspection and pinned CPU foothold predictor, with no robot-control or physical-readiness claim
---

Owner's lnkd.in/p/gK4nkzz4 resolves to Watch Your Step (ETH Zurich,
arXiv:2610.29612), not phone reconstruction. Upstream revision
20009c33639a55c100c21e0c4747bec13b22f161 publishes an MIT G1 foothold predictor.
The 102 inputs are interleaved coordinates/heights, not 98 heights then 4 coords.
The full elevation map still exists. FPM input uses 70 unscaled SystemStateCfg
values; its checkpoint includes normalization.

New local scene-review inspector uses hypothetical operator queries. The separate
CPU adapter runs actual pinned FPM inference and can sample a BrainSNN snapshot
for an upright body. Unknown/off-map/mixed-height cells abstain, not flatten.
Source cloud and scene hashes stay with browser reports; CLI hashes source bytes.
Omniverse packages include standalone research tools but no model/runtime download
or policy execution. Point binning is not raycasting or verified contact geometry.

Run docs/world-foothold-focus.md tests before release. CPU/model/software tests
must never be described as real G1 walking, trained BrainSNN policy, measured
physical accuracy, GPU dynamics, or replicated research training speed.
