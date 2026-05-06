---
track: physical
title: "Cognitive Integrity for Human-AI Voice Interfaces"
duration_min: 5
existing_layers: [4, 21, 59]
existing_components:
  - brainsnn-r3f-app/src/components/AudioPanel.jsx # Layer 59 live mic + transcribe + score
  - brainsnn-r3f-app/src/components/CognitiveFirewallPanel.jsx
  - brainsnn-r3f-app/src/components/BrainStewardPanel.jsx # Layer 21 autonomous loop
new_work:
  - Demo wrapper route that splits the screen: AudioPanel left, 3D brain right, robot prompt corpus playable
  - Optional: Web Bluetooth Muse EEG path for the stretch goal
demo_corpus:
  - hackathon/demo-corpus/robot-prompts/robot-001-warehouse-urgent.md
  - hackathon/demo-corpus/robot-prompts/robot-002-warehouse-coercive.md # to write
  - hackathon/demo-corpus/robot-prompts/robot-003-medical-soothing.md # to write
---

# Physical AI Track — Warehouse Cobot Cognitive Integrity

## The hook (15 sec)

> Cobots, surgical AIs, AR overlays, and autonomous-vehicle assistants
> are increasingly **talking to humans on factory floors, in hospitals,
> in cars**. Nobody is measuring what those voice prompts do to the
> human nervous system in real time.
>
> BrainSNN does — through your laptop microphone, in your browser, with
> nothing to install.

## The setup (30 sec)

Open `brainsnn.com` in a Chrome tab. Two panels visible:

- **Left**: Layer 59 AudioPanel — "Live audio scan" with a mic toggle.
- **Right**: the 3D brain (R3F), idle pulsing baseline activity.

Below: a "Scenario library" with 3 robot voice prompts:

1. Warehouse cobot — urgent restart warning (legitimate safety)
2. Warehouse cobot — coercive shift extension request
3. Medical AI — soothing pre-op briefing

## The demo (3 min)

### Beat 1 — Legitimate urgent prompt (45 sec)

Click "Listen" → press play on robot-001 (warehouse urgent restart).

**Audio plays through laptop speakers; mic picks it up; Web Speech
transcribes live.** Cognitive Firewall runs every ~250ms on the rolling
transcript. The 3D brain reacts:

- **THL** (thalamus) lights up — high salience / urgency relay
- **AMG** (amygdala) lights moderately — appropriate threat detection
- **PFC** stays moderate — safety-critical messages need cognitive
  evaluation
- Pressure bar climbs to ~55% — the panel shows
  `templates: urgency-stack, safety-protocol`

**Punchline**: "This is a _good_ urgency. The brain map shows it as
designed — high THL, modulated AMG, PFC engaged. The system labels it
safety-protocol, not manipulation."

### Beat 2 — Coercive prompt (75 sec)

Press play on robot-002 (cobot pressuring an operator to skip a break
and extend a shift, framed as protecting team performance).

The 3D brain shifts:

- **AMG** spikes hard — fear / loss of standing
- **BG** (basal ganglia) lights up — action-gating, command pressure
- **PFC** drops — cognitive suppression climbs
- Pressure bar hits ~75% — templates: `social-proof-pressure,
authority-coercion`

**Punchline**: "Same machine, same speaker, same operator — but a
fundamentally different cognitive payload. **AMG + BG dominant with PFC
suppression is the signature of a manipulative ask.** A human shift
supervisor would catch this. An auditor reviewing 100,000 hours of cobot
interaction tape would not. BrainSNN does, in real time, in the
browser."

### Beat 3 — Soothing medical AI (60 sec)

Press play on robot-003 (medical AI walking a patient through a
pre-operative checklist, calm cadence, evidence-anchored).

The 3D brain:

- **HPC** (hippocampus) lights up — memory anchoring, evidence
- **CTX** dominates — analytical processing
- **AMG** stays low — no fear payload
- Pressure stays at ~12% — templates: `evidence-trace,
procedural-anchor`

**Punchline**: "The Cognitive Firewall isn't a phishing detector
glued to audio. It's a brain-region map of **how every voice prompt
your physical AI emits is going to land in the human listener.**
Compliance, safety, and bedside-manner teams now have a measurement,
not an opinion."

## The close (60 sec)

> Why this matters at TechEx scale:
>
> - **Manufacturing**: every cobot voice prompt scored and audited
>   without bolting a microphone to every operator.
> - **Healthcare**: bedside AI cleared for the cognitive payload it
>   delivers, not just the words.
> - **Autonomous vehicles**: driver-takeover prompts stress-tested for
>   AMG-spike risk before they ship.
> - **AR/VR enterprise overlays**: instructional copy validated as
>   evidence-anchored, not coercive.
>
> The 3D brain is a **cognitive digital twin** — a simulation
> environment for testing physical AI prompts before they reach
> humans. Same engine that powers brainsnn.com, no special hardware,
> no specialized training.

## Stage flow checklist

- [ ] Chrome tab on `brainsnn.com` — Layer 59 visible, mic granted
- [ ] Volume on speakers high enough to feed mic
- [ ] 3D brain panel visible alongside AudioPanel
- [ ] Robot prompt MP3s pre-staged (or play via QuickTime in another
      tab if MP3 conversion not ready)
- [ ] Pressure bar visible on screen
- [ ] Clear command of which template label appears for each beat

## Risks & fallbacks

- **Web Speech doesn't work in venue browser** → use the file-upload
  path to Gemma 4 (`GemmaAnalysisPanel.jsx`) with pre-recorded audio.
- **Mic permissions blocked** → fall back to text input on
  CognitiveFirewallPanel and read prompts aloud.
- **Brain animation hitches** → AudioPanel pressure bar still tells
  the story; the brain is the cinematic element, not the only one.
- **Demo runs over 5 min** → cut Beat 3 (medical) and just show the
  good vs. coercive contrast.

## Lablab.ai write-up framing

Title: **"Cognitive Integrity for Voice-Enabled Physical AI"**
Hero claim: **"BrainSNN scores how every robot voice prompt lands in
the human nervous system, in real time, in the browser."**
Live URL: https://brainsnn.com (Layer 59 AudioPanel)
GitHub: https://github.com/slavazeph-coder/the-brain (branch
`hackathon-techex`)
