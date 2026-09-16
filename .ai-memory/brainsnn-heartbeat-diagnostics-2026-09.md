---
type: project
description: Local heartbeat subtype diagnostics, reproduced deadline/response cleanup bugs, and report-only stop marker investigation
---

# September 14 — bounded local heartbeat diagnostics

Based on local commit `a7a28d8`; changes are uncommitted and not deployed. No network, production access or real credentials were used. Evidence and test limitations are in `outputs/HEARTBEAT_DIAGNOSTIC_RESULT.md`.

Reproduced before fixing: deadline shutdown followed by partial JSON bypassed the expiry check and raised JSONDecodeError; a bounded rejected HTTP/1.0 response stayed open after HTTPConnection detached it while its exception traceback remained retained. The worker patch explicitly closes JSON/artifact responses and preserves an observed deadline as a transport timeout. Concurrent request deadlines were isolated in controlled overlapping tests; no shared deadline interference was found. Neither bug proves the reported live heartbeat cause.

Heartbeat transport reasons now have fixed suffixes `timeout`, `connection`, `http_5xx`, `http_429`, or `unknown`, validated again before reporting. A local fixed-code warning follows cancellation even if failure reporting is unavailable. The two-second heartbeat budget, fail-closed lease timer, cancellation category and three-attempt scheduler ceiling remain intact.

Native stop investigation is report-only: `Runtime stopped` attests PID verifier disappearance, not successful cleanup. A remaining active marker can coexist with no children and triggers the next-start latch. Normal run-loop cleanup removes the marker. Runtime stop/latch code is unchanged; do not clear markers based only on absence of children. Details and five synthetic reproductions are in `outputs/heartbeat-stop-marker-diagnosis.md`.

Memory pull/push intentionally not run: this task explicitly prohibits network and commits.
