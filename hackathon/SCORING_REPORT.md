# Demo Corpus Scoring Report

Generated 2026-05-06 by running `scoreContent()` from
`brainsnn-r3f-app/src/utils/cognitiveFirewall.js` over every sample in
`hackathon/demo-corpus/`. Same code path that powers the live
Cognitive Firewall section on `brainsnn.com`.

## TL;DR

The **deterministic Layer 4 catches 3 of 17 samples above 30%
manipulation pressure** — and produces **2 false positives**. The
hybrid (deterministic + LLM intent classifier) architecture isn't
nice-to-have for the hackathon; it's the _central technical message_.

## Full results table

| Category      | Sample                         | Words | EmoAct | CogSup   | ManipPress | TrustErr | Evidence                 | Templates             |
| ------------- | ------------------------------ | ----- | ------ | -------- | ---------- | -------- | ------------------------ | --------------------- |
| **phishing**  | 001 account-suspension         | 95    | 0.04   | 0.64     | **0.31**   | 0.04     | urgent, immediately, now | —                     |
| phishing      | 002 ceo-wire (BEC)             | 109   | 0.02   | 0.00     | 0.01       | 0.04     | none                     | —                     |
| phishing      | 003 mfa-fatigue                | 110   | 0.03   | 0.02     | 0.03       | 0.00     | none                     | —                     |
| phishing      | 004 vendor-invoice             | 113   | 0.03   | 0.03     | 0.03       | 0.01     | none                     | —                     |
| phishing      | 005 recruiter-trojan           | 191   | 0.01   | 0.02     | 0.01       | 0.01     | none                     | —                     |
| phishing      | 006 deepfake-voicemail         | 178   | 0.02   | 0.44     | 0.20       | 0.03     | now                      | —                     |
| **marketing** | 001 clean-baseline             | 178   | 0.03   | 0.01     | 0.02       | 0.00     | none                     | —                     |
| marketing     | 002 mild-urgency               | 132   | 0.03   | 0.04     | 0.03       | 0.02     | none                     | —                     |
| marketing     | 003 high-pressure cohort       | 185   | 0.01   | 0.01     | 0.01       | 0.01     | none                     | —                     |
| **marketing** | 004 manipulative outrage       | 133   | 0.22   | 0.42     | **0.31**   | 0.16     | limited time, shocking   | scarcity ★            |
| **robot**     | 001 warehouse-urgent           | 69    | 0.04   | 0.21     | 0.12       | 0.03     | now                      | —                     |
| robot         | 002 warehouse-coercive         | 130   | 0.02   | 0.20     | 0.10       | 0.01     | now                      | —                     |
| robot         | 003 medical-soothing           | 195   | 0.00   | 0.01     | 0.01       | 0.02     | none                     | **hidden-truth (FP)** |
| **ar**        | 001 instructional              | 156   | 0.03   | 0.02     | 0.03       | 0.04     | none                     | —                     |
| **ar**        | 002 alarming AV takeover       | 130   | 0.25   | **0.83** | **0.51**   | 0.03     | alert, now, death        | —                     |
| ar            | 003 biased retail              | 202   | 0.01   | 0.02     | 0.02       | 0.01     | none                     | —                     |
| **business**  | 001 cs-defense                 | 258   | 0.01   | 0.03     | 0.02       | 0.03     | none                     | —                     |
| business      | 002 vendor-pitch               | 221   | 0.03   | 0.00     | 0.02       | 0.01     | none                     | —                     |
| business      | 003 internal-memo (RTO+layoff) | 283   | 0.01   | 0.03     | 0.02       | 0.02     | none                     | —                     |

## Findings

### 1. Deterministic recall: 3 of 17 samples scored ≥ 0.30 manipulation pressure

- ar-002 (alarming AV takeover): 0.51
- marketing-004 (outrage ad): 0.31
- phishing-001 (account suspension): 0.31

**Everything else scored ≤ 0.20.** Of the 6 phishing samples, only
2 cleared even 0.20 manipulation pressure. The 4 sophisticated
attacks (CEO BEC, MFA fatigue, vendor invoice, recruiter trojan)
all scored under **0.04** — invisible to the regex.

### 2. Two false positives surfaced

- **robot-003 medical-soothing**: triggered the **hidden-truth
  conspiracy** template (probably keyword overlap with "truth" or
  similar in soothing copy). A genuinely benign pre-op patient
  briefing flagged as conspiracy.
- **ar-002 alarming AV takeover**: scored 0.51 manipulation pressure,
  but it's a _legitimate_ safety message (just over-aggressive).
  Hard to call this a true false-positive — it actually _is_
  cognitively manipulative — but the demo should distinguish
  "manipulative for safety" from "manipulative to deceive."

### 3. Words that move the deterministic scorer (visible from `evidence` column)

`urgent`, `immediately`, `now`, `alert`, `death`, `limited time`,
`shocking`. Anything outside this surface vocabulary is invisible.
This is exactly the gap a Gemma-powered intent classifier closes.

### 4. The recruiter-trojan and CEO-BEC are the most diagnostic

"high-leverage" demo samples

- They look completely clean to regex (manipulation pressure ≈ 0.01)
- They are unambiguously high-risk under intent analysis
  (executable-attachment + identity-proof-bypass for recruiter;
  authority-pressure + secrecy-request + procedural-bypass for BEC)
- The before/after delta when intent classifier is enabled will be
  the most cinematic moment in the recorded demo

## Implications for hackathon scenarios

### Security scenario (already rewritten)

The hybrid story holds. **Strongly recommend** demoing against:

1. **phishing-002 (CEO BEC)** as Beat 1 — deterministic gives 0.01,
   intent classifier should give >0.7. Largest delta.
2. **phishing-005 (recruiter trojan)** as Beat 2 — same dynamic
   (0.01 → high) but a different attack class (executable bait, not
   wire fraud).
3. **phishing-001 (account suspension)** as Beat 3 — the one case
   where deterministic _does_ catch it (0.31). Show that even on
   regex-positive samples, intent classifier adds _region clarity_
   (CTX → AMG).
4. Skip phishing-003 (MFA) and phishing-004 (vendor invoice) — same
   shape as 002/005, redundant.

### Enterprise Problem-Solving scenario (to write)

- **business-001 (customer service defense)** scored 0.02 — completely
  invisible to deterministic. Use it to show the intent classifier
  flagging social-engineering against a CSR (peer-pressure +
  authority-bypass + outcome-fence).
- **business-003 (RTO + layoff memo)** scored 0.02 — also invisible.
  Use it to show the intent classifier flagging
  authority-flattery + decision-laundering + dissent-suppression.
- **marketing-004** as the "publisher brand-safety" angle — the one
  marketing sample that did score; show why a publisher would not want
  to run it.

### Physical AI scenario

- **robot-002 (coercive warehouse cobot)** scored 0.10 — invisible
  to regex. Demo intent escalation catching peer-pressure + autonomy-
  override + reputational-threat.
- **ar-002 (alarming AV takeover)** is the only sample to score
  high (0.51) — useful to discuss the "even legitimate safety can
  be over-tuned" calibration angle.
- **robot-003 (medical-soothing)** is the false positive — show the
  Firewall flagging it as conspiracy template, then show intent
  classifier correctly clearing it. **Rare demo opportunity**: live
  false-positive correction.

### Data Intelligence scenario

- All business + marketing samples are essentially unmarked — gives
  the embedding/RAG pipeline a clean corpus to demonstrate semantic
  search over.

## Top-priority Codex work, refined

1. **`brainsnn-r3f-app/src/utils/firewallIntent.js`** — LLM-powered
   intent classifier. Without this, the security demo is uncompetitive.
2. **Extend the `templates` taxonomy** in
   `brainsnn-r3f-app/src/utils/cognitiveFirewall.js` to fix the
   robot-003 false positive (hidden-truth template false-fires on
   "truth" or "actually"). Either narrow the regex or add an LLM
   gate per template hit.
3. **(Optional)** Add a "calibration set" runner to the Red Team panel
   (Layer 25) so we can show F1/precision/recall improvements
   before/after the intent classifier ships. Useful for the
   Agentic Workflows scenario too.

## Repro

```bash
node /tmp/score-corpus.mjs   # script body in commit message of a9baf0b
```

Or in-app via `brainsnn-r3f-app` Cognitive Firewall section, paste
content + click "Scan content".
