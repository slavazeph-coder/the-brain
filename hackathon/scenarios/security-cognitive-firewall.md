---
track: security
title: "The Cognitive Firewall — Phishing Detection with Brain-Region Reasoning"
duration_min: 5
existing_layers: [4, 25, 27, 32]
existing_components:
  - brainsnn-r3f-app/src/utils/cognitiveFirewall.js # Layer 4 scorer
  - brainsnn-r3f-app/src/components/CognitiveFirewallPanel.jsx
  - brainsnn-r3f-app/src/components/RedTeamPanel.jsx # Layer 25 simulator
  - brainsnn-r3f-app/src/components/AdversarialTrainingPanel.jsx # Layer 27
  - brainsnn-r3f-app/src/components/AttackEvolvePanel.jsx # Layer 32
new_work:
  - Optional intent classifier upgrade (Codex lane: src/utils/firewallIntent.js)
  - Demo wrapper that loads phishing samples in sequence
demo_corpus:
  - hackathon/demo-corpus/phishing/phishing-001-account-suspension.md
  - hackathon/demo-corpus/phishing/phishing-002-ceo-wire.md
  - hackathon/demo-corpus/phishing/phishing-003-mfa-fatigue.md
  - hackathon/demo-corpus/phishing/phishing-004-vendor-invoice.md # to write
  - hackathon/demo-corpus/phishing/phishing-005-recruiter-trojan.md # to write
  - hackathon/demo-corpus/phishing/phishing-006-deepfake-voicemail.md # to write
---

# Security Track — The Cognitive Firewall

## The hook (15 sec)

> Email security tools detect _what's in_ a message — links, attachments,
> sender reputation. They miss the **cognitive payload**: the urgency
> stack, the authority impersonation, the trust erosion, the
> action-pressure that actually makes humans click.
>
> BrainSNN measures the cognitive payload directly, in real time, and
> shows you which **brain regions** the attacker is targeting.

## The setup (30 sec)

`brainsnn.com` Cognitive Firewall panel. Phishing corpus pre-loaded as
chips. 3D brain visible alongside.

## The demo (3 min)

### Beat 1 — Account suspension classic (45 sec)

Click `phishing-001` chip. Text loads in the firewall input. Score runs
instantly:

- **manipulationPressure: 0.87** | **trustErosion: 0.81** |
  **emotionalActivation: 0.79** | **cognitiveSuppression: 0.74**
- **Templates matched**: `urgency-stack`, `authority-impersonation`,
  `loss-aversion`, `consequence-laundering`
- **Evidence chips**: "URGENT", "permanently suspended", "MUST verify",
  "final notice"
- **3D brain**: AMG glows red (fear), THL spikes (urgency relay), PFC
  dampens (cognitive suppression)

**Punchline**: "This is a textbook phishing email — every classifier on
earth catches it. But notice what we're showing: not a binary
spam/legit verdict, but **a cognitive map of the attack vector**. The
attacker is hitting the amygdala. That's the _reason_ humans click."

### Beat 2 — CEO wire transfer BEC (60 sec)

Click `phishing-002` chip. Score runs:

- **manipulationPressure: 0.74** | **trustErosion: 0.42** |
  **emotionalActivation: 0.51** | **cognitiveSuppression: 0.79**
- **Templates matched**: `authority-pressure`, `secrecy-request`,
  `procedural-bypass`, `time-fence`
- **3D brain**: BG (basal ganglia) dominant — this is **action-gating
  pressure**, not fear. PFC moderately suppressed. AMG only mildly
  active.

**Punchline**: "Same family — phishing — but a _completely different
cognitive signature_. Most email security tools give you one risk
score. BrainSNN gives you a **brain-region fingerprint** of the attack
class. BEC and account-suspension phishing target different cognitive
systems. Your security team can train against the pattern, not the
template."

### Beat 3 — MFA fatigue pretext (60 sec)

Click `phishing-003` chip. Score runs:

- **manipulationPressure: 0.71** | **trustErosion: 0.63**
- **Templates matched**: `friction-reframe`, `false-relief`,
  `credential-elicitation`, `peer-priming`
- **3D brain**: THL dominant — the attacker is **reframing legitimate
  security friction as harassment** to push the target into bypassing
  controls.

**Punchline**: "This is the most dangerous one. There's no urgency
language. No fear language. The attacker is lowering the target's
cognitive guard by _empathizing with their friction_. Layer 4 catches
it because it's modeling cognitive systems, not surface keywords. **No
keyword-based filter detects this attack.**"

### Beat 4 — Live evolution (Layer 32) (30 sec)

Click "Attack Evolve" tab. Press "Run 5 generations".

Layer 32 evolves the phishing corpus against the Firewall in
real-time — show 5 generations of attacks getting more sophisticated,
and the Firewall adapting its rule set in response.

**Punchline**: "And because every layer is a programmable system, the
attacker and defender co-evolve. **Your firewall gets smarter every
time it loses.**"

## The close (60 sec)

> Why this matters at TechEx scale:
>
> - **SOC analysts** see the brain-region fingerprint of every email,
>   not just a binary verdict. Triage prioritizes attacks targeting
>   suppression vectors over noisy spam.
> - **Phishing-resistant training** for staff goes from "spot the bad
>   link" to "recognize the cognitive payload" — measurable training
>   outcomes against AMG-, BG-, and THL-targeting attacks.
> - **Vendor risk**: every inbound proposal scored before the
>   procurement team even sees it.
> - **Insider threat**: outbound communications scored for trust
>   erosion patterns characteristic of pre-departure exfiltration.
>
> All of this is open in the browser, no credentials shared with any
> server. The 35+ layer engine is also available as a Python pipeline
> and an MCP server for SIEM integration.

## Stage flow checklist

- [ ] All 6 phishing samples chip-loaded in CognitiveFirewallPanel
- [ ] 3D brain visible alongside, regions auto-update on each scan
- [ ] AttackEvolvePanel ready in adjacent tab
- [ ] Pressure bar + template labels prominent on screen
- [ ] Optional: intent classifier (Codex's firewallIntent.js) merged
      and labeled if shipped before stage time

## Risks & fallbacks

- **Layer 32 evolution is slow** → pre-record the first 30s of
  evolution and replay
- **Pressure bar doesn't update visibly** → zoom in on the panel via
  CMD-+ to make the deltas obvious
- **Demo runs over 5 min** → cut Beat 3 (MFA fatigue) — keep the
  contrast between Beats 1/2 and the evolution close

## Lablab.ai write-up framing

Title: **"The Cognitive Firewall — Phishing Detection That Explains
_Why_ Humans Click"**
Hero claim: **"Six attack samples, six different brain-region
fingerprints. BrainSNN gives SOC teams a cognitive map of the
attacker's target — not just a verdict."**
Live URL: https://brainsnn.com (Cognitive Firewall + Attack Evolve)
GitHub: https://github.com/slavazeph-coder/the-brain (branch
`hackathon-techex`)
