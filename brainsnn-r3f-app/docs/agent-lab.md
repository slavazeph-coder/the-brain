# BrainSNN working agent lab

BrainSNN’s homepage positions the product as **“AI work that earns its keep.”** Agents build context, test ideas and earn further resources through accepted work and observed commercial contribution. XIO owns customer delivery and the operator desk; BrainSNN displays selected public evidence.

## Departments and first mission

| Department | Initial role | Condition for expansion |
| --- | --- | --- |
| Content optimizer | Test evidence and messaging against buyer response; use warm introductions and referrals, supported by LinkedIn proof content. | Repeatable improvement in qualified conversations and paid work. |
| App production factory | Deliver bounded tools and helpers for identified customer needs. | Paid demand and repeatable delivery justify a standalone product. |
| Interdimensional stream | Present selected recorded experiments, failures and promotions. | Returning viewers justify continuous production costs. |
| Robotics simulator farm | Preserve existing experiments; park new farm spending during the first commercial experiment. | A funded use case and one reproducible learning environment. |

The initial commercial mission is XIO’s **US$1,500 remote AI Team Setup Day** for owner-led service businesses. Compare the current message with one challenger while keeping the offer and price fixed. The displayed offer price is not reported revenue. The homepage links to the offer and, in its footer, the authenticated XIO operator desk.

## Public feed and evidence boundary

The browser reads `GET /api/agent-lab/summary`. BrainSNN fetches only `https://www.xioai.co/api/agent-lab/summary` and copies an explicit allowlist. The source request rejects redirects, times out after four seconds and permits at most 64 KiB. Snapshots older than five minutes or over one minute in the future are rejected. Concurrent requests share one fetch. Relay and HTTP caching are capped at 30 seconds and expire no later than a recorded snapshot's five-minute freshness deadline; HTTP caches must revalidate after expiry.

The version 1 public response contains:

- `mode`: `recorded` or `unavailable`, with a dated `generatedAt` for recorded snapshots.
- Work counts: ready, running, blocked, review and accepted.
- Evidence counts: accepted deliveries, verified paid deliveries, context candidates and promoted contexts.
- At most 12 selected events, with generic public IDs, timestamps, allowed status values and server-authored labels.

Counts are nonnegative safe integers or `null`. Unknown evidence displays **—**; only an explicitly supplied zero displays zero. The UI checks on load and manual refresh, shows the snapshot date, and clears displayed evidence after a failed refresh. Unavailable data and a valid snapshot with no approved events have separate states.

The projection excludes customer identities and contacts, internal worker IDs, prompts, artifact bodies, private context, credentials, payment identifiers, raw receipts and arbitrary upstream labels or errors. Revenue authority stays with deduplicated XIO payment records. Accepted output, payment evidence and context promotion remain separate; model scores cannot establish sales.

The client normalizes the relay’s uppercase lifecycle enums for display. Unknown statuses remain “Recorded”; rejected work is “Returned for revision.” Blocked dependencies are distinct from worker failure.

## Recorded work, simulations and preserved tools

The office diagram is labelled **Operating design**, with no invented employees or activity. Replay events are chronological, dated records with manual selection and optional three-second playback. Playback never starts automatically; unavailable replays are disabled and refreshing resets playback.

The stream’s fictional setting and existing simulations do not count as commercial evidence. Context lessons begin as sourced, dated, versioned candidates; independent review and subsequent tests precede promotion into standing instructions.

Preserved routes: `/app`, `/missions` and its existing mission routes, `/arcade`, `/lab`, `/lab/survival`, `/reconstruct` and `/evidence`. The homepage links to principal tools; Arcade challenge links use `/arcade?lab=…`. Homepage social metadata uses `public/agent-lab-og.png`, an actual 1200 × 630 screenshot. Existing tools and shared circuits retain their respective previews.

## Working-time plan and future operating targets

Initial working-time priorities are **70% acquisition and delivery, 20% execution and evaluation, 10% public storytelling**. These are operating targets, not measured utilization or automatic scheduling by the public frontend.

The following gates begin from the experiment’s actual start date and remain future targets until supported by records:

1. **Days 1–14:** establish a dated baseline, verify execution and complete a task-to-delivery dry run, including interruptions, retries, duplicate receipts, refunds and missing attribution.
2. **Days 15–45:** obtain a paid engagement and accepted delivery while recording direct costs and owner effort.
3. **Days 46–90:** target three independent paid, accepted deliveries with positive time-adjusted contribution. This is an operating milestone, not statistical proof that a message wins.

If conversations stall, revise acquisition; if purchases stall, revise the offer. New departments, continuous broadcasting and standalone subscriptions require evidence before expansion.
