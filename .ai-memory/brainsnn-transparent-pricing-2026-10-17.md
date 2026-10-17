---
type: feedback
description: Owner wants visible robotics scale and transparent pricing, restoring the historical US$171.43 runtime illustration
---

# Transparent robotics pricing — 17 October 2026

Owner corrected PR195's simplification: “I feel it was more sellable when it was 171 dollars for 100000 instances and pricing was more transparent.” Simplify operational complexity without hiding the commercial scale, price anchor or assumptions. Keep the playful robot/model choices. This supersedes the earlier blanket “no public price” interpretation; no fake execution/available-capacity claim is authorized.

History verified: original calculator introduced in `de3339030dafeb825e9dc9b3988890474130bc9b`, removed in PR192 (`58a305c0`). Defaults were 100,000 total trial episodes, 500 episodes/worker-hour, US$0.60/worker-hour and 30% gross margin. `100000 / 500 * 0.60 / 0.70 = US$171.43` runtime customer price, comprising US$120 runtime cost and US$51.43 gross margin allowance. Currency is USD, not CAD. This is a 42.86% markup, not 30% markup. It excluded startup/loading, storage, transfers, retries and external inference; operator support and taxes are also outside the restored runtime illustration. Throughput was assumed, not measured; 500/hour implies 7.2 seconds/episode.

Current implementation restores a visible price illustration and 10 / 1,000 / 100,000 episode choices. Homepage and crawler copy use the same pricing model as the public calculator. Counts mean total task attempts, not simultaneously running robots. Public pricing hypotheses remain separate from measured pilot/session/campaign evidence and do not launch compute or payments. Hosted policy runs and larger execution capacity remain pending GPU qualification and measured delivery costs.

Local validation: 1,082 application checks (14 new pricing checks), 73 paid-analysis checks, typecheck/build, Arena logic, source/dist HTTP checks, 10 affected navigation browser checks and 6 production homepage/pricing/social browser checks passed. Dedicated pricing browser tests cover blank/invalid edits, slow throughput, correct margin, balanced displayed cents, no network or evidence/plan mutation, and 320/390px first-screen pricing. Existing campaign and actual-asset selection browsers pass.

Implementation lesson: dynamic route metadata used JavaScript replacement strings with `$1`/`$2`; the literal price US$171.43 introduced an accidental `$1` backreference and corrupted description tags. Replaced dynamic title/meta/URL/image replacements with callbacks. Regression checks literal description equality across standard/OG/Twitter tags; production SSR also checked JSON-LD.
