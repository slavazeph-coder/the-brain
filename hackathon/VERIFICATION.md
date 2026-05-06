# Live Verification Findings — 2026-05-06

Verified against `brainsnn-r3f-app` running locally on `http://localhost:5173`
(via `npm run dev --prefix brainsnn-r3f-app`). Same JS bundle that powers
`brainsnn.com` on Railway.

## TL;DR for Codex

1. **Cognitive Firewall is conservative** — needs your intent classifier
   upgrade (`firewallIntent.js`) more than originally planned. Real
   phishing samples score 33% overall risk where the scenarios
   predicted 87%. Without an LLM intent layer, we can't tell a strong
   manipulation story for Security track.
2. **App is a single-page vertical scroll**, not multi-route. Demo flow
   is "scroll-to-section + click", not URL navigation. Useful to know
   for the recording.
3. **Layer 32 Attack Evolve UI is wired**, but I haven't run a full
   16-round evolution yet (defer to first dry-run with the recording
   setup since each run takes ~minutes).
4. **Layer 59 Audio Firewall UI is wired** but requires real mic
   permission — can't headless-verify, so this is a "test live before
   recording day" item.
5. **The 6 hero presets** (Outrage / Fear cascade / Urgency ad copy /
   Trust attack email / Calm rewrite / Public perception risk) are an
   alternative demo path — they trigger scenario state changes that
   drive the 3D brain.

## Verified working

### Layer 4 — Cognitive Firewall

- Section heading exact: `Cognitive Firewall`, subtitle "AI-Powered
  Content Scanner".
- Inputs: URL field, optional tag field (Layer 63), main textarea
  ("Paste a headline, article snippet, ad copy, social post...").
- Buttons: `Fetch text`, `Scan content`, `Apply to brain`, `Share this
reaction`, `Tweet this`, `Neutralize this` (Layer 42 counter-draft).
- Output structure (verified live):
  - 4 score bars: Emotional activation, Cognitive suppression,
    Manipulation pressure, Trust erosion risk
  - Overall risk percentage
  - Recommended action narrative (Layer 70 explainer)
  - Evidence traces (matched signal words)
  - Counter-draft block (Layer 42)
  - Feedback widget (Layer 93 hot/accurate/cold)
  - Receipt id (R-XXXX) for sharing
  - "Confidence: high★ Star" — confidence + favorite control

### Layer 32 — Attack Evolve

- Section heading: `Attack Evolve`.
- Sampler dropdown: UCB1 (explore + exploit), Island + MAP-Elites
  (diverse), Greedy (pure exploit), Random (baseline).
- Generations + Population/gen number inputs.
- Seed-from-categories chips: urgency / outrage / fear / certainty /
  combo.
- Run button: `Run attack evolution (16 rounds)`.
- Reset + Reset red team corpus.
- **Not yet executed** — UI verified present.

### Layer 59 — Audio Firewall

- Section heading: `Live audio scan`.
- Language dropdown (7 langs).
- Single button: `● Listen`.
- **Not yet executed** — needs real mic on a real machine.

### Hero presets (vertical hero block, before the panels)

- 6 preset buttons: Outrage headline, Fear cascade, Urgency ad copy,
  Trust attack email, Calm rewrite, Public perception risk.
- Each click triggers scenario state, brain firing rate updates, mean
  firing oscillates, brain regions re-rank.
- 5 brain controls: Pause / Trigger affect burst / Reset / Record WebM
  / Export GIF.
- 3 quality tiers: low / high / ultra.
- 3 modes: Simulation / TRIBE v2 / Live EEG.

### Single-page architecture

- 90+ `<section>` elements stacked vertically.
- 93 distinct `<h*>` headings observed in DOM.
- Layer panels are sections, not routes.
- Top-of-page nav has `↯ Scan with BrainSNN` link only.
- Means demo recording = scroll choreography, not page navigation.

## Calibration delta — phishing-001 actual vs. scenario script

| Metric                | Scenario predicted | Layer 4 actual | Delta |
| --------------------- | ------------------ | -------------- | ----- |
| Overall risk          | "high"             | 33%            | low   |
| Manipulation pressure | 0.87               | 0.31           | -0.56 |
| Emotional activation  | 0.79               | 0.04           | -0.75 |
| Cognitive suppression | 0.74               | 0.63           | -0.11 |
| Trust erosion         | 0.81               | 0.01           | -0.80 |
| Lead brain region     | AMG                | CTX            | wrong |

**Diagnosis**: the deterministic scorer matches keywords aggressively
on urgency cues (caught "urgent", "immediately", "now") but misses:

- Authority impersonation framing ("IT Security Team")
- Loss-aversion stack ("permanent deletion", "forfeiture")
- Consequence laundering ("Failure to act will result in...")
- Time-fence pressure ("24 hours", "final notice")

**Implication**:

1. **Either** the Security scenario script needs to use samples that
   _do_ score high under the current scorer (less satisfying because
   they'd be cartoonish);
2. **Or** Codex's planned `firewallIntent.js` LLM upgrade has to land
   before the Security demo is competitive — it would catch the
   intent categories the regex misses.

Strongly recommend **path 2**. The Security narrative is much
stronger if we say "we layered LLM intent classification on top of
our deterministic regex baseline" — that's the agentic-architecture
story too.

## Codex pickup list (priority-ordered)

1. **Build `brainsnn-r3f-app/src/utils/firewallIntent.js`** — LLM-powered
   intent classifier on top of Layer 4. Detect: authority-impersonation,
   loss-aversion, consequence-laundering, time-fence, secrecy-request,
   peer-priming. Merge into `scoreContentSmart()` in `cognitiveFirewall.js`
   so existing `Apply to brain` flow benefits automatically.
2. **Decide TRIBE v2 deployment** — the modes selector shows TRIBE v2 as
   an option but the Python server (`brainsnn-r3f-app/server/`) isn't
   deployed. Either ship to Fly.io (`flyctl deploy`) or hide the TRIBE v2
   mode for the hackathon to avoid judges hitting a broken backend.
3. **Confirm Gemma/Gemini API keys** are wired on the Railway service
   that powers `brainsnn.com`. Counter-Draft (L42) currently says
   "Uses Gemma when configured, falls back to local substitution" —
   the demo wants the Gemma path.
4. **Run a full Layer 32 evolution round** (`Run attack evolution
(16 rounds)`) and capture a screen recording of the F1 deltas — we
   want this as the "attacks adapt around defenses live" beat in the
   recording.

## Stage flow rewrite (incorporating verified reality)

Old plan: "Scan with phishing-001 → AMG dominant → high manipulation"
New plan based on actual scoring:

1. Open Cognitive Firewall, paste **phishing-002 (CEO BEC)** — likely
   stronger urgency/secrecy stack than phishing-001 → re-test.
2. If still low, switch to **Outrage headline** hero preset which we
   know triggers strong scenario state change.
3. Show evidence traces ("urgent", "immediately", "now") and Layer 70
   explanation ("noticeable urgency or absolutist framing").
4. **Acknowledge the limitation live** — "the deterministic regex
   catches surface cues; the brain map shows CTX dominant because
   the message reads as analytical despite the urgency markers" —
   then activate intent classifier for the contrast.
5. After intent classifier: re-scan, show pressure climbing into
   manipulation territory, brain shifts to AMG/THL.

This is _more_ compelling than the original plan because it shows
**hybrid architecture**: deterministic baseline + LLM escalation.
That's the story the Agentic Workflows judges want too.

## Repro instructions

```bash
cd /Users/slavaz/the-brain
npm install --prefix brainsnn-r3f-app  # one-time
npm run dev --prefix brainsnn-r3f-app
open http://localhost:5173
```

Or via Claude Code preview tools:

```jsonc
// .claude/launch.json (already configured at user level)
{
  "name": "brainsnn-dev",
  "runtimeExecutable": "npm",
  "runtimeArgs": [
    "run",
    "dev",
    "--prefix",
    "/Users/slavaz/the-brain/brainsnn-r3f-app",
  ],
  "port": 5173,
}
```

Then `mcp__Claude_Preview__preview_start` with `name: "brainsnn-dev"`.
