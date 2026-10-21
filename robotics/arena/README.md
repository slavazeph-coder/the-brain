# BrainSNN Robot Arena

Live entry point: https://www.brainsnn.com/arena/

The deployable browser app is `brainsnn-r3f-app/public/arena/`. Vite copies it into the existing Railway web build. This directory holds the separate GPU worker, contracts and regression tests. `dist` is a relative symlink to the browser source so the tests and kit builder use the exact deployed files.

- Start the RTX 4090 handoff: [docs/rtx4090-handoff.md](docs/rtx4090-handoff.md).
- Worker installation: [docs/arena-worker.md](docs/arena-worker.md).
- Browser/worker contract: [docs/arena-runtime-protocol.md](docs/arena-runtime-protocol.md).
- Implemented features and limits: [docs/arena-release.md](docs/arena-release.md).
- Reachy Mini text-to-motion worker for `/arena/motion/`: [docs/motion-worker.md](docs/motion-worker.md).

From this directory, run `node scripts/check-arena.cjs` for browser logic checks. Install `workers/arena/requirements-api.txt` and `httpx==0.28.1`, then run `python -m unittest discover -s tests -p 'test_arena_worker*.py'` and `node tests/arena-integration-worker-contract.cjs` for worker contract tests. These checks use test doubles, not downloaded policies or a GPU renderer.

Run `python scripts/build-worker-kit.py` after changing worker source or setup documentation. Commit both source and generated download together. Never place credentials or model weights in the website's public directory.

The original standalone source was imported from BrainSNN Arena concept commit `508cae4a26dbf7417dbf6b02b216df2c7b67c421`. The production repository is now the source of truth for this integration. Existing `ops/gpu/` text-inference services are separate and must remain undisturbed.
