---
type: project
description: Surface inspection and isolated pinned MetricTrail long-video research bridge, with physical and license boundaries
---

Owner requested completion/merge of hosted IFC work, then the Wenjin Tao surface-continuity and Pablo Vela MetricTrail references. PRs 299, 300 and 301 merged. Website e11806bd and private worker b68df947 deployed successfully. The worker service had an explicit old startCommand overriding the new root railway.toml: align that service setting to the reviewed command before expecting ASBUILT_HOSTED_ACCEPTANCE logs. A healthy deployment by itself is not an acceptance pass.

Surface inspection adds local GLB zebra, face normals, wireframe and per-mesh exact-position triangle topology checks in both the asset viewer and original worker scene dialog. Materials restore; original geometry/exports remain unchanged. Reports bind source bytes/job/hash. Limit 200,000 audit triangles, static geometry. No G2/G3 NURBS, self-intersection, inter-mesh gaps, physical accuracy or collision certification. Rhino analytic tools are documented rather than claiming mesh-derived continuity.

MetricTrail source pinned to nv-tlabs/vipe ead2e008bc055310121736a49ff306bba50d10dc. Source/model card terms differ: NVIDIA DPVO weights' linked/prose terms are noncommercial research/evaluation, despite ambiguous license metadata. Keep the bridge research-only and absent from all production worker profiles. Model/DINO/MoGe full hashes in metrictrail_trial.py; native DINO hash was read from a SHA-verified DPVO archive with pickletools, never unpickled. No GPU execution here.

The bounded runner records failures/logs, uses local weights, invokes upstream tracking/strict point export, and imports finite rigid poses and matching filtered PLY. Conservative browser handoff remains arbitrary/unscaled and multiView=false. Separate estimated-metric-cloud uses model-estimated, selfReported=false, verified=false; explicit offline compiler experiment only. No invented camera raster ledger, survey scale or robot validation.

See docs/world-surface-and-metrictrail.md for exact run/import commands, tests, dependencies and independent physical experiment.

November 20: the optional same-frame comparison uses the frozen JPEG directory, validates the ViPE raster and pose IDs, and scores native learned scale separately from one-anchor held-out errors. Two CPU COLMAP runs on the NVIDIA example registered 10/32 and 9/32 and both reported a fold. A measured real phone capture and GPU runs are still needed. See docs/world-reconstruction-comparison.md.
