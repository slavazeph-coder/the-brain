---
type: project
description: Five-sense cart and delivery evaluation with training-only clue priorities and recorded-view recall
---

PR [328](https://github.com/slavazeph-coder/the-brain/pull/328) builds on the showroom PR 327. Feature commit 77f4b68e. The interactive cart trial uses five simulated input channels and an independent scorer. A small fixed food station classifies virtual sweet/sour readings; smell is a local categorical sample. There is no hardware capture, chemical source tracking or model training on the test rooms. Memory learns the priority of observations from 12 seeded cases on three training layouts. A decision receives only a restricted observation record. The ground simulation plans from a known floor after the agent chooses an object. The transfer goal requires fitting a cargo width and distinguishing applicable bay signals.

On 180 balanced cases across three other layouts, fixed-order active/memory strategies got 71/75 evidence-backed decisions in difficult cart search and 178/178 (each out of 180) in the delivery task. Removing smell or taste from the memory strategy gave 54 or 60 decisions versus 75 with all channels. Memory is not a consistent improvement across bodies or suites. The 18-case quick benchmark remains separate, plus visual positive controls. No physical validation or AGI claim. Reproduce with node scripts/world-demo/benchmark-senses.mjs.

Autoregressive View Model (Meta/Oxford) inspired retrieving a room’s actual retained pictures by position, optional heading, time-associated frame and observed object. No upstream AVM weights or synthetic view generation. Scentience motivated local olfactory input; no SDK integrated. 636 World tests passed. Draft preview only.
