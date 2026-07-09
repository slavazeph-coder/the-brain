# Provenance & attribution

This project is **MIT-licensed** (see per-file headers). This document records where
non-original ideas, data and dependencies come from, and the licensing boundaries we
respect — a discipline borrowed from [Marble's os-taxonomy](https://github.com/withmarbleapp/os-taxonomy),
which cleanly separates database vs. authored-content licenses.

## Original to this repo

- The deterministic **103-layer engine** (`brainsnn-r3f-app/src/lib/layerRouter.js` and the
  layer modules): the Cognitive Firewall, Affective Decoder, TRIBE-style projection, business
  metrics, receipts, and **Layer 103 — the 39 Hz soliton field** (`solitonLayer.js`).
- The **layer catalog** as a dependency-graphed, manifest-versioned dataset
  (`src/lib/layerCatalog.js`, `data/layer-catalog.json`, `schema/layer-catalog.schema.json`).
- The **stdio MCP server** (`mcp-server/`) and the **neural decoder gateway**
  (`src/lib/neuralInputGateway.js`, `/api/neural/*`).

## Dependencies (bundled)

| Component | Source | License |
| --- | --- | --- |
| App runtime | React 19, Vite 6, Express 4, Tailwind | MIT |
| WebGL 3D brain | `three`, `@react-three/fiber`, `@react-three/drei` (`src/features/brain3d/`) | MIT |
| Agent bridge | `@modelcontextprotocol/sdk` (`mcp-server/`) | MIT |
| Optional deep analysis | `@google/genai` (Gemini) — only when `GEMINI_API_KEY` is set | Apache-2.0 |

## Inspirations & external boundaries (NOT bundled)

- **Marble Skill Taxonomy — `withmarbleapp/os-taxonomy`** (database ODbL-1.0, content CC-BY-SA-4.0).
  We borrowed the *approach* — a schema-validated graph with a prerequisite/dependency edge set,
  a versioned manifest with a content hash, and a validator script. **No data was copied**; our
  catalog and dependency edges are original to BrainSNN's own engine.
- **Meta Brain2Qwerty** (research code **CC-BY-NC-4.0**). Our decoder gateway analyzes *decoded
  text* from such a model but **does not bundle any Brain2Qwerty code, weights or data**. A real
  decoder is reached only over the network via `NEURAL_DECODER_URL` (see
  `docs/DECODER_TRANSCRIPT_GATEWAY.md`), keeping the NC boundary clean.
- **Optional external services** — Stripe, Supabase, and a TRIBE projection service — are each
  reached over the network behind an environment variable and are never required.

## Data & measurement disclaimer

BrainSNN outputs are AI-estimated content-response signals, **not** literal brain, biometric or
EEG measurements. The engine is deterministic and stores no source recordings.
