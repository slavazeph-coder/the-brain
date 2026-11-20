---
type: project
description: Fresh shared correspondences, graph screening and CPU replay for a pending DeepBA research candidate
---

Owner reference https://lnkd.in/p/dGMycR4A is DeepBA, https://arxiv.org/abs/2611.18256 / https://cphjsn.github.io/deep-ba/ . Checked November16Toronto: official cphjsn/deep-ba commit3ff903c1fa3e4f020fb7e93fd322688c113a5c79 is a website, code coming soon, no inference weights/softwarelicence. PaperCCBY is not a softwaregrant. Do not claim DeepBA integrated/executed, 71xspeed or metric phone accuracy. Paper's 2.04M parameter count is not executionmemory; reported24GB case and adverse drift/tight-accuracy results matter.

Added offline shared-correspondence preparation/audit + classicalCPUreplay beside current COLMAP/VGGT/VGGT+BA harness, without changingproductiondefault. Fresh pinnedPyCOLMAP4.2.1 SIFT/exhaustivematches beforeanysolve, exact source/capture/DB/array/code hashes, allframesdenominator, completepair indices/rawhalf-pixel endpoints, estimatedcamera priors. PreservefrozenDB; solverusesprivatecopy. No naivetrackfusion, solvedabsoluteposes or3D in cold-startinput; pairwiseverificationgeometry stays inDB. ExistingretainedDBwasnothashedbyoldcomparisonreceipts, so publiccommanddoesnotpretendretrospectiveDBprovenanceisfresh.

Graphdiagnostics are screeningonly, notbaseline/parallax/geometry/physicalaccuracyvalidation. Fullverifiedgraph and separate≥50match/pairpaper-candidategraph; diagnosticfilterneverchangesCPUreplayDB ordefaultphoneacceptance. Futurefairsolvercomparisonrequiresidenticalfrozenfilteringandlens/pixeltransforms. DirectDeepBAAPIunknownuntilrelease, nofakeadapter. Invalid/tampered/oversizedpacksfailratherthansilentlythin. Timingseparatesmatchingfromreplayanddoesnotpretendcachedmatchingfree. No paidAPI/modeldownload neededforCPUcommands.

Runbook `docs/world-deepba-experiment.md`; commands `python -m robotics.world_worker.match_graph_experiment prepare|inspect|replay-colmap|status`. CurrentlayerCLIonly, notwebsiteuploadorautomaticobjectsegmentation. Scale/BIM/collision/robotvalidationremainseparate. Anyexecutedauthoredroomfixtureissoftwareevidence, notphysicalphoneaccuracy orDeepBAauthorbenchmarkreproduction.
