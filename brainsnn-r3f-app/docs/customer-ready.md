# BrainSNN customer-ready pilot contract

## Persistence

- Brand Brain outcomes are durable only when `DATABASE_URL` is configured.
- Production never falls back to browser history or process memory as a substitute for server persistence.
- Pilot workspaces use a random 256-bit capability token; only its SHA-256 hash is stored by the server.
- Raw customer video is not inserted into Brand Brain outcome history by the feedback-loop feature.

## Neural readout boundary

The current customer-visible neural representation is a seven-region predicted/reference projection. It is not subject MRI, fMRI, EEG, a biometric measurement, a diagnosis, or a measured neural recording. The exported JSON receipt includes model/provenance metadata, confidence when the model pipeline actually provides one, the current region values, stimulus hash only when present, and whether a time-resolved prediction was supplied.

## Outcome-learning boundary

Brand Brain compares a creative signature with that brand's saved actual outcomes. Current maturity gates remain:

- fewer than 3 comparable outcomes: collection only; no historical-fit signal;
- 3-7 comparable outcomes: directional nearest-neighbor evidence;
- 8+ comparable outcomes: descriptive feature associations become available.

These are historical correlations used to prioritize tests, not causal findings or guaranteed performance.

## Release gate

A customer-ready branch must pass TypeScript checking, the deterministic unit suite, production bundle build, MCP smoke test, and `npm audit --audit-level=high`. Production persistence must additionally be verified against the deployed Postgres service before claiming Brand Brain saves are live.
