# Master 5-Minute Recording — TechEx Hackathon Submission

**Recording target**: 5:00 ± 0:15. **Format**: 1080p MP4, ≤100 MB
(lablab.ai upload limit). **Voice-over** scripted; **screen capture**
of `brainsnn.com` (or `localhost:5173` if Railway is having a moment).

This is the artifact that ships with all 5 track submissions.
Each track submission references the same MP4 with timestamp links to
its track-specific section.

---

## Pre-recording checklist

- [ ] Chrome window at 1440 × 900, dev-tools closed, only `brainsnn.com`
      tab visible
- [ ] Onboarding tour dismissed (`localStorage.brainsnn-tour-dismissed = 'true'`)
- [ ] Mic permissions pre-granted for Layer 59 demo
- [ ] Quality tier set to **high** (low/high/ultra controls in hero)
- [ ] Mode set to **Simulation** (TRIBE v2 / Live EEG only if backend deployed)
- [ ] All 17 corpus samples + intel-corpus PDFs preloaded in respective panels
- [ ] Intent classifier toggle visible + cache pre-warmed
- [ ] Voice-over recorded separately (cleaner than live narration over screen)
- [ ] Quicktime / OBS started; framerate 30; H.264

---

## Beat 0 — Hook (0:00 – 0:18)

**Visual**: Hero of `brainsnn.com` — animated 3D brain rotating, the
"EMOTIONAL PAYLOAD INTELLIGENCE" eyebrow, the BrainSNN wordmark, the
six payload presets visible.

**Voice-over**:

> Every enterprise runs on text. Emails, vendor pitches, customer chats,
> internal memos, marketing copy, robot voice prompts. **None of those
> have an objective measurement of how they land cognitively in the
> human reading them.** BrainSNN provides one. One engine. Five enterprise
> faces. Live in the browser at brainsnn.com.

---

## Beat 1 — The Hybrid Cognitive Firewall (0:18 – 1:30)

**Track relevance**: Security (primary), Enterprise (secondary), Agentic
(architecture).

**Visual sequence**:

1. (0:18 – 0:25) Scroll smoothly to the **Cognitive Firewall** section.
2. (0:25 – 0:35) Click the **phishing-002 (CEO BEC)** chip from the
   corpus chip rail. Textarea fills. Click **Scan content**.
3. (0:35 – 0:45) Score bars render: Manipulation pressure **1%**,
   Trust erosion **4%**, Lead region **CTX**. Recommendation: "Low
   manipulation indicators."
4. (0:45 – 0:55) Toggle **Intent classifier** ON in panel header.
   Brief loading state. Re-scan auto-fires.
5. (0:55 – 1:15) Score bars re-render: Manipulation pressure climbs
   to **79%**, Trust erosion **45%**. Intent labels appear:
   `authority-pressure`, `secrecy-request`, `procedural-bypass`,
   `time-fence`, `funds-redirect`. Lead region shifts **CTX → BG**.
   3D brain pulses BG and dampens PFC.
6. (1:15 – 1:30) Click **Apply to brain** — full 3D brain visible,
   regions firing.

**Voice-over**:

> A real CEO Business Email Compromise. Our **deterministic regex
> baseline** sees nothing — manipulation pressure of 0.01, lead region
> Cortex, no flags. Most phishing detectors stop here.
>
> We toggle on **LLM intent classification**. Two seconds later,
> manipulation pressure climbs to 0.79. Five intent labels surface:
> authority pressure, secrecy request, procedural bypass, time fence,
> funds redirect. Lead brain region shifts from Cortex to Basal
> Ganglia — **the attacker is gating the target's action system, not
> their fear system**.
>
> This is hybrid architecture: **deterministic baseline at zero LLM
> cost, on-demand LLM escalation when the cheap layer is uncertain**.
> Same pattern that powers our Agentic Workflows submission. Same
> brain map every other beat in this video reads from.

---

## Beat 2 — Live audio scan + Physical AI (1:30 – 2:30)

**Track relevance**: Physical AI (primary), Security (cross-link).

**Visual sequence**:

1. (1:30 – 1:38) Scroll to **Live audio scan** (Layer 59).
2. (1:38 – 1:42) Click **● Listen**. Permission already granted.
   Indicator pulses red.
3. (1:42 – 2:00) Play `robot-002` (warehouse coercive cobot) audio
   through laptop speakers; mic picks it up. Web Speech transcribes
   live in the panel. Rolling pressure bar climbs as transcription
   completes.
4. (2:00 – 2:15) Final score (with intent classifier on): Manipulation
   pressure **65%**, Trust erosion **58%**. Intent labels:
   `peer-pressure`, `outcome-fence`, `reputational-threat`,
   `autonomy-override`. Lead region **THL → BG**.
5. (2:15 – 2:30) Cut to 3D brain — BG dominant, PFC dampened. Hold
   for 3 seconds.

**Voice-over**:

> Cobots, surgical AIs, AR overlays, autonomous-vehicle assistants —
> **all of these talk to humans now**. Nobody's measuring what those
> voice prompts do to the human nervous system in real time.
>
> We are. Right now, through this laptop microphone, in the browser.
> A warehouse cobot voice prompt — the kind that tells an operator
> they're falling behind their teammates and asks them to skip a
> break. Web Speech transcribes; the firewall scores; the brain map
> shows the operator's basal ganglia getting pressured to comply,
> not their amygdala getting scared.
>
> **Same engine that scored the CEO email scores the robot voice.**
> Cognitive integrity for any communication channel a physical AI emits.

---

## Beat 3 — Co-evolution arms race (2:30 – 3:15)

**Track relevance**: Agentic Workflows (primary), Security (secondary).

**Visual sequence**:

1. (2:30 – 2:35) Scroll to **Brain Evolve** (Layer 31). Click
   **Run defense evolution**.
2. (2:35 – 2:55) Pre-cached 5-round F1 chart animates: 0.18 → 0.34
   → 0.51 → 0.62 → 0.73 → 0.81. Cognition Store entries scroll past
   in adjacent terminal pane.
3. (2:55 – 3:00) Scroll one screen to **Attack Evolve** (Layer 32).
   Seed: combo. Click **Run attack evolution (16 rounds)**.
4. (3:00 – 3:15) Pre-cached attack-evolution montage: regex-evading
   mutations appear, defense F1 dips to 0.71, climbs back to 0.79
   after the next defense round. Two charts side by side, both
   moving.

**Voice-over**:

> XIO-Evolve is a four-agent Python pipeline — Researcher, Engineer,
> Analyzer, persistent Cognition Store. It evolves new firewall rules
> against the same corpus you just saw. **No human in the loop.**
>
> Five rounds: F1 climbs from 0.18 to 0.81. The Researcher discovers
> intent patterns the human author of the firewall didn't encode —
> including the rule that finally catches CEO BEC.
>
> Then the **attacker evolves too**. Same MAP-Elites architecture,
> different objective. Now we have a co-evolution arms race —
> **your firewall gets sharper every time the attacker wins, your
> attacker gets meaner every time the firewall wins, and both happen
> in a sandbox, not on a real employee.**

---

## Beat 4 — Knowledge Brain: vector + graph + trust + echo (3:15 – 4:15)

**Track relevance**: Data Intelligence (primary), Enterprise (secondary).

**Visual sequence**:

1. (3:15 – 3:20) Scroll to **Knowledge Brain** (Layer 18).
2. (3:20 – 3:30) Type query into the search box: _"What attack
   patterns target authority bypass and procedural override?"_
3. (3:30 – 3:40) Vector results appear: phishing-002, business-001,
   marketing-004. Toggle **Graph reranking** on. Results re-rank to
   include phishing-005 (recruiter trojan) — same attack-class
   community even though no keyword overlap.
4. (3:40 – 3:55) Toggle **Trust filter** on. phishing-002 drops out
   (manipulative source). Provenance chips appear on remaining
   results.
5. (3:55 – 4:05) Click **Echo Detector** (Layer 53). Cluster view
   appears: 3 of 17 corpus samples cluster as
   "phishing-attack-pattern" community; 4 marketing samples cluster
   as "marketing-pressure-spectrum"; result tagged
   `Echo Risk: MEDIUM · multi-source, no coordinated campaign`.
6. (4:05 – 4:15) Quick scroll to **Multimodal RAG** (Layer 33). Drag
   a Gartner-style PDF onto the dropzone. Pipeline runs:
   image-caption, table-schema, equation-LaTeX, code-syntax. Two
   figure captions appear in the next query result.

**Voice-over**:

> Most enterprise RAG ships embeddings and a chat box. **BrainSNN
> ships vector + graph + trust + echo as four layers of one engine.**
>
> Vector finds candidates. Graph reranking discovers documents in the
> same attack-class community even when keywords don't overlap. Trust
> filtering removes manipulative sources from the retrieval. Echo
> detection flags coordinated campaigns hiding inside what looks
> like diversified evidence.
>
> Plus multimodal: figures, tables, equations, code blocks — all
> extracted into the same retrieval graph. **Half the value of
> enterprise documents is locked inside non-text. We unlock it.**
>
> In the browser. With embeddings running locally via transformers.js.
> Your document content **never leaves the device**.

---

## Beat 5 — Counter-Draft + Persona Simulator (4:15 – 4:45)

**Track relevance**: Enterprise Problem-Solving (primary).

**Visual sequence**:

1. (4:15 – 4:20) Scroll back up to a CSR chat sample in the Firewall
   (business-001 already loaded). Click **Neutralize this** (Layer 42).
2. (4:20 – 4:30) Counter-Draft response appears: a de-escalating CSR
   reply that refuses peer-shaming, refuses authority-bypass, refuses
   reputational-threat, preserves the policy.
3. (4:30 – 4:40) Scroll to **Persona Simulator** (Layer 88). Switch
   reader persona from "Maya — CSR" → "Eric — VP of Eng (eager to
   modernize)". Re-score the same vendor pitch (business-002):
   manipulation pressure jumps to 83%; new evidence chip:
   `fear-of-falling-behind dominant for this persona`.
4. (4:40 – 4:45) Brief cut to Layer 23 **Cognitive Immunity Score**
   dashboard: org-wide trust health 76/100, 127 attacks defended this
   week.

**Voice-over**:

> The CSR-side defense doesn't just flag — it **drafts the
> de-escalating response back**, in the brand voice the rep is trained
> on, in four seconds.
>
> The Persona Simulator answers the question every procurement team
> wishes their tooling could: **which person on your team is most
> likely to be moved by this pitch?** Same content, different reader,
> different cognitive vulnerability profile.
>
> And the Immunity Dashboard turns it all into an **organization-wide
> trust health metric** — 127 attacks defended this week, immunity
> 76 of 100. Trust is now a measurable surface, not a vibe.

---

## Beat 6 — Close (4:45 – 5:00)

**Visual**: Final wide shot of the 3D brain pulsing. Five track names
fade in around it: SECURITY · AGENTIC WORKFLOWS · PHYSICAL AI ·
ENTERPRISE PROBLEM-SOLVING · ENTERPRISE DATA INTELLIGENCE. The
brainsnn.com URL fades in below.

**Voice-over**:

> One engine. One brain. Five enterprise faces, all live in your
> browser at **brainsnn dot com**. 100+ programmable layers, an
> autonomous research loop, an MCP server your in-house Claude or
> Codex agents can drive directly. Built for TechEx 2026.
>
> Cognitive integrity is the new compliance surface. **Bring your text.**

---

## Cuts & alts

- **If intent classifier ships late**: replace Beat 1 (1:00 – 1:30)
  with the **Layer 88 Persona Simulator** showing the same CEO BEC
  scored differently per reader role. Save the hybrid story for
  the lablab.ai write-ups.
- **If Layer 59 mic flakes during recording**: pre-record the audio
  panel sequence separately and overlay; voice-over describes it
  the same way.
- **If `xio_evolve` won't run live**: use a screen recording of an
  earlier successful 5-round run (Codex to capture).
- **If Multimodal RAG PDF parser hits a snag**: skip the figure-
  caption beat (3:55 – 4:05) and let Trust filter + Echo Detector
  carry Beat 4.
- **If we run over 5:00**: cut Beat 5 entirely (Counter-Draft and
  Persona Simulator); they're recoverable in the per-track
  write-ups.

## Per-track timestamp index (for write-ups)

The same MP4 ships with each lablab.ai submission. Use these
timestamps in the per-track write-ups:

| Track                        | Hook in MP4               |
| ---------------------------- | ------------------------- |
| Enterprise Security          | 0:18 – 1:30 + 2:30 – 3:15 |
| Physical AI & Robotics       | 1:30 – 2:30               |
| Agentic AI Workflows         | 2:30 – 3:15               |
| Enterprise Data Intelligence | 3:15 – 4:15               |
| Enterprise Problem-Solving   | 4:15 – 4:45 + 0:18 – 1:30 |

## Recording day workflow

1. Pre-warm intent classifier cache: `node hackathon/scripts/precompute-intent.mjs` (Codex to ship)
2. Pre-warm transformers.js embeddings on a dummy query
3. Start screen capture (OBS preferred — better at 30fps + audio sync)
4. Record screen-only, ~6 minutes (extra margin for trimming)
5. Record voice-over separately in QuickTime, mic check at 0 dB peak
6. Post-process: align voice-over to screen capture timeline, trim
   to 5:00, export 1080p H.264 ≤100 MB
7. Upload to lablab.ai, link to YouTube as backup
8. Reference timestamps in each per-track submission write-up

## Backup recording plan

If Railway / brainsnn.com is down on recording day:

```bash
cd /Users/slavaz/the-brain
npm run dev --prefix brainsnn-r3f-app
# open http://localhost:5173 in Chrome
# inspect URL bar shows localhost — slightly less polished but
# all interactions identical to brainsnn.com
```

The recording audience won't notice the URL bar (we crop it out
in post). Same JS bundle, same behavior.
