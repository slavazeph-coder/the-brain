# Hybrid Cognitive Firewall — Phishing Detection That Explains Why Humans Click

**Track**: Enterprise Security
**Live**: https://brainsnn.com (Cognitive Firewall section)
**Repo**: https://github.com/slavazeph-coder/the-brain (branch `hackathon-techex`)
**Demo video**: [MP4 link to be inserted post-recording] · 00:18 – 01:30 + 02:30 – 03:15

## The problem

Email security in 2026 is mostly **regex on steroids**. The good ones
catch surface keywords. None of them tell you _why_ a human will click,
and none survive an attacker who runs their copy through ChatGPT
before hitting send.

We measured this against 17 hand-built attack samples across 6 phishing
classes (account suspension, CEO BEC, MFA fatigue, vendor invoice,
recruiter trojan, deepfake voicemail). The deterministic regex baseline
caught only **3 of 17 samples** above 0.30 manipulation pressure, and
produced **2 false positives**. The 4 sophisticated phishing samples
all scored under 0.04 — invisible.

## The solution

**BrainSNN ships a hybrid Cognitive Firewall**: a deterministic
keyword baseline that's free and sub-200ms, plus an on-demand LLM
intent classifier that catches the strategic manipulation the regex
misses, plus a 3D brain map that shows which **brain region** the
attacker is targeting.

A SOC analyst now sees:

- A sub-second deterministic verdict (cheap, low FPR)
- An optional 2-second intent classifier verdict (catches BEC,
  recruiter trojans, MFA-fatigue pretexts the regex misses)
- A 7-region brain map showing whether the attacker targets the
  amygdala (fear), basal ganglia (action gating), thalamus
  (salience reframe), or prefrontal cortex (executive override)
- Layer 32 Attack Evolve: a co-evolving adversarial sandbox that
  _generates new attacks_ against the current firewall state, so
  the test bench gets meaner every time the firewall improves
- Layer 31 Brain Evolve: defenses evolve back, F1 climbs from
  0.18 → 0.81 in 5 rounds of the autonomous research loop

## Architecture talking points

- **Hybrid by design**: deterministic baseline first, LLM
  escalation second. Predictable cost. Sub-200ms p50 latency.
- **Brain-region fingerprinting**: every detected attack class maps
  to a dominant cognitive system. SOC analysts triage by _which
  control surface to harden_, not just by spam score.
- **Co-evolution sandbox**: Brain Evolve (Layer 31) and Attack
  Evolve (Layer 32) run as paired MAP-Elites loops. Defense F1 vs
  attack evasion rate is a continuous benchmark.
- **Falsifiable**: the verification report at
  [hackathon/SCORING_REPORT.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/SCORING_REPORT.md)
  documents real scores against the corpus. No promotional numbers.
- **In the browser**: the deterministic engine ships entirely in
  client JS. The LLM escalation is opt-in per scan, not always-on.

## Why this matters at TechEx scale

- **SOC triage**: prioritize alerts by brain-region fingerprint, not
  binary verdict. Attacks targeting suppression vectors get pulled
  ahead of noisy spam.
- **Phishing-resistant training**: staff training shifts from "spot
  the bad link" to "recognize the cognitive payload" — measurable
  outcomes against AMG-, BG-, and THL-targeting attacks.
- **Vendor risk**: every inbound proposal scored before procurement
  reads it.
- **Insider threat**: outbound communications scored for trust
  erosion patterns characteristic of pre-departure exfiltration.
- **Architectural reuse**: same hybrid pattern (deterministic baseline
  - LLM escalation) is what powers our Agentic Workflows and Data
    Intelligence submissions to this hackathon. One engine, five faces.

## Reproduce locally

```bash
git clone https://github.com/slavazeph-coder/the-brain.git
cd the-brain
git checkout hackathon-techex
npm install --prefix brainsnn-r3f-app
npm run dev --prefix brainsnn-r3f-app
# open http://localhost:5173, scroll to Cognitive Firewall
```

Test corpus + scoring methodology: see
[hackathon/SCORING_REPORT.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/SCORING_REPORT.md).
Demo flow: [hackathon/scenarios/security-cognitive-firewall.md](https://github.com/slavazeph-coder/the-brain/blob/hackathon-techex/hackathon/scenarios/security-cognitive-firewall.md).
