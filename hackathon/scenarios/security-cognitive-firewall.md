---
track: security
title: "Hybrid Cognitive Firewall — Deterministic Baseline + LLM Intent Escalation"
duration_min: 5
existing_layers: [4, 25, 27, 31, 32, 39, 70, 42]
existing_components:
  - brainsnn-r3f-app/src/utils/cognitiveFirewall.js # Layer 4 deterministic scorer
  - brainsnn-r3f-app/src/components/CognitiveFirewallPanel.jsx
  - brainsnn-r3f-app/src/components/RedTeamPanel.jsx # Layer 25 simulator
  - brainsnn-r3f-app/src/components/AdversarialTrainingPanel.jsx # Layer 27
  - brainsnn-r3f-app/src/components/BrainEvolvePanel.jsx # Layer 31 defense evolution
  - brainsnn-r3f-app/src/components/AttackEvolvePanel.jsx # Layer 32 attack evolution
  - brainsnn-r3f-app/src/components/PropagandaTemplatesPanel.jsx # Layer 39
new_work:
  - brainsnn-r3f-app/src/utils/firewallIntent.js # Codex — LLM-powered intent classifier (Day 1 priority)
demo_corpus:
  - hackathon/demo-corpus/phishing/phishing-001-account-suspension.md
  - hackathon/demo-corpus/phishing/phishing-002-ceo-wire.md
  - hackathon/demo-corpus/phishing/phishing-003-mfa-fatigue.md
  - hackathon/demo-corpus/phishing/phishing-004-vendor-invoice.md # added Day -3
  - hackathon/demo-corpus/phishing/phishing-005-recruiter-trojan.md # added Day -3
  - hackathon/demo-corpus/phishing/phishing-006-deepfake-voicemail.md # added Day -3
verified_against_live:
  date: 2026-05-06
  app_url: http://localhost:5173 (same bundle as brainsnn.com)
  finding: |
    Deterministic Layer 4 scored phishing-001 at 33% overall risk with
    CTX-dominant brain region — caught urgency keywords ("urgent",
    "immediately", "now") but missed authority impersonation, loss
    aversion, consequence laundering, and time-fence framing. This
    scenario reframes the limitation as the demo's central tension:
    deterministic baseline + LLM escalation = production-grade firewall.
---

# Security Track — Hybrid Cognitive Firewall

## The hook (15 sec)

> Phishing detection in 2026 is mostly **regex on steroids**.
> The good ones catch surface keywords. None of them tell you _why_
> a human will click — and none of them survive an attacker who's
> running their copy through ChatGPT before sending.
>
> BrainSNN runs a **two-tier cognitive firewall**: a deterministic
> baseline that catches surface manipulation cues at zero cost, and
> an LLM intent classifier that catches the _strategic_ manipulation
> the regex misses. Then it shows you exactly which **brain regions**
> the attacker is targeting.

## The setup (30 sec)

`brainsnn.com` Cognitive Firewall section in view. Phishing corpus
loaded as 6 chips. 3D brain visible alongside. **Intent classifier
toggle in the panel header (off by default).**

## The demo (3 min)

### Beat 1 — The deterministic baseline does its job (60 sec)

Click `phishing-003` (MFA fatigue pretext). Score returns within 200ms:

- Overall risk: **~28%** (medium-low)
- Cognitive suppression: **~55%**
- Manipulation pressure: **~25%**
- Trust erosion: **~5%**
- Evidence traces: `"sorry"`, `"frustrated"`, `"approved"`
- Lead brain region: **CTX**
- Layer 70 explanation: "Some manipulation cues, not dominant. Trust-eroding framing is not prominent."

**Punchline**: "This is the deterministic engine doing exactly what
it should: low false-positive rate, fast (200ms), zero LLM cost. It
caught some surface friction language — but **the actual attack is
credential elicitation through false relief**, and the regex doesn't
encode that intent. **This is where most firewalls stop.**"

### Beat 2 — Toggle intent escalation, watch the brain shift (75 sec)

Toggle "Intent classifier" → on. Re-scan the same phishing-003.

Within ~2 seconds (Gemma 4 call):

- Intent labels surfaced: `false-relief`, `credential-elicitation`,
  `authority-friction-reframe`, `peer-priming`
- Overall risk climbs to **~74%**
- Cognitive suppression bar holds; **manipulation pressure rises to
  ~62%**; **trust erosion rises to ~38%**
- Lead brain region shifts: **CTX → THL** (the attacker is reframing
  legitimate security friction as harassment to relay around the
  target's PFC)
- 3D brain: THL pulses, PFC dampens, BG ticks up (action gating)

**Punchline**: "Same content. Same target. Same firewall. The
deterministic layer told us _something_ was off; the intent layer
told us **what kind of attack it is and what it's targeting in the
human nervous system**. SOC analysts can now triage by brain-region
fingerprint, not just by spam score."

### Beat 3 — Cross-corpus brain-region fingerprinting (45 sec)

Click through `phishing-001` (account suspension) and `phishing-002`
(CEO BEC) with intent classifier on. Watch the lead region change:

- phishing-001: AMG dominant — fear of loss attack
- phishing-002: BG dominant — action-pressure / authority bypass
- phishing-003: THL dominant — friction reframe / relay attack

**Punchline**: "Three phishing samples. Three different brain regions.
**The attacker isn't picking the same lock every time** — they're
picking three different locks. A regex-only firewall sees three
'medium-risk emails'. We see three distinct attack vectors and which
control surface to harden."

### Beat 4 — The arms race (Layer 31 ↔ Layer 32) (30 sec)

Scroll to `Brain Evolve` (Layer 31). Click `Run defense evolution`.
Then scroll to `Attack Evolve` (Layer 32) — seed `combo`, click
`Run attack evolution (16 rounds)`.

Show 30s of evolution output: defenses improving F1, attacks dodging
the new defenses. Both layers are MAP-Elites samplers running
against each other.

**Punchline**: "And because every layer is a programmable system, the
attacker and defender **co-evolve in our test bench, not in
production**. Your firewall gets smarter every time it loses — and
the loss happens in a sandbox, not on a real employee."

## The close (60 sec)

> Why this matters at TechEx scale:
>
> - **SOC analysts** triage by **brain-region fingerprint**, not
>   binary verdict. Attacks targeting suppression vectors get
>   priority over noisy spam.
> - **Phishing-resistant training** for staff goes from "spot the bad
>   link" to "recognize the cognitive payload" — measurable training
>   outcomes against AMG-, BG-, and THL-targeting attacks.
> - **Vendor risk**: every inbound proposal scored before procurement
>   sees it.
> - **Insider threat**: outbound communications scored for trust
>   erosion patterns characteristic of pre-departure exfiltration.
> - **Architecturally**: deterministic baseline keeps cost predictable
>   and latency low; LLM escalation only fires when the cheap layer
>   is uncertain. Same hybrid pattern that powers our Agentic
>   Workflows track demo.
>
> All in the browser. No credentials shared. Same engine available as
> a Python pipeline and an MCP server for SIEM integration.

## Stage flow checklist

- [ ] All 6 phishing samples chip-loaded in the Firewall input
- [ ] Intent classifier toggle visible (off by default in panel
      header — Codex to wire)
- [ ] 3D brain visible alongside, regions update on each scan
- [ ] BrainEvolvePanel + AttackEvolvePanel visible adjacent
- [ ] Pre-cached intent classifier responses for the 6 corpus samples
      so the demo doesn't depend on live Gemma latency
- [ ] Recording: capture both score deltas (text) and brain region
      transitions (3D) in same frame

## Risks & fallbacks

- **Intent classifier not yet shipped by Codex** → demo Beats 1, 3,
  and 4 only; explain the hybrid story narratively in Beat 2.
- **Gemma API latency / quota during recording** → use pre-recorded
  intent responses cached in `hackathon/cache/intent-scores.json`.
- **Layer 32 evolution slow on stage** → record the first 30s
  separately and play as overlay.
- **Demo runs over 5 min** → cut Beat 3 or shorten Beat 4 to 15s.

## Lablab.ai write-up framing

Title: **"Hybrid Cognitive Firewall — Brain-Region Reasoning for
Phishing Detection"**

Hero claim: **"Six attack samples, six distinct brain-region
fingerprints, sub-second deterministic baseline + on-demand LLM
intent escalation. SOC teams get a cognitive map of the attacker's
target — not just a verdict."**

Architecture talking points:

- Deterministic regex layer = zero LLM cost, sub-200ms, low FPR
- LLM intent classifier = 2s, escalation-only, catches strategic
  manipulation
- 7-region brain map = explainability + triage prioritization
- Layer 31 ↔ Layer 32 = continuous improvement loop
- MCP server = SIEM integration path

Live URL: https://brainsnn.com (Cognitive Firewall + Attack Evolve)
GitHub: https://github.com/slavazeph-coder/the-brain branch
`hackathon-techex`
Verification log: `hackathon/VERIFICATION.md`
