# Real NVIDIA package composition qualification

The qualification command exercises the production SimReady bridge on NVIDIA's
`IV_pole_a01` package at immutable revision
`653d91e182011f357cf1644013cc94ddf194d349`. It uses the CC-BY-4.0 package with its
original license, attribution, metadata, geometry and textures retained.

```sh
python -m pip install numpy==2.2.6 Pillow==11.3.0 usd-core==25.8
python -m robotics.world_worker.nvidia_pack --workspace /tmp/brainsnn-nvidia
python -m robotics.world_worker.qualify_simready \
  --workspace /tmp/brainsnn-nvidia --out /tmp/brainsnn-qualification \
  --license-reviewed --placement-reviewed
```

Download once; omit the download command when the package directory already exists.
The qualifier rechecks every cached file against the pinned upstream tree, including
Git blob hashes and LFS SHA-256 hashes. It also rejects missing, extra and symlinked
files. A rewritten local receipt cannot qualify changed cached bytes.
Use a fresh output directory. The review flags refer specifically to this NVIDIA
license and two isolated test placements; they do not approve arbitrary packages
or changes to a captured room.

The command builds a library record from the source-bound Package-Candidate report,
records that validation as upstream-reported, hashes the entire local package and
binds placement approval to those bytes. It places two unscaled copies at
`[1, 0, 2]` and `[-2, .25, -1]` metres; the second is rotated 35 degrees about Y.
It converts the outer frame from Z-up to Y-up while retaining the vendor's transforms.
The package is copied once and referenced by both placements.

After writing, the command moves the assembly directory and reopens it. It checks:

- All used USD layers and active asset-valued dependencies resolve inside the relocated
  assembly, including instance-proxy materials and every authored time sample.
- Collider, rigid-body, joint-target and selected-variant records match the source.
- Each collider's composed transform equals its source transform followed by the
  requested placement/basis transform, within `1e-6` matrix arithmetic tolerance.
- Bounds are finite, authored colliders are enabled, and no composition error occurs.

`qualification.json` includes these records, CPU elapsed time and the process's
peak resident memory. `portable-assembly/` is self-contained for these inspected
USD dependencies and includes `ATTRIBUTION.md`, original license text, copied package
and the bridge receipt. `source-verification.json` records every checked source file.
The GitHub **World Omniverse qualification** workflow executes the same command and
retains the complete portable package and exact source snapshot for seven days.

## Executed local result, October 28, 2026

The real package contained **118 files / 421,351,635 bytes**. The BrainSNN package
receipt was `5d0473092f14c33be385be268b0060d679e63629ae6d7ba9c4f9785a68ad2f01`.
OpenUSD 25.8 inspection found **16 enabled colliders, all instance proxies**, **16
rigid bodies** and **15 joints**. The old `stage.Traverse()` count missed all of
these colliders because it excluded instance proxies. The default vendor variant
was PhysX enabled, with MuJoCo and Newton disabled.

Both placements survived composition and relocation, yielding **32 colliders,
32 rigid bodies and 30 joints**, with exact collider-transform agreement in that
run. There were **308 active asset-valued references / 16 unique files per asset**,
all resolved in the copied package. Source Z-up bounds were approximately
`0.7221 × 0.5709 × 1.7994 m`. The initial local qualification took about **1.9 seconds**
after download, with **104 MiB** process peak resident memory on the Mac. These are
CPU inspection figures, not GPU/Isaac performance measurements.

## Remaining simulation acceptance

`physics_ready`, `physics_tested` and `metric_verified` remain **false**. Selecting
the vendor's PhysX variant does not run PhysX. Packaging conformance was not rerun,
shader/MDL programs were not executed, and inactive variant asset-valued attributes
are not covered by the active-stage audit. This is an operator workflow for reviewed
packages, not an untrusted-upload sandbox.

The available RTX 4090 worker has not yet been provisioned with a compatible Isaac
Sim graphics/runtime installation. Actual Isaac loading, SDF-collider contacts,
articulated motion, mass/inertia behavior, task collisions, memory under simulation
and stress tests remain necessary before physical use. No robot or captured-room
accuracy is established by this composition check.
