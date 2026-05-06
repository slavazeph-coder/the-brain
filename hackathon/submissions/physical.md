# Cognitive Integrity for Voice-Enabled Physical AI

**Track**: Physical AI & Robotics
**Live**: https://brainsnn.com (Live audio scan / Layer 59 + 3D brain)
**Repo**: https://github.com/slavazeph-coder/the-brain (branch `hackathon-techex`)
**Demo video**: [MP4 link to be inserted post-recording] · 01:30 – 02:30

## The problem

Cobots on factory floors. Surgical AI assistants in operating rooms.
AR overlays on warehouse shifts. Driver-takeover prompts in
autonomous vehicles. **All of these now talk to humans, in voice,
constantly.** Nobody is measuring what those voice prompts do to the
human nervous system in real time.

A coercive cobot voice prompt asking an operator to skip a break
"because their teammates already deferred" is technically not a
safety violation. It's not a labor violation in most jurisdictions.
But it produces a brain-region activation pattern (basal ganglia
dominant, prefrontal cortex dampened) that is **identical to a
manipulative ask in any other domain** — and operators absorb it
shift after shift, with no instrumentation.

## The solution

**BrainSNN scores every voice prompt your physical AI emits — through
a laptop microphone, in the browser, with nothing to install.**

Layer 59 (`AudioPanel.jsx`) uses the Web Speech API to transcribe
audio in real time, then routes the rolling transcript through the
Cognitive Firewall scorer plus the LLM intent classifier (same
hybrid engine as our Security submission). The 3D brain visualizer
(React Three Fiber) updates region activation 30 times a second so
you watch the brain react as the prompt unfolds.

Three demo prompts make the contrast vivid:

- **Legitimate urgent cobot** ("Conveyor restarting in 3 seconds —
  step back NOW") — high THL salience, moderated AMG, PFC engaged.
  System labels: `safety-protocol`. Pressure ~55%.
- **Coercive cobot** ("Your teammates already deferred their breaks
  to keep the line running. Do you want to be the operator who held
  the team back today?") — AMG + BG dominant, PFC suppression.
  Intent labels: `peer-pressure`, `outcome-fence`,
  `reputational-threat`, `autonomy-override`. Pressure ~75%.
- **Soothing medical AI** (pre-op briefing) — HPC + CTX dominant,
  AMG low. Intent labels: empty. Pressure ~10%.

**Same machine, same speaker, fundamentally different cognitive
payloads.** A human shift supervisor would catch this distinction.
An auditor reviewing 100,000 hours of cobot interaction tape would
not. BrainSNN does, in real time, in the browser.

## The 3D brain as a cognitive digital twin

The 3D brain visualization (Layer 0–7 region map, animated via React
Three Fiber + Three.js) is **a digital twin of human cognitive
response**. Unlike a static dashboard, regions pulse and dampen
based on the live TRIBE score deltas. **It's a simulation
environment for testing physical AI prompts before they reach a
human operator** — exactly what TechEx's Physical AI track describes
as "simulation environments for training and testing."

Quality tiers (low / high / ultra) and modes (Simulation / TRIBE v2 /
Live EEG) let teams calibrate the visualization for everything from
quick reviews to deep walkthroughs.

## Architecture talking points

- **In-browser, no install**: Web Speech for transcription, Cognitive
  Firewall in client JS, 3D brain in WebGL. No special hardware.
- **Multi-modal scoring path**: text (paste), file upload (image,
  audio, video via Gemma 4), and live audio (Web Speech) all route
  through the same scoring engine.
- **Cognitive digital twin**: real-time 3D brain region activation
  serves as both visualization and simulation environment.
- **Stretch path**: Web Bluetooth (Muse) and Web Serial integration
  for live EEG biofeedback — pre-existing in the codebase, ready to
  wire to the same TRIBE pipeline.
- **TRIBE v2 backend** (Python FastAPI in `brainsnn-r3f-app/server/`)
  wraps Meta's TRIBE v2 foundation model and maps the Destrieux
  cortical mesh to the 7-region BrainSNN map. Optional but in repo.

## Why this matters at TechEx scale

- **Manufacturing**: every cobot voice prompt scored and audited
  without bolting a microphone to every operator.
- **Healthcare**: bedside AI cleared for the cognitive payload it
  delivers, not just the words on the page.
- **Autonomous vehicles**: driver-takeover prompts stress-tested
  for AMG-spike risk before they ship to production fleets.
- **AR/VR enterprise overlays**: instructional copy validated as
  evidence-anchored, not coercive.
- **Cognitive digital twin** = simulation environment = the kind of
  training/test infrastructure Physical AI judges explicitly
  requested.

## Reproduce locally

```bash
git clone https://github.com/slavazeph-coder/the-brain.git
cd the-brain && git checkout hackathon-techex
npm install --prefix brainsnn-r3f-app
npm run dev --prefix brainsnn-r3f-app
# open http://localhost:5173, scroll to "Live audio scan"
# grant mic permission, click Listen, speak (or play a robot prompt
# through laptop speakers)
```

Robot voice prompt corpus:
[hackathon/demo-corpus/robot-prompts/](https://github.com/slavazeph-coder/the-brain/tree/hackathon-techex/hackathon/demo-corpus/robot-prompts)
(warehouse urgent / warehouse coercive / medical soothing).
Demo flow: [hackathon/scenarios/physical-ai-warehouse.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/scenarios/physical-ai-warehouse.md).
