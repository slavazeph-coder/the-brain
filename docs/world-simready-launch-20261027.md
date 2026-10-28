# BrainSNN launch extensions — October 27, 2026

## Scope and status

This is an implemented operator-side integration slice, not a claim that the entire phone-to-BIM roadmap is complete. It does not change the public website, enable unqualified GPU engines, or submit third-party scans.

- `robotics/world_worker/simready_bridge.py`: inspect locally pulled NVIDIA SimReady Central packages; bind review to exact package bytes; prepare a bounded placement plan; optionally compose a separate portable OpenUSD additions layer.
- `robotics/world_worker/capture_evidence.py`: validate an explicit native-capture bundle, hashes, timing, calibration and rigid poses; convert ARKit camera-to-world poses to COLMAP camera-coordinate priors. It also estimates conservative paired-wall-surface candidates from reviewed point subsets.
- `tests/world/test_launch_extensions.py`: 34 tests. Local run: 31 passed, 3 USD tests skipped because pxr was unavailable. The dedicated CI job installs usd-core and requires its import before running tests, so dependency absence cannot silently qualify the USD path.

These modules are NOT yet wired into browser uploads, the main reconstruction solver, automatic segmentation or the existing scene compiler. The wall helper does not modify production wall geometry or repair its existing thickness labels. Native iPhone capture, GPU inference, detailed pipe/duct fitting and independent room measurements remain separate work.

## Live infrastructure checked

Railway project `wonderful-charisma`, production: the existing website and the private `world-worker` reached SUCCESS. Worker resources: one instance, 4-vCPU / 8-GB limits, 10-GB /data volume. The worker follows `deploy/world-worker-20261027`; the website follows main. The dedicated worker branch isolates its root Railway config from the website config. WORLD_WORKER_HOST was set to 0.0.0.0 after the IPv6-only listener failed health checks. Never expose the worker directly.

Public browser checks of the Railway site observed /healthz = 200, /api/world/processing = 200 with available=true, passcode=true and visitors=false, and unauthenticated capabilities = 401. This does not prove authenticated reconstruction or metric exports. No customer video was processed in this implementation slice.

Railway domain-status reported brainsnn.com requires a traffic-routing DNS update to `tnoamdbj.up.railway.app`, with the certificate still issuing. Check the DNS provider before changing anything; preserve mail records. Temporary website: https://the-brain-production.up.railway.app/world/. Passcode remains in Railway shared variables; no secret is included here.

## SimReady Central input

Reference: https://github.com/NVIDIA-Omniverse/simready-central and its `docs/examples/index_to_library.py`. Its submission index pins individual asset packages to immutable Hugging Face commits; do not download an entire library just to test one scene. The repository's code license is not the license of every asset. Review each package license and its reported validation profile.

Use the upstream documented local index-to-library workflow to pull a small selection, then:

```sh
python -m robotics.world_worker.simready_bridge \
  --library /data/simready/library.json --workspace /data/simready \
  --out /data/simready/brainsnn-inspected.json
```

The output includes `source.url`, `license` and `receipt.sha256`. After actually reviewing an asset and placement, create a `brainsnn.simready-placements.v1` document whose `placements` is a list of records containing:

- `id`: unique USD identifier;
- `source_url`: exact immutable URL from the inspected record;
- `translation_m`: three metre coordinates; optional `rotation_xyz_deg`;
- `approval`: exact `package_sha256`, exact `license`, `license_reviewed: true`, `placement_reviewed: true`;
- optional `collision_policy: convexHull` only after `approval.approximation_reviewed: true`.

```sh
python -m robotics.world_worker.simready_bridge \
  --library /data/simready/library.json --workspace /data/simready \
  --placements /data/simready/placements.json --out /data/simready/reviewed-plan.json

# Requires usd-core in a separate environment; use a fresh output folder.
python -m robotics.world_worker.simready_bridge \
  --library /data/simready/library.json --workspace /data/simready \
  --placements /data/simready/placements.json --compose --out /data/simready/assembly
```

Composition preserves the assets' authored transforms and colliders, adds an outer placement/basis transform, requires explicit metre units and Y/Z-up, and references copied package files. It refuses missing colliders, changed packages and external/escaping USD composition dependencies. It does not validate arbitrary shader/texture dependencies or replace an OS sandbox: use reviewed packages in an isolated no-network environment. No production endpoint should execute this against untrusted uploads.

Defaults are authored colliders, no resizing, at most 16 unique assets and 64 placements. Convex hulls can close bins and openings; never apply them globally to a scanned room or container. The output keeps library provenance and physics_ready=false. No Isaac Sim simulation, 1,000-object stress test, NVIDIA asset benchmark, robot deployment or synthetic-label generation ran here.

## Capture bundle contract

A directory plus JSON, not an invented standard .arkit archive. Root keys: `schema: brainsnn.capture.v1`, `pose_convention: arkit-camera-to-world`, `units: m`, `pixel_convention: integer-centres`, and `frames`.

Each frame carries `id`, original monotonic `timestamp_seconds`, relative JPEG/PNG `image`, `image_sha256`, `image_size: [width,height]`, 3x3 `intrinsics`, 4x4 rigid `camera_to_world`, and `tracking_state: normal|limited|not-available`. The image is in its original calibrated raster orientation. Any native app that rotates/resizes a raster must transform calibration consistently before writing the bundle. Lens distortion is not modeled by this initial contract. Reject unsupported captures rather than silently dropping it.

```sh
python -m robotics.world_worker.capture_evidence \
  --bundle /data/capture/bundle.json --root /data/capture \
  --out /data/capture/validated-evidence.json
```

The output contains COLMAP camera-coordinate pose priors but is not a COLMAP model or measured calibration. Integer-centre intrinsics remain explicitly labeled; the consuming solver must perform its pixel convention conversion. Estimated metre scale is never marked verified. A native capture app and solver integration still need implementation and physical qualification.

## Wall evidence

`wall_candidate(points, origin, normal, along)` operates on a reviewed wall subset in metres. It requires distinct surface-density modes, a low-density gap, and overlapping locally supported cells. It returns a candidate finish-face separation and spatial p05/p95 variation, not an independent confidence interval or structural core thickness. Single broad/noisy surfaces, insufficient overlap and bad axes are rejected. Duplicated reconstruction surfaces can still mimic two faces; camera-source evidence and independent dimensions are required before relying on thickness.

## Acceptance still required

1. Resolve custom-domain DNS/TLS and rerun public/authentication checks.
2. Run the existing site_processing_check.py with the secret from the operator environment and a permitted short capture, including checksum-checked downloads. Do not print the secret.
3. Execute the USD CI tests, then one reviewed NVIDIA package in the intended Isaac Sim version; measure actual colliders, memory and task behavior.
4. Wire accepted capture evidence and detailed geometry into reconstruction without bypassing existing tenant, consent, resource and fold checks.
5. Reopen actual IFC/Rhino exports after an approved edit and compare held-out room measurements. Keep sparse previews, learned completion, observed surfaces and library assets distinct.
