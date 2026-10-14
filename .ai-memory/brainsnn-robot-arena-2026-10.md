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
