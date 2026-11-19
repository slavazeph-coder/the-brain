---
type: project
description: Local reviewed appearance objects, deterministic variants and source-bound camera handoff, with manual/full-resolution/physical limits
---

Owner reference https://lnkd.in/p/gJAXHd26 resolves to Niantic Spatial Object Interaction beta, officially announced November 10, 2026: https://www.nianticspatial.com/blog/introducing-object-interaction. It describes candidate identification, extraction, review and rearrangement, with simplified physical estimates. No public comparative benchmark or implementation was found. Do not claim BrainSNN beats its extraction or physics.

`public/world/splat.html` adds a local workshop for manual rectangle/Y-slab selections of retained PLY/SPLAT samples, boundary review, named masks, transforms, copies, hiding, exact reset, seeded layout variants and separate binary derived PLY/edit JSON/receipt. Actual Gaussian quaternions rotate with sample positions. Immutable original source and raw source vertex IDs retained. Limits: 100k visible preview samples,32 base masks,64 instances,16 variants; separate worker50k limit unchanged. Hidden instance bounds use8 corners, avoiding per-hidden-instance sample buffers. Unsupported Gaussian PLY scale ranges refuse export rather than clamp.

New files `objectify-core.mjs`, `objectify-ui.mjs`, `objectify.css`; parser v2 exports original raw indices and sampling metadata. Camera studio binds the exact derived PLY hash, clears stale views/clips on selection/edit, locks staged variants to authored provenance and rejects nonauthored path imports. Axis changes require resetting object groups. Source/orientation changes cancel pending operations.

This is manual retained-preview appearance editing, not automatic complete object extraction, full higher-order SH preservation, measured scale, validated collision/physics/BIM or physical robot evidence. Proposed sample-centre boxes are unchecked; mass/friction/inertia and BIM class null. Moving/removing objects exposes unknown background. Existing IFC/Rhino/component/operational twin tools remain separate. Detailed runbook and next SAM2/frame projection experiment: `docs/world-object-workshop.md`. Keep original corrected reconstruction and route evidence separate from authored variants; never present this layer as replacement physical evidence.


Offline evaluation proposal on the #305 merge: see `docs/world-object-evaluation.md`. It replays the actual appearance edit/receipt/PLY and projects the original retained sample centres with the worker camera ledger. The showroom baseline has 3,885 sparse points and 52 registered views. Its 140 prepared rasters were recovered from the matching saved video and checked against their archived digests. Frames 0085 and 0089 show the same chair. A corrected-trial designation, independently reviewed masks and a reviewed chair selection still need evidence. No capture segmentation score has been obtained.

The later showroom feasibility replay is documented in the evaluation guide. The local dense trial produced 18,372 centres, with conditional upper bounds of 4.54% and 3.20% in views 0085 and 0089. Both native candidates remain unreviewed. Keep private frame and mask handoffs outside the public repository.
