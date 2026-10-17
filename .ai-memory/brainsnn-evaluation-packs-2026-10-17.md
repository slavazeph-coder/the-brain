---
type: project
description: Robot-arcade commercial focus and bounded real ten-episode campaign runner with inspectable evidence
---

# Robot evaluation packs — 17 October 2026

Owner explicitly corrected the revenue direction: focus on the robot arcade becoming usable and selling 10/1,000/100,000-instance robotics testing. General Python audits and manual recording-review services are not the product focus. Treat pack sizes as completed episodes; concurrency is a separate quantity. No response to the optional episode/concurrency clarification was received before implementation.

- `inspection/campaign.py` and `scripts/run-campaign.py` add a sequential operator-owned runner after a saved real execution pilot. Default: LIBERO Spatial tasks0–9, seed7, Panda/π0.5. Exported locked single-task plans up to10episodes also work. Larger plans remain unqualified and are rejected by this runner.
- Exact worker/checkpoint and accepted pilot are pinned. Private atomic ledgers and per-case files support resume; interrupted/inflight attempts are not silently retried. Complete camera/inference/controller/state/outcome bundles are verified before counting a completed task success or220-step miss. Partial recordings, infrastructure errors and interruptions remain separate.
- Wall-time/output-byte limits are enforced; no compute is provisioned and no provider spending limit is claimed. Tokens remain in `ARENA_TOKEN`, redirects/credential-bearing URLs are rejected, and arbitrary remote exception text is not saved. Outputs stay outside git and the extracted kit.
- Campaign UI imports small local reports with strict count/case/state checks, inert text rendering, no network requests and repeated initial-state coverage. Reports remain unsigned summaries; inspect each native bundle for execution evidence. Unique conditions use task+suite-stateID, not seed count or post-settling hash variations.
- Removed the separate assumed-throughput/price calculator. Old `#compute` links open evaluation packs. The browser toy-grid comparison remains separate.
- Fixed an archive finalization race: a reader that observes no final marker then an inactive writer rechecks the marker before declaring partial. A deterministic regression fails before the fix and passes afterward.
- `docs/arena-evaluation-packs.md`, generated `evaluation-setup.html`, and downloadable kit carry the operator flow. `docs/robot-evaluation-product.md` defines the robotics release-check product and measured gates for larger packs; no invented prices or throughput.
- Preserve the independently requested arcade interaction restoration (upfront robot/model selection) if its parallel branch merges. Do not reintroduce the old first-run visibility restriction over that correction.

## Hardware and commercial gates

A read-only GB10 preflight on17October found ARM64, driver580.159.03, an active resident loopback text service, approximately101GiB available system RAM and11GiB free on50GiB overlay storage. Default Python had no Torch/JAX/MuJoCo/LIBERO. No packages/files/services were changed. Robotics runtime/EGL and durable checkpoint storage remain unqualified; preserve Hermes/Ollama, drivers and existing ports. 4090 remains unavailable.

The first10episodes qualify the system; they do not establish customer demand, a score, a price or fleet-scale capacity. Paid private-checkpoint regression and paired baseline/candidate support require compatibility checks and measured delivery costs. A paired comparison consumes two policy episodes per condition.
