# brainsnn-r3f-app

The 35-layer 3D brain viewer that this repo deploys. React 18 + Vite + React Three Fiber, with optional FastAPI/TRIBE v2 and Gemma 4 backends.

For the marketing pitch, screenshots, and architecture overview see the [root README](../README.md). This file is the developer's quickstart.

---

## Quickstart

```bash
npm install     # or: npm ci  — uses .npmrc legacy-peer-deps for vite 5 + plugin-react 6 peer mismatch
npm run dev     # → http://localhost:5173
```

## Scripts

| Script            | What it does                                                            |
| ----------------- | ----------------------------------------------------------------------- |
| `npm run dev`     | Vite dev server with HMR on port 5173                                   |
| `npm run build`   | Production build → `dist/` (~1.4 MB total, three.js chunked separately) |
| `npm run preview` | Serves `dist/` locally for verification before pushing                  |

## Environment variables

All optional. Copy [.env.example](.env.example) to `.env` and fill in only what you need.

| Variable                  | Default mode (unset)     | Effect when set                                               |
| ------------------------- | ------------------------ | ------------------------------------------------------------- |
| `VITE_TRIBE_API`          | STDP simulation          | Hits FastAPI server for real fMRI predictions (Layer 3)       |
| `VITE_GEMMA_API_ENDPOINT` | Regex Cognitive Firewall | Routes through Gemma 4 for deep multimodal analysis (Layer 5) |
| `VITE_GEMMA_API_KEY`      | n/a                      | Bearer token for the Gemma endpoint above                     |
| `VITE_SYNC_WS_URL`        | Solo mode                | Multi-user live brain state sync over WebSocket (Layer 16)    |

## The 35 layers — file map

| Layer | Feature                           | Component (`src/components/`)                                                                                                          |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | 3D Brain Viewer (R3F)             | [BrainScene.jsx](src/components/BrainScene.jsx)                                                                                        |
| 2     | Neural Flow Grid (GLSL)           | [brain/FlowTubeShader.js](src/components/brain/FlowTubeShader.js)                                                                      |
| 3     | TRIBE v2 mode toggle              | [TribePanel.jsx](src/components/TribePanel.jsx)                                                                                        |
| 4     | Cognitive Firewall                | [CognitiveFirewallPanel.jsx](src/components/CognitiveFirewallPanel.jsx) + [utils/cognitiveFirewall.js](src/utils/cognitiveFirewall.js) |
| 5     | Gemma 4 deep analysis             | [GemmaAnalysisPanel.jsx](src/components/GemmaAnalysisPanel.jsx) + [utils/gemmaEngine.js](src/utils/gemmaEngine.js)                     |
| 6     | Snapshots                         | [SnapshotPanel.jsx](src/components/SnapshotPanel.jsx)                                                                                  |
| 7     | Analytics Dashboard               | [AnalyticsDashboard.jsx](src/components/AnalyticsDashboard.jsx)                                                                        |
| 8     | Narrative Engine                  | [NarrativePanel.jsx](src/components/NarrativePanel.jsx)                                                                                |
| 9     | Toast Notifications               | [ToastContainer.jsx](src/components/ToastContainer.jsx)                                                                                |
| 10    | Keyboard Shortcuts                | [KeyboardHelp.jsx](src/components/KeyboardHelp.jsx) + [utils/shortcuts.js](src/utils/shortcuts.js)                                     |
| 11    | Share & Embed                     | [SharePanel.jsx](src/components/SharePanel.jsx)                                                                                        |
| 12    | Onboarding Walkthrough            | [OnboardingWalkthrough.jsx](src/components/OnboardingWalkthrough.jsx)                                                                  |
| 13    | Split Brain View                  | [SplitBrainView.jsx](src/components/SplitBrainView.jsx)                                                                                |
| 14    | Voice Narrator                    | [VoiceControl.jsx](src/components/VoiceControl.jsx)                                                                                    |
| 15    | Analysis Plugin System            | [PluginPanel.jsx](src/components/PluginPanel.jsx)                                                                                      |
| 16    | WebSocket Live Sync               | [LiveSyncPanel.jsx](src/components/LiveSyncPanel.jsx)                                                                                  |
| 17    | Activity Heatmap Timeline         | [HeatmapTimeline.jsx](src/components/HeatmapTimeline.jsx)                                                                              |
| 18    | Knowledge Brain                   | [KnowledgeBrainPanel.jsx](src/components/KnowledgeBrainPanel.jsx)                                                                      |
| 19    | MCP Brain Bridge                  | [MCPBridgePanel.jsx](src/components/MCPBridgePanel.jsx) + [mcp-server/](mcp-server/)                                                   |
| 20    | Code-Aware Knowledge Brain        | [CodeBrainPanel.jsx](src/components/CodeBrainPanel.jsx)                                                                                |
| 21    | Brain Steward (autopilot)         | [BrainStewardPanel.jsx](src/components/BrainStewardPanel.jsx)                                                                          |
| 22    | Conversation Brain                | [ConversationBrainPanel.jsx](src/components/ConversationBrainPanel.jsx)                                                                |
| 23    | Cognitive Immunity Score          | [ImmunityPanel.jsx](src/components/ImmunityPanel.jsx) + [utils/immunityScore.js](src/utils/immunityScore.js)                           |
| 24    | Real Embeddings (transformers.js) | [EmbeddingsPanel.jsx](src/components/EmbeddingsPanel.jsx)                                                                              |
| 25    | Red Team Simulator                | [RedTeamPanel.jsx](src/components/RedTeamPanel.jsx)                                                                                    |
| 26    | Dream Mode                        | [DreamModePanel.jsx](src/components/DreamModePanel.jsx) + [utils/dreamMode.js](src/utils/dreamMode.js)                                 |
| 27    | Adversarial Training              | [AdversarialTrainingPanel.jsx](src/components/AdversarialTrainingPanel.jsx)                                                            |
| 28    | Neuro-RAG                         | [NeuroRagPanel.jsx](src/components/NeuroRagPanel.jsx) + [utils/neuroRag.js](src/utils/neuroRag.js)                                     |
| 29    | Affective Trigger Decoder         | [AffectiveDecoderPanel.jsx](src/components/AffectiveDecoderPanel.jsx)                                                                  |
| 30    | Neurochemistry Sandbox            | [NeurochemistryPanel.jsx](src/components/NeurochemistryPanel.jsx)                                                                      |
| 31    | Brain Evolve                      | [BrainEvolvePanel.jsx](src/components/BrainEvolvePanel.jsx)                                                                            |
| 32    | Attack Evolve (co-evolution)      | [AttackEvolvePanel.jsx](src/components/AttackEvolvePanel.jsx)                                                                          |
| 33    | Multimodal RAG Router             | [MultimodalRagPanel.jsx](src/components/MultimodalRagPanel.jsx) + [utils/multimodalRag.js](src/utils/multimodalRag.js)                 |
| 34    | Vector-Graph Fusion               | [VectorGraphFusionPanel.jsx](src/components/VectorGraphFusionPanel.jsx)                                                                |
| 35    | Direct Content Insertion (JSON)   | [DirectInsertPanel.jsx](src/components/DirectInsertPanel.jsx)                                                                          |
| 101   | Quantum Coherence Lab             | [QuantumCoherencePanel.jsx](src/components/QuantumCoherencePanel.jsx) + [utils/quantumCoherence.js](src/utils/quantumCoherence.js)     |

## Quantum Coherence Lab

**Layer 101 — Quantum Coherence Lab.** A pure-JavaScript, in-browser simulation
of a single qubit running through `|0⟩ → H → RZ(θ) → H → M`. Slide the phase
θ to watch interference move probability between |0⟩ and |1⟩. Add noise to
damp the fringe. Toggle a mid-circuit observation to collapse superposition.
Stack X·X pairs (algebraically identity) to watch decoherence eat depth.

**What this is.** A teaching sandbox for the *mechanism* behind the word
"alignment": phase coherence steers outcomes; noise and observation kill it.
A **Scientific / Metaphor** mode toggle reframes the same numbers in
plain English alongside the math.

**What this is not.** This does **not** prove literal multiverse theory,
consciousness collapse, Planck foam, or spiritual portals. Those are framing
metaphors when the toggle is on, not physics claims.

**Future backend.** The function surface (`runPhaseExperiment`,
`runDecoherenceExperiment`, etc.) is intentionally compatible with the
hardware-grade Qiskit suite at [`quantum_alignment/`](../quantum_alignment/),
which runs the same three experiments on ideal Aer, noisy Aer, or real IBM
Quantum hardware (and is shaped to swap in OriginQ later). **No vendor API
keys are added to the frontend** — IBM tokens stay in the Python suite,
read from `IBM_QUANTUM_TOKEN` at runtime only.

Run the unit tests directly with Node (no extra dev deps):

```bash
npm run test:quantum
```

## Keyboard shortcuts

| Key             | Action                                        |
| --------------- | --------------------------------------------- |
| `Space`         | Pause / resume the simulation                 |
| `b`             | Trigger sensory burst                         |
| `r`             | Reset brain state                             |
| `1` / `2` / `3` | Switch mode: Simulation / TRIBE v2 / Live EEG |
| `s`             | Save snapshot                                 |
| `e`             | Start / stop WebM recording                   |
| `q`             | Cycle quality tier: low → high → ultra        |
| `?`             | Show keyboard help modal                      |

## Performance tiers

The viewer auto-switches via `<PerformanceMonitor>` when fps drops, but you can pin a tier:

| Tier  | What changes                                                     |
| ----- | ---------------------------------------------------------------- |
| low   | Drops postprocessing bloom, fewer flow tubes, lower-poly regions |
| high  | Default. Bloom on, 10 flow tubes, full-poly regions              |
| ultra | High + neural pulse waves, secondary cross-links, brighter glow  |

## Browser support

- Chrome / Edge / Brave 120+ (full support — WebGL2, Web Speech, Web Bluetooth, Web Serial)
- Safari 17+ (full visual; Bluetooth/Serial-dependent layers degrade gracefully)
- Firefox 120+ (full visual; no Web Bluetooth/Serial → EEG mode falls back to mock data)

## Optional integrations

- **TRIBE v2 backend** — see [server/README.md](server/README.md). Run `cd server && uvicorn api:app --reload`, then set `VITE_TRIBE_API=http://localhost:8642`.
- **Gemma 4** — point `VITE_GEMMA_API_ENDPOINT` at Google AI Studio, Ollama (`http://localhost:11434/v1/chat/completions`), or any OpenAI-compatible vLLM endpoint.
- **MCP server (for AI agents)** — `cd mcp-server && node server.js`. Exposes the 14 JSON-RPC tools to Claude Code, Codex, and any MCP-aware client. WebSocket relay so the agent doesn't need to live in the browser tab.

## Build details

```js
// vite.config.js
manualChunks: {
  three: ['three', '@react-three/fiber', '@react-three/drei'],
  postprocessing: ['@react-three/postprocessing', 'postprocessing'],
}
```

three.js gets its own ~1MB chunk so the rest of the app loads instantly. `chunkSizeWarningLimit: 1400` silences the (intentional) warning. No source maps in production.

## Troubleshooting

| Symptom                                   | Fix                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `npm ci` fails on peer deps               | Ensure [.npmrc](.npmrc) with `legacy-peer-deps=true` is present               |
| Black canvas, no brain visible            | Open devtools → Console — likely a WebGL2 issue. Try a desktop browser.       |
| Onboarding modal blocks every interaction | Click "Skip" once. State persists in localStorage as `brainsnn_onboarding_v1` |
| TRIBE v2 toggle stuck in Simulation       | `VITE_TRIBE_API` not set, or `/health` returns non-200                        |
| Gemma analysis falls back to regex        | `VITE_GEMMA_API_ENDPOINT` empty or endpoint returned non-2xx                  |
