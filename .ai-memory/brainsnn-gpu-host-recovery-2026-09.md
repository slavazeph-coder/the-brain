---
type: project
description: PR143 local revalidation and separate Vast host CDI/network recovery requirements
---

# GPU host recovery — September 9, 2026

The owner supplied screenshots of Vast machine15904, RTX4090, with publicIP50.99.12.201 and a cropped `failed to inject CDI devices: unresolvable CDI devices` error. The previously emailed endpoint142.179.227.252:40008 still times out before authentication. A single TCP-only check of50.99.12.201:40008 also timed out, but that port is not confirmed for the screenshotIP. Do not silently combine the new address with an old instance port.

The CDI error is a host/container startup issue; it may prevent the background container's SSH from starting, but the precise fault and connection to the timeout remain unverified. Need host nvidia-smi, toolkit/runtime versions, full container State.Error and current port mapping. Newer toolkit JIT-CDI failures can surface as unresolved devices; do not assume missing YAML or blindly upgrade/reinstall the host.

Revalidated implementation9702bde on Node22:904 app tests,11 runtime tests,7 queue tests, lint/build, deterministic API smoke and5 HTTP mock-GPU checks passed. No app defect found. Added ops/gpu/host-recovery.md with official NVIDIA/Vast references and conditional operator steps. No remote command ran, no host repair performed, no production variables changed and no email sent. Private keys were not read/copied.

The original dirty ~/the-brain remains preserved. PR143 is draft. Hermes handoff lives at ~/.hermes/handoffs/brainsnn-4090.md; Codex readiness watcher remains active until ownership is explicitly coordinated. Real GPU validation, durable startup/backups and useful ongoing workload remain pending.
