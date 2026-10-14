---
type: project
description: Robot Arena production source, runtime honesty and RTX 4090 handoff
---

# Robot Arena, October 14, 2026

The owner requested the playable BrainSNN Arena concept be improved, pushed to this GitHub repository and deployed through the existing main workflow, with a handoff prompt for the RTX 4090.

- Website source: `brainsnn-r3f-app/public/arena/`, served at `/arena/` by `src/server/arenaStatic.js` before the SPA fallback. `/arena` redirects with its query preserved. Missing files remain 404. Homepage and toy navigation link to the arena, preserving the Poke the Brain hero and existing products.
- Original near-black, cyan, violet and gradient B identity remains. No site identity or `.openai` metadata was copied from Sites.
- Worker source, setup and 4090 handoff: `robotics/arena/`. Its `dist` symlink targets the actual public arena. Rebuild the downloadable kit after worker/docs changes with `python robotics/arena/scripts/build-worker-kit.py`.
- Practice is an explicitly scripted kinematic demo. Named robots require a validated exact worker profile and real policy outputs. Catalogue entries do not mean installed models. The bundled real adapter is Panda + native OpenPI π0.5 LIBERO; G1/SONIC and other recipes are not bundled running backends.
- Task/seed edits preserve a running session and its replay. They are next-session drafts; evidence retains the actual execution seed. Robot/model/profile identity changes still disconnect.
- Campaigns plan up to 100,000 total episodes. No provisioning, billing or batch execution is implemented. Do not claim 100,000 simultaneous worlds.
- Preserve existing `ops/gpu/` inference services. Read `robotics/arena/docs/rtx4090-handoff.md` before installing the robot worker; preflight available VRAM and port conflicts. No paid compute or physical robot is launched by the browser integration.
- Local verification covers app unit tests/typecheck/build, real HTTP asset routing, arena UI/controller/session contracts and worker API test doubles. Real weights, CUDA/MuJoCo EGL and browser rendering still need validation on the target machine; never call those verified based on CPU tests.

Production Railway project `c7f26b12-f812-4785-bbaf-a49b9caeb228`, environment `96828263-a5d4-442f-ae6f-df7bff99aab8`, service `924291ad-28bb-4a28-91d4-1d639739550f` (`the-brain`), source `slavazeph-coder/the-brain` main, service root `brainsnn-r3f-app`. Both brainsnn.com and www.brainsnn.com are mapped to this service. Check the actual release/deployment status independently.

## Customer site layer

The owner requested the Prevu3D-inspired phone capture layer inside the existing
G1/GR00T playground. **Test your space** is `view=site` in the existing fragment;
it preserves robot/model/task/seed and does not replace the real Arena adapter.

- Source is `public/arena/site-{core,workspace,plan-worker}.js` and a deferred
  Three.js bundle compiled from `src/arena/site-renderer.js`. Keep it outside the
  homepage import graph. `npm run build` regenerates the committed bundle.
- Browser planning is bounded geometric A*/coverage on a reviewed metric floor,
  with conservative footprint clearance. It is not physics, GR00T execution or
  proof of cleaning quality. Sample scenes and assumed dimensions are labelled.
- CapturedRoom JSON requires a supported single level floor polygon. GLB and
  ASCII USDZ appearance is separate from collision geometry. Binary RoomPlan
  USDZ is unsupported in Three's installed parser. Do not claim universal USDZ.
- Private scan worker `workers/site_scan/` uses actual FFmpeg/COLMAP processing;
  its browser-viewable output is an unscaled sparse cloud requiring review. The
  optional dense visual adapter is operator-configured, not a bundled model.
- Worker port 8082 is separate from existing model/physics services. Website
  deployment does not start it, rent compute or install CUDA dependencies.
- Source photos/videos remain local until explicitly sent to a configured
  worker. Do not put captures or tokens in public assets, reports or Git.
- See `robotics/arena/docs/site-tests.md` and `site-scan-worker.md` for the user
  flow, deployment constraints and the RTX 4090 continuation instructions.

## Large scan artifact downloads

- The artifact Download action has a separate backpressured disk stream, capped at
  3 GiB or the smaller advertised worker limit. Keep JSON/preview buffering at
  8 MiB, error bodies at 64 KiB, and the legacy Blob fallback at 64 MiB.
- Updated scan workers advertise `artifactDownloads.nativePost`: a bearer-authenticated
  POST mints a 60-second one-use artifact ticket; a second native form POST streams
  an attachment without putting the worker bearer token in a URL or form. The
  browser download manager owns native transfer progress/cancellation after handoff.
- The two-phase native download requires HTTPS worker access from the public site.
  Old workers still support direct-to-disk saving; update the scan kit for native
  downloads in browsers without showSaveFilePicker. Rebuild the kit after API/tests/docs
  edits with `python robotics/arena/scripts/build-site-scan-kit.py`.
- Regression coverage includes reusable-chunk 3 GiB streams and sparse 3 GiB
  worker responses. Real browser download UI and GPU reconstruction are separate
  validations, not implied by these CPU/DOM contracts.
