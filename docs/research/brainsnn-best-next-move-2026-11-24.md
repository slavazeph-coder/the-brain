# Sell one robot-ready site before merging

BrainSNN's single best next move is a 30-day, founder-led sprint to sign its first paid, fixed-fee "site-to-sim" pilot of the World Builder API, sold to teams that deploy mobile robots into their customers' buildings. The offer packages what already works end to end. A phone walkthrough of one real site (captured with Walk or any camera) goes in. Within 48 hours, through the customer's own API key, a metric-scaled scene comes out: OpenUSD, GLB, IFC4 and DXF files, a Nav2-format occupancy map, a robot fit-and-route report and a per-point fit check. The operator reviews it in World Builder first, and it is invoiced by hand from the existing usage meter. This option wins because it is the only one where BrainSNN's live assets meet both a documented, unsolved pain and a buyer with budget. The pain: NVIDIA's own phone-to-Isaac workflow leaves scaling, alignment and colliders to the user. The budget: humanoid venture funding reached about **$11B by October 2026**, and Parallax Worlds signed **five robotics customers** for iPhone-built site twins. The urgency is buyers, not features. In one week brainsnn.com logged about **515 homepage requests** (bots included), the event sink holds **2 events**, and no outside party has ever called the API. The owner's "merge all into one" request loses as the main move because it polishes a front door almost nobody walks through. Its cheap part, merging the already-built PR #338 (which also switches on per-door analytics), belongs in week 1. And the pilot itself is the merge a buyer will notice, because it sells Walk, World Builder, the API and the robot workbench as one deliverable. The plan's hard targets are at least 15 problem conversations and one signed, paid pilot by 24 December. A real-room accuracy test and a successful backup restore come first, as week-1 preconditions.

## Two recorded events mean the bottleneck is buyers, not features

BrainSNN has far more working product than demand. The one thing missing is a buyer, and every technical gap that matters for a first sale is narrow enough to close in a week. Three things work end to end in production:

- **Walk** has been live since 23 November ([walk memory](../../.ai-memory/brainsnn-walk-2026-11-22.md)).
- **World Builder** runs CPU reconstruction for anonymous visitors, capped at 2 jobs per visitor and 20 per day ([flagship status](../../docs/world-builder-flagship.md)).
- **The World Projects API** passed its SDK quickstart end to end with an operator-provisioned key on 21 November. On 23 November a 6 MiB upload round-tripped through the `world-sources` bucket with a matching SHA-256 ([readiness audit](../../.ai-memory/api-sell-readiness-2026-11-21.md); [walk memory](../../.ai-memory/brainsnn-walk-2026-11-22.md)).

A monthly meter already counts API requests, jobs, upload bytes and artifact bytes per workspace, with a CSV export the docs explicitly describe as "metering for manual invoicing" ([platform doc](../../docs/world-project-platform.md)).

The demand side is empty:

- **Traffic is tiny.** In the seven days to 23 November, `/` drew 515 requests and `/world/api.html` drew 69, both including bots, CI checks and the owner's own visits. `/api/leads` and `/api/billing/checkout` drew **zero** ([front-door memory](../../.ai-memory/brainsnn-front-door-2026-11-23.md)).
- **Analytics barely exist.** Production had logged 2 events when the UI was audited on 24 November ([front-door doc](../../docs/front-door.md)).
- **There are no outside users.** "Only the owner's IP and test agents have called" the API ([readiness audit](../../.ai-memory/api-sell-readiness-2026-11-21.md)). The only provisioned tenant is the owner's own `pilot-owner`.

The table below sorts each surface by what is real today and the job it gets in the recommended move. Nothing is deleted, consistent with the owner's 23 November instruction not to remove functional layers ([front-door memory](../../.ai-memory/brainsnn-front-door-2026-11-23.md)).

| Surface | What is real today | Role in the recommended move |
| --- | --- | --- |
| Walk (`/walk/`) | Browser-only phone app; GPS track, photos, video; GeoPackage, GeoJSON, GPX and CSV exports; no paywall; never tested on a physical iPhone ([Walk doc](../../docs/brainsnn-walk.md)) | Free capture front end for pilot sites |
| World Builder (`/world/`) | CPU COLMAP, scale from one user-measured distance, scene compiler to GLB/OpenUSD/IFC4/DXF/3DM, `fit-check.json`, robot route ([handoff](../../docs/world-builder-handoff.md)) | Operator review and QA before delivery |
| World Projects API | Operator keys, S3 storage, usage meter with CSV; no signup, billing or webhooks ([API page](../../brainsnn-r3f-app/public/world/api.html)) | Delivery channel and invoicing basis |
| Scan, depth and robot-capability workbenches | IFC4, GLB, USDA, DXF and Nav2 outputs proven on a 5,053-point authored room ([BIM workbench](../../.ai-memory/world-bim-workbench-2026-11-22.md)); MuJoCo differential drive with MPPI ([robot capability](../../.ai-memory/world-robot-capability-2026-11-22.md)) | Nav2 map and robot fit checks in the package |
| Robot Arena | Scripted practice mode; no real GPU policy run; runner rejects plans over 10 episodes ([Arena memory](../../.ai-memory/brainsnn-robot-arena-2026-10.md)) | Stays live, kept out of the pitch |
| Creative Engine, Review, Agent Lab | Review live; Creative Engine and Agent Lab restored only in unmerged PR #338; keyword heuristics ([readiness audit](../../.ai-memory/api-sell-readiness-2026-11-21.md)) | Stays live, kept out of the pitch |

The repository already names the next milestone. It calls for "a paid field pilot using a real capture, independently checked dimensions, a specific robot, and observed deployment outcomes", and says to scope self-service billing only "after the private workflow produces repeat usage" ([platform doc](../../docs/world-project-platform.md)). The binding constraints are the owner's time and a single shared CPU execution slot, not missing code.

## Free capture leaves the expensive half of site-to-sim unsolved

Read together, the six research tracks point to the same place. Capture and reconstruction are becoming free. What buyers still pay for is the conversion from a scan into something trustworthy enough to act on.

| Research track | What it contributes to the verdict |
| --- | --- |
| Internal assets | The phone → scaled scene → USD/IFC → robot route pipeline is the only complete, sellable chain; payment, GPU and isolation are not |
| First-pilot GTM | Sell a fixed-fee, time-boxed paid pilot through founder outbound to small, fast buyers; invoice manually |
| Reality-capture and BIM APIs | Per-scene processing is priced near zero; developer API access is gated or abandoned by incumbents |
| Phone capture apps | Capture is free everywhere and iPhone web has no LiDAR, so Walk is an on-ramp, not a product to charge for |
| Robot sim and real-to-sim | The unsolved, paid-for pain is scale, colliders, fit and evidence for a specific site |
| Content analysis | Copy scoring is being commoditised by general LLMs, so the Creative Engine is not the lead offer |

The price floor for raw reconstruction has collapsed:

- **Autodesk's Reality Capture API** charges 1 Flex token per 50 photos, at about $3 per token ([Autodesk Flex rate sheet](https://www.autodesk.com/buying/flex/flex-rate-sheet)).
- **World Labs** sells API credits at $1 per 1,250 and charges $2.80 for a high-quality mesh export ([World Labs API pricing](https://docs.worldlabs.ai/api/pricing)).
- **Polycam** made non-LiDAR capture free on iPhone in January 2026 ([Polycam](https://poly.cam/press-release/space-mode-access-expanded-2026)).
- **Niantic** added a web USDZ export that loads in Isaac Sim on 6 July 2026 ([Niantic Spatial](https://nianticspatial.com/blog/usdz-scaniverse)).
- **NVIDIA** made Omniverse free for production use in May 2026 ([StorageReview](https://storagereview.com/news/nvidia-quietly-makes-omniverse-free-for-production-use)).

A small team selling "phone video to USD" per scene would compete with NVIDIA's free NuRec and Niantic's free export.

The step after reconstruction is still manual. NVIDIA's own NuRec documentation warns that users may need to fix scene alignment, **manually scale the scene root** and verify physics settings ([NuRec docs](https://docs.nvidia.com/nurec/robotics/neural_reconstruction_mono.html)). Its Marble-to-Isaac guide says imported scenes must be aligned to a ground plane, scaled to real dimensions and given colliders by hand ([NVIDIA developer blog](https://developer.nvidia.com/blog/simulate-robotic-environments-faster-with-nvidia-isaac-sim-and-world-labs-marble/)). Users also report scan-derived USDZ geometry distorting with distance from the world origin in Isaac Sim ([NVIDIA forum](https://forums.developer.nvidia.com/t/geometry-distortion-occurring-in-usdz-import-in-isaac-sim-distance-from-world-origin-related/362594)).

BrainSNN's pipeline already covers this ground:

- It derives scale from a user-measured span.
- It compiles floor, walls and object boxes that can serve as colliders.
- It checks every point against the model.
- It refuses coordinates whose float32 spacing exceeds 1 mm, a guard against the kind of origin-distance precision loss that forum report describes ([BIM workbench](../../.ai-memory/world-bim-workbench-2026-11-22.md)).
- It exports `nav2-map.pgm/.yaml/.json` as signed, byte-hashed downloads for admissible metric scenes. The format is tested, but a live Nav2 run has not been reproduced ([component robotics doc](../../docs/world-component-robotics.md)).

None of the AEC reconstruction vendors in the research offers a robot-route layer like the one on top.

Buyers and budgets exist in the middle of the price range:

- **Funding is abundant.** Humanoid venture funding reached about **$11B year to date by October 2026** ([Dealroom](https://dealroom.co/briefing/2026-10-06/)). Lightwheel reported about **$100M in Q1-2026 orders** for simulation, data and evaluation ([Humanoid Robotics Technology](https://humanoidroboticstechnology.com/industry-news/lightwheel-announces-100m-in-q1-orders/)).
- **The closest analogue has customers.** Parallax Worlds builds factory and warehouse twins "using only an iPhone", stress-tests robots in them, and has signed five robotics companies on a $4.9M raise ([The Robot Report](https://www.therobotreport.com/parallax-worlds-raises-4m-stress-test-robots-hyper-realistic-digital-twins/)). That proves robot builders pay for site twins, and it also means a funded competitor exists.
- **The current options are cheap and narrow, or slow and expensive.** A small simulation shop sells one-robot, one-scenario "Simulation Sprints" from **$2,000** in 7–10 business days ([MRPX Tech](https://mrpxtech.com/)). Conventional warehouse twins take **10–16 weeks** ([Silent Infotech](https://silentinfotech.com/blog/technology-solution-14/digital-twin-cost-771)), and a production-line twin costs $50K–$150K ([Ecosire](https://ecosire.com/blog/digital-twins-manufacturing-simulation)).

A reviewed site plus a robot fit report, delivered in days for low thousands of dollars, sits in the empty band between those anchors.

The buyer also fits the product's shape. Incumbent capture APIs are enterprise-gated: Polycam's API is an Enterprise add-on enabled through an account representative ([Polycam](https://poly.cam/pricing/enterprise-plan)), and Matterport sells its APIs as separate enterprise line items ([Matterport](https://buy.matterport.com/plans)). Luma has left capture ([Radiance Fields](https://radiancefields.com/luma-ai-to-sunset-flythroughs-on-january-1-2026)). Robotics teams are developer-led, so a per-customer API key with S3 delivery suits how they buy.

Mobile robots are the right slice, not manipulation or humanoid policy work. BrainSNN's walls, boxes, openings and Nav2 map answer navigation and fit questions (does it clear this doorway, can it reach that aisle). Manipulation evaluation needs photoreal splats, articulation and published sim-to-real correlation; PolaRiS sets that bar at r = 0.98 against real-world rankings ([arXiv](https://arxiv.org/abs/2512.16881)). The robotics research found **no hosted evaluation service aimed at mobile robots**, which marks the slice as open.

The offer, stated precisely:

- **Who:** one site per pilot, for a robot startup or integrator preparing a deployment.
- **Capture:** the customer captures with Walk or a phone, records one tape-measured span for scale, and records at least three held-out tape readings. That is the acceptance test BrainSNN's own launch checklist already defines ([processing setup](../../docs/brainsnn-processing-setup.md)).
- **Delivery:** within 48 hours, with a held-out error report, so accuracy is measured rather than asserted.
- **Price (hypothesis to test, not a market rate):** $3,000–$5,000, prepaid, credited 100% toward a site package signed within 30 days. The per-site price after the pilot is written into the statement of work up front. This sits inside the range the pilot playbooks support: 10–25% of expected annual value ([StartupCorners](https://startupcorners.com/blog/how-to-run-a-paid-pilot-to-validate-b2b-willingness-to-pay)), with fees credited when the customer converts quickly ([Raise Money Ventures](https://www.raisemoney.ventures/resources/blog/paid-pilot-for-startups)).
- **Paid, never free:** robotics operators warn that free pilots breed "pilot purgatory" ([General Robots](https://generalrobots.substack.com/p/so-you-want-to-do-robots-part-3-how)). Vendor data, which is directionally consistent but unverified, shows paid, scoped pilots converting at 68% against 23% for free, vague ones ([Rework](https://resources.rework.com/libraries/deal-closing/pilot-programs)).

Every sales claim must stay inside the repository's claims sheet: no "survey-grade", no "millimetre", no "native Revit", no "LOD 300" ([handoff](../../docs/world-builder-handoff.md)).

## Three runner-ups lose on audience, proof or timing

| Option | Strongest case for it | Why it loses now | When to revisit |
| --- | --- | --- | --- |
| Merge all products into one (one front door, shared header and design, Review folded into the Creative Engine) | The owner asked for it; four visual looks hurt credibility; PR #338 is already built | Polishes a front door with about 515 weekly requests and 2 events; picks no buyer; the folded product targets a commoditising market | Do the PR #338 merge in week 1; the rest at the day-30 review |
| AEC scan-to-BIM lane for reality-capture service firms | Best-documented budgets and per-project pricing | Buyers expect native Revit and LOD claims the claims sheet forbids; real-scan quality unproven; crowded field; slow cycles | Fallback ICP if robotics replies stay under 2% |
| Creative Engine as a UK/EU false-urgency compliance pre-check | Live regulatory pull and no named direct competitor | Keyword heuristics with no benchmark; route not live; buyers purchase through procurement; general LLMs do it free | After the first API pilot closes |

**Merging everything into one product** is the option the owner just raised, so it deserves the fullest hearing. The steelman is real:

- Outbound prospects will click through to brainsnn.com, and four different looks across World Builder, Walk, the Creative Engine and Agent Lab ([front-door doc](../../docs/front-door.md)) can read as a hobby project.
- PR #338 is already written. It restores `/app` and `/agent-lab` and adds `front_door_viewed` and `front_door_opened` events.

Three points still make it lose as the next move.

First, it improves the experience of an audience that does not yet exist. The homepage draws about 515 weekly requests, bots and the owner included ([front-door memory](../../.ai-memory/brainsnn-front-door-2026-11-23.md)), and the front door has already been redesigned twice in two days without usage data. #337 made `/` open World Builder; #338 reverses that to three doors. The studio's "core tool" picks are documented as "a judgement, not measured usage" ([front-door doc](../../docs/front-door.md)).

Second, the focus evidence is about one buyer and one job, not one stylesheet. YC's guidance is that startups can solve one problem well at a time ([YC Startup Library](https://www.ycombinator.com/library/4D-yc-s-essential-startup-advice)). Buildots spent six months on construction sites before writing code ([Teardown](https://www.teardown.ai/companies/buildots)). OpenSpace's first real win was settling a single contractor dispute ([MIT News](https://news.mit.edu/2020/openspace-construction-1021)). A unified header picks no buyer.

Third, folding Review into the Creative Engine strengthens the product that faces the weakest market. **83.2% of AI-using content marketers** already use Claude for content work ([Ahrefs](https://ahrefs.com/blog/marketers-ai-content-creation/)), and Jasper has retreated from copy into governance ([AI Ignitions](https://www.aiignitions.com/jasper-ai-review)).

The resolution is to merge PR #338 in week 1, for its measurement as much as its restored layers, and point the API door at the pilot offer. The shared design system and the Review fold wait until real prospect sessions show which door matters.

**The AEC scan-to-BIM lane** is the closest runner-up, and the research on its pricing is the strongest of any track:

- Modelling runs **$0.15–0.75 per sq ft** by level of detail ([The Future 3D](https://www.thefuture3d.com/equipment/compare/scan-to-bim-cost/)).
- Projects take 2–5 weeks, and rushes cost 20% more ([Scan2Plan](https://scan2plan.io/faq)).
- IFC exports that silently drop data are a documented complaint ([Autodesk Revit Ideas](https://forums.autodesk.com/t5/revit-ideas/fix-ifc-export-errors/idc-p/13075799)), which BrainSNN's per-point fit check speaks to.

It loses for now because BrainSNN's scan-to-BIM evidence is a 5,053-point authored room with four walls, and its own claims sheet rules out the "native Revit" and "LOD 300" language this buyer shops for. Meanwhile, AI scan-to-BIM entrants already make self-reported claims of 48-hour Revit models ([Moving Atoms](https://movingatoms.ai/blog/ai-scan-to-bim/)) and 70–80% less modelling ([Timspark](https://timspark.com/blog/automated-bim-generation-from-lidar-point-clouds/)). Offshore Revit labour lists at roughly ₹950–1,000 (about $11–12) an hour ([IndiaMART](https://m.indiamart.com/impcat/bim-modeling-services.html)), and first closed construction-tech revenue typically lands in months 4–6 ([SaaSHero](https://www.saashero.net/strategy/construction-tech-gtm-strategy/)). The pipeline is the same, so this lane is the plan's switch-over if robotics outreach underperforms.

**A Creative Engine compliance pre-check** has genuine regulatory pull:

- The UK CMA's first direct fine under its new consumer-law powers was **£4.2m** for drip pricing ([Macfarlanes](https://www.macfarlanes.com/insights/102o47w/taking-stock-of-the-first-18-months-of-the-cmas-new-direct-consumer-enforcement/)).
- In October 2026 the CMA issued about £6m of fines driven by fake countdown timers ([Lexology](https://www.lexology.com/library/detail.aspx?g=086a86e1-c4f6-46ed-b330-fdc90efcb361)).
- The EU's Digital Fairness Act, proposed on 11 November 2026, would blacklist fake scarcity, with fines of up to 6% of turnover ([Quartz](https://qz.com/eu-digital-fairness-act-dark-patterns-addictive-features-111126)).
- The research found no vendor selling false-urgency ad-copy scoring as a named product.

It loses because the engine is keyword heuristics. On 21 November its public text endpoints scored a pressure-heavy sample at 0.28 pressure, with "clarity" as the dominant affect. The audit's own verdict is "do not sell these as an accuracy-backed API without a benchmark" ([readiness audit](../../.ai-memory/api-sell-readiness-2026-11-21.md)). The `/app` route is not live until PR #338 merges, the DFA is not yet law, and the result would not be the World Builder API the owner wants to sell.

Two other ideas are not contenders:

- **Hosted robot policy testing** has no qualified GPU and no real policy run behind it, and the GB10 runtime is not deployed ([flagship status](../../docs/world-builder-flagship.md)). The research also found no published per-evaluation price anywhere, against free tools such as Isaac Lab-Arena ([NVIDIA](https://developer.nvidia.com/blog/simplify-generalist-robot-policy-evaluation-in-simulation-with-nvidia-isaac-lab-arena)).
- **Paid Walk plans** would face free capture everywhere. iPhone Safari also offers no WebXR ([TestMu](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/)) and no screen-off background location ([WebKit bug 193946](https://bugs.webkit.org/show_bug.cgi?id=193946)), and GIS buyers already have free QField ([QField](https://qfield.org/pricing/)).

## Seven risks, mostly owner-only chores

Most risks that could sink the first pilot are operational, not commercial, and most need the owner's hands rather than code. The commercial risks are the December slump in replies and a competitive window of roughly a year.

| Risk | Evidence | Mitigation in the plan |
| --- | --- | --- |
| Real-site accuracy is unproven | Every fit figure comes from a dataset or synthetic run (Mip-NeRF room: floor 0.7 cm, walls 2.7 cm, objects 5.6 cm median, model to points); the real-room acceptance item with three held-out readings is unticked ([handoff](../../docs/world-builder-handoff.md); [processing setup](../../docs/brainsnn-processing-setup.md)) | Week-1 real-room run; publish the held-out error whatever it is, and set the pilot's success threshold from it |
| One shared CPU slot and no process isolation | One running job and eight queued for all owners; adapters share a service account and filesystem ([API page](../../brainsnn-r3f-app/public/world/api.html)); free visitor jobs use the same slot | One pilot at a time; lower visitor caps on delivery days; disclose the isolation limit in the statement of work |
| Data durability and deletion | Production backups unverified ([readiness audit](../../.ai-memory/api-sell-readiness-2026-11-21.md)); the API has no delete ([walk memory](../../.ai-memory/brainsnn-walk-2026-11-22.md)) | Restore drill before any customer upload; a written manual deletion procedure |
| Slow buyers, especially in December | Cold email replies run about 3–5% and are lowest in December ([Belkins](https://belkins.io/blog/cold-email-response-rates)); median B2B time to first revenue is 6–12 months ([Foundra](https://www.foundra.ai/key-reads/time-to-first-revenue-startup-data)); a single low-reliability source says under 30% of robotics pilots convert ([UplinkLogic](https://www.uplinklogic.tech/topic/system-architecture/humanoid-robots-pilot-purgatory)) | Front-load outreach into 2–12 December; judge the sprint on leading indicators; post-pilot price and decision date written in before the pilot starts |
| The window is closing | AMD is buying World Labs for about $8.2B ([SiliconANGLE](https://siliconangle.com/2026/09/28/amd-acquires-world-model-developer-world-labs-for-8-2b/)), and World Labs bought real-to-sim firm SceniX ([World Labs](https://worldlabs.ai/blog/scenix)); Antioch raised $32M for simulation testing ([SiliconANGLE](https://siliconangle.com/2026/09/08/antioch-raises-32m-to-move-robot-testing-into-simulation/)) | Compete on verified scale, fit evidence and turnaround, not reconstruction; move now rather than after more features |
| No payment path | Stripe and Supabase return 501 ([front-door doc](../../docs/front-door.md)); the connected XIO Stripe account lacked tax setup in September ([GT3 checkout memory](../../.ai-memory/gt3-checkout-2026-09.md)) | Decide which entity invoices; a one-off invoice from the usage CSV; no metered billing until a pilot converts |
| Hygiene gaps a prospect could hit | An exposed Anthropic key awaits rotation, and Walk has never run on a physical iPhone ([flagship status](../../docs/world-builder-flagship.md)); the bare `brainsnn.com` returned 404 on 28 October ([processing setup](../../docs/brainsnn-processing-setup.md)); several depth models are non-commercial ([handoff](../../docs/world-builder-handoff.md)) | Close all of these in week 1; outreach links use `www`; pilot jobs use only commercially licensed engines |

Two uncertainties deserve stating plainly. The research found **no published per-scene price for any real-to-sim vendor**, so the $3,000–$5,000 figure is a hypothesis that buyers' answers will correct. And the size of the API waitlist was never recorded, so it could hold zero warm leads or a dozen.

## Thirty days, four Tuesday gates, one signed pilot

The sprint runs from 25 November to 24 December 2026. Each week ends with a gate whose numbers decide whether to continue, adjust the message or switch to the AEC lane. The funnel assumptions come from outreach benchmarks: about 3.4% average cold-email replies ([The Digital Bloom](https://thedigitalbloom.com/learn/cold-outbound-reply-rate-benchmarks/)), about 21–30% LinkedIn connection acceptance ([SmartReach](https://smartreach.io/reports/state-of-linkedin-outreach/)), and the best replies coming from founders and small firms ([Belkins](https://belkins.io/blog/cold-email-response-rates)). At those rates, about 400 personal, founder-signed touches should yield 12–20 replies. The share of replies that become calls and then pilots is an assumption, not sourced data.

| Week | Focus and work | Gate (measurable) |
| --- | --- | --- |
| 1: 25 Nov–1 Dec | **Make one real site safe to sell.** Restore-test the Postgres backup. Rotate the exposed key; fix the apex domain or standardise on `www`. Merge PR #338. Test capture on a physical iPhone and an Android phone. Capture one permitted real space with a measured span and at least three held-out readings, then run it through the `pilot-owner` tenant to USD, IFC4, DXF, Nav2, fit check and robot route. Write the one-page offer and statement of work, and put the offer on `/world/api.html`. Export the waitlist. Build a list of 150 named mobile-robot startups and integrators, plus 50 AEC service firms in reserve. | Tue 1 Dec: restore succeeded; real-room pack published with median and worst held-out error; capture-to-delivery time measured; statement of work and price written; at least 150 named targets; first non-owner `front_door_viewed` events recorded |
| 2: 2–8 Dec | **Outbound before the holiday slump.** Send 200 founder-signed emails and LinkedIn messages, each linking the real-room pack and a 60-second demo. Personally email every waitlist entry. Book discovery calls. | Tue 8 Dec: at least 200 touches; reply rate of 3% or more (at least 6 replies); at least 3 calls booked. Below 2%: rewrite the message. Still below 2% after 100 more touches: switch the remaining volume to the AEC reserve list |
| 3: 9–15 Dec | **Calls into written offers.** Send 150–200 more touches and hold at least 6 discovery calls. Send a written proposal to every qualified prospect (named budget owner, real site available within 30 days), with fixed fee, end date, one success metric and post-pilot price. Process a short sample clip only for qualified prospects. Dry-run tenant provisioning and the invoice. | Tue 15 Dec: at least 350 cumulative touches; at least 8 conversations; at least 2 proposals out; new tenant provisioned in under an hour; invoice template ready |
| 4: 16–24 Dec | **Close, deliver, decide.** Issue the first invoice, provision the key, process the customer's site and deliver within 48 hours of receiving the capture. Export the usage CSV. Track analyst minutes, failed captures and held-out error, as the platform doc asks ([platform doc](../../docs/world-project-platform.md)). Write a day-30 decision memo. | Thu 24 Dec: at least 1 signed, prepaid pilot (stretch: 2–3); at least 15 problem conversations; first delivery within 48 hours, with its error reported; next build chosen only from what the pilot actually needed |

To keep every layer working, the CI layer smoke test that arrives with PR #338 (`tests/world/layers_browser_smoke.py`) becomes a required check, each front-door destination gets a weekly production check, and non-pilot work is capped at one day a week. That one day covers Robot Arena legibility and the shared-header work. If no pilot has signed by 24 December, the fallback success condition is at least two written proposals with decision dates in January. Free pilots to rescue the numbers are not an acceptable substitute.

## Conclusion

The owner's two requests, "sell the World Builder API" and "merge all into one", look like competing priorities but resolve into a single move once "one product" means one paid pipeline rather than one header. A mobile-robot team buying a verified site package experiences Walk, World Builder, the API and the robot workbench as a single product without anyone redesigning a page. The first paying customer's sessions, not a guess at core tools, should then decide what the unified front door emphasises.

The less obvious insight is that BrainSNN's habit of honest labelling is its sharpest sales asset in a market full of self-reported accuracy claims and vendors that leave scaling to the user. Publishing a real room's held-out error in week 1, even a disappointing one, gives prospects what PolaRiS-style buyers and IFC-burned service firms say they lack: measured evidence. With chipmakers absorbing world models and NVIDIA giving away the base layers, that measured, site-specific trust is likely the part of the stack a small team can still own. It is also likely to be bundled away within about a year, which argues for selling it this month rather than polishing it further.
