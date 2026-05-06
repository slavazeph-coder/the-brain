# BrainSNN Layer Reference (for hackathon scenarios + write-ups)

Audited 2026-05-06 against `the-brain/.ai-memory/MEMORY.md` lines 89–700
and spot-checked component files. All 100 layers exist in code; no gaps.

## Top 5 demo-worthy layers per track

| Track          | Layers                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **Security**   | L4 (Firewall), L25 (Red Team), L31 (Brain Evolve), L32 (Attack Evolve), L39 (Propaganda)                |
| **Agentic**    | L19 (MCP Bridge), L21 (Brain Steward), L18 (Knowledge Brain), L20 (Code Brain), L33 (Multimodal RAG)    |
| **Physical**   | L58 (Image OCR), L59 (Audio Firewall), L37 (Fragments), L30 (Neurochemistry), L71 (Oscillations)        |
| **Enterprise** | L4 (Firewall), L36 (Autopsy), L23 (Immunity), L42 (Counter-Draft), L73 (Text Adventure)                 |
| **Data Intel** | L33 (Multimodal RAG), L34 (Vector-Graph Fusion), L28 (Neuro-RAG), L20 (Code Brain), L53 (Echo Detector) |

## Secret weapons (underrated, worth featuring)

- **L29 — Affective Decoder**: Same neural circuit, different feeling — fear → red, belonging → pink, awe → lavender on the amygdala. Cinematic hook.
- **L68 — Tone Shifter**: Inject urgency/fear into clean text, score before/after delta. Red-teaming made visual.
- **L88 — Persona Simulator**: Reweight Firewall per reader role (Skeptic / Ally / Target / Observer). Same content, four interpretations.
- **L31 ↔ L32 — Arms Race**: Run Brain Evolve then Attack Evolve back-to-back; watch defenses improve, then attacks adapt around them.
- **L53 — Echo Detector**: 5-gram Jaccard clustering surfaces coordinated campaigns / bot swarms with a single `echoRisk` tier.

## Suggested master 5-minute demo sequence

1. **L4** — paste a phishing email → urgency/fear regions light up (~15s)
2. **L25** — click "Test Corpus" → F1 score displays (~20s)
3. **L31 → L32** — Brain Evolve improves the firewall, Attack Evolve dodges it (~30s)
4. **L30** — slide dopamine higher → PFC glows green (~20s)
5. **L29** — paste a jealous text → "AMY: fear + sadness in reward cluster" (~20s)
6. **L23** — dashboard → "127 attacks defended, immunity 76/100" (~15s)

Total: ~2 minutes of live demo, leaving 3 minutes for narrative + judge questions.

## Pure infrastructure layers (skip for hackathon scenarios)

L6, L9–L10, L12, L24, L35, L46, L54, L56–L57, L65, L72, L78, L86, L91–L92, L97–L98. These are backends / logs / settings / APIs / first-run experiences — important for the product, not demo-able in a 30-second beat.

## Component file paths (for scripting / write-ups)

| Layer | Component                                                                    |
| ----- | ---------------------------------------------------------------------------- |
| 4     | `brainsnn-r3f-app/src/components/CognitiveFirewallPanel.jsx`                 |
| 18    | `brainsnn-r3f-app/src/components/KnowledgeBrainPanel.jsx`                    |
| 19    | `brainsnn-r3f-app/src/components/MCPBridgePanel.jsx`                         |
| 20    | `brainsnn-r3f-app/src/components/CodeBrainPanel.jsx`                         |
| 21    | `brainsnn-r3f-app/src/components/BrainStewardPanel.jsx`                      |
| 23    | `brainsnn-r3f-app/src/components/{ImmunityScorePanel,ImmunityDashboard}.jsx` |
| 25    | `brainsnn-r3f-app/src/components/RedTeamPanel.jsx`                           |
| 28    | `brainsnn-r3f-app/src/components/NeuroRagPanel.jsx`                          |
| 29    | `brainsnn-r3f-app/src/components/AffectiveDecoderPanel.jsx`                  |
| 30    | `brainsnn-r3f-app/src/components/NeurochemistryPanel.jsx`                    |
| 31    | `brainsnn-r3f-app/src/components/BrainEvolvePanel.jsx`                       |
| 32    | `brainsnn-r3f-app/src/components/AttackEvolvePanel.jsx`                      |
| 33    | `brainsnn-r3f-app/src/components/MultimodalRagPanel.jsx`                     |
| 34    | (Vector-Graph Fusion utility integrated into L33 panel)                      |
| 36    | `brainsnn-r3f-app/src/components/AutopsyPanel.jsx`                           |
| 37    | `brainsnn-r3f-app/src/components/FragmentsPanel.jsx`                         |
| 39    | `brainsnn-r3f-app/src/components/PropagandaTemplatesPanel.jsx`               |
| 42    | `brainsnn-r3f-app/src/components/CounterDraftPanel.jsx`                      |
| 53    | `brainsnn-r3f-app/src/components/EchoDetectorPanel.jsx`                      |
| 58    | `brainsnn-r3f-app/src/components/OcrPanel.jsx`                               |
| 59    | `brainsnn-r3f-app/src/components/AudioPanel.jsx`                             |
| 68    | `brainsnn-r3f-app/src/components/ToneShifterPanel.jsx`                       |
| 71    | `brainsnn-r3f-app/src/components/OscillationsPanel.jsx`                      |
| 73    | `brainsnn-r3f-app/src/components/TextAdventurePanel.jsx`                     |
| 88    | `brainsnn-r3f-app/src/components/PersonaSimulatorPanel.jsx`                  |

## Coordination notes

- The full layer catalog narrative lives in `the-brain/.ai-memory/MEMORY.md`
  (lines 89–700). Codex maintains it.
- This file is a _hackathon-scoped_ index — when scenarios reference a
  layer, they should link to the component file path here so write-ups
  and recordings stay grounded.
- If Codex ships new layers post-100, ping the same memory file and
  this index gets updated in the next sync.
