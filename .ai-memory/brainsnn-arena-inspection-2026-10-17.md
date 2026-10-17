---
type: project
description: Native Arena inspection implementation, durable recording contract, offline interchange and deployment boundaries
---

# Native Arena inspection — 2026-10-17

Owner approved building and deploying the inspection research, including merge.
Implementation branch: `codex/arena-inspection-layer`; based on the already
merged lobby/Review/nav work (#186–188, main `329602b2`).

- Native **Inspect run** follows a completed run. Local bundle import requires
  no worker. Public navigation and the single paused mission/Run remain intact.
- `public/arena/arena-recording.js` checks exact manifest bytes, SHA256 artifact
  digests, bounds, typed source references, complete/partial coverage and declared
  producer identity. A matching digest does not authenticate execution.
- The inspector shows linked camera inputs, returned chunks, chosen controller
  inputs and states, findings/limits, compatible-run comparison, local review
  notes bound to an exact manifest hash, and original/selected exports.
- Existing scripted exports stay partial and explicitly practice. Fresh practice
  carries actual task/state/revision declarations; it never claims a named model.
- `robotics/arena/workers/arena/recording.py` is a bounded asynchronous recorder
  with durable committed prefixes, lossless policy-interface inputs, crash
  recovery, archive retention, and read-only endpoints independent of sessions.
  `ARENA_READ_TOKEN` cannot create or control sessions. Use a private persistent
  `ARENA_RECORDING_DIR`; the website does not start this worker.
- `robotics/arena/inspection/interop.py` provides optional local LeRobot v3.0
  (shared Parquet/MP4 episode offsets and actual PTS) and MCAP interchange.
  Dataset actions remain labels, not evidence of applied control. Generic MCAP
  preserves original bytes/timestamps; ROS CDR is not interpreted. Compressed
  MCAP chunks are refused before decompression. See `docs/arena-inspection.md`.
- Browser inspector has no control client or imported remote-fetch behavior.
  Model hypotheses remain separate from facts/rules/human judgments. No learned
  video explanation model, new pricing/capture, ROS control or named-policy run
  is included. Rerun/terminal integration remains optional future work.
- Tests use worker doubles and real synthetic local video/Parquet/MCAP fixtures;
  they do not prove CUDA/EGL, π0.5 or hardware behavior.
- Website and worker-kit release verification is recorded in the release PR.
  Live GPU worker rollout needs authenticated host access and real policy checks.
  At implementation time the saved SSH endpoint timed out and the GPU validation
  workflow lacked its trusted-host secret; no host-key bypass was used.
