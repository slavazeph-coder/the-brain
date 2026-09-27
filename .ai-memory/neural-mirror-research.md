---
type: project
description: BrainSNN Neural Mirror research director, benchmark gate, and Brand Brain persistence architecture
---

# Neural Mirror + Brand Brain

Updated 2026-08-24.

## Scientific boundary

- `brainsnn-r3f-app/src/lib/neuralMirror.js` defines the production Neural Mirror contract.
- The current browser/CPU projection is deliberately `trained: false`, `validatedAgainstNeuralData: false`, `anatomicalRegistration: false`, and has zero neural-confidence.
- It is a software/data-contract baseline only. Never present it as recorded fMRI, a medical scan, or a validated neural-response predictor.
- Neural Mirror features may influence Brand Brain outcome similarity only after the model is trained, benchmarked against recorded neural data, and anatomically registered.

## Research stack

- Independent research code lives under `/neural-mirror` and is separate from the Node SaaS.
- Ridge is the first benchmark family. Evaluation uses held-out per-parcel Pearson correlation with explicit temporal lag alignment.
- SQLite stores experiments and champion state. The Research Director proposes experiments, but held-out benchmark gates decide promotion.
- Synthetic self-tests validate the software pipeline only; synthetic scores are not neuroscience results.
- TRIBE remains a research reference, not a commercial teacher or production dependency unless licensing is explicitly cleared.

## Brand Brain

- Brand Brain keeps the Outcome Model distinct from Neural Mirror.
- Outcome history stores compact creative signatures + actual post-publish metrics, not raw media.
- Server persistence API: `/api/v1/brand-brain/status`, `/outcomes`, and `/outcomes/:id`.
- Postgres is the durable production target; browser localStorage is a resilience cache/fallback.
- Anonymous pilot workspaces are separated by an HttpOnly same-origin cookie.

## Production deployment

- Railway production service: `the-brain`, source `slavazeph-coder/the-brain`, branch `main`, root `brainsnn-r3f-app`.
- Brand Brain persistence preload requires the Postgres CLI at runtime, so production must build from `brainsnn-r3f-app/Dockerfile` (or otherwise install `postgresql-client`).
- The Dockerfile installs `postgresql-client`, runs lint/tests/build/MCP smoke, and starts with `brand-brain-preload.cjs`.
- CI workflow `.github/workflows/neural-mirror-research.yml` validates Python research, Node contracts, fallback HTTP persistence, and the production Docker image.

## Next scientific milestone

Prepare rights-cleared Algonauts 2025 feature/target matrices and run the first real Ridge benchmark. Do not promote Neural Mirror to validated status until that held-out neural benchmark exists and passes the promotion gate.
