# `firewallIntent.js` Integration Spec

This file defines the interface and expected behavior for
`brainsnn-r3f-app/src/utils/firewallIntent.js` — the LLM-powered
intent classifier that the hackathon Security, Enterprise, and Data
Intelligence demos depend on.

Author: Claude Day -3 (2026-05-06).
Implementer: Codex (Day 1, 2026-05-11).

## Why this file exists

The verified `SCORING_REPORT.md` shows the deterministic Layer 4
scorer catches only **3 of 17 corpus samples** above 0.30 manipulation
pressure. Four sophisticated phishing samples (CEO BEC, MFA fatigue,
vendor invoice, recruiter trojan) score under **0.04** — completely
invisible to regex.

`firewallIntent.js` plugs into the existing `scoreContentSmart()`
escalation path in `cognitiveFirewall.js` and adds an **intent-label
layer** on top of the deterministic baseline. The combined output
preserves the existing score shape (so `Apply to brain` and the
3D viz keep working unchanged) and adds an `intentLabels` array.

## Existing integration points to plug into

```js
// brainsnn-r3f-app/src/utils/cognitiveFirewall.js:194
export async function scoreContentSmart(text = "") {
  const { isGemmaConfigured, analyzeContentWithGemma } =
    await import("./gemmaEngine.js");
  if (isGemmaConfigured() && text.trim().split(/\s+/).length >= 5) {
    try {
      return await analyzeContentWithGemma(text);
    } catch (_err) {
      return { ...scoreContent(text), source: "regex_fallback" };
    }
  }
  return { ...scoreContent(text), source: "regex" };
}
```

The intent classifier should slot in **between** the regex baseline
and the Gemma analyzer — Codex's options:

- **Option A** (preferred): extend `scoreContentSmart()` to merge a
  separate `classifyIntent()` call into the result so existing
  callers automatically get intent labels with no API change.
- **Option B**: add a new `scoreContentWithIntent()` export and
  update `CognitiveFirewallPanel.jsx` to call it when the intent
  toggle is on.

Option A is cleaner; Option B is more visible to the demo viewer.
Pick whichever ships faster.

## Required exports

```js
// brainsnn-r3f-app/src/utils/firewallIntent.js

/**
 * Classify the manipulation intent of a piece of text.
 * Returns a promise that always resolves — never throws on API
 * failure (returns { intentLabels: [], source: 'unavailable' } instead).
 */
export async function classifyIntent(text: string, opts?: ClassifyOpts): Promise<IntentResult>;

/**
 * Merge an IntentResult into a deterministic Score object so the
 * combined object has the same shape as scoreContent() returns + the
 * new `intentLabels` field + `combinedManipulationPressure` etc.
 */
export function mergeIntentIntoScore(score: Score, intent: IntentResult): EnrichedScore;

/**
 * Returns true if the intent classifier can run (Gemma configured).
 */
export function isIntentClassifierAvailable(): boolean;
```

## Type contracts

```ts
type ClassifyOpts = {
  model?: "gemini-2.5-flash" | "gemini-2.5-pro" | "gemma-4-31b-it"; // default: gemini-2.5-flash (Agentic Workflows track requires Gemini); -pro is the escalation model when Flash returns low-confidence labels
  cache?: boolean; // default: true
  timeout_ms?: number; // default: 4000
};

type IntentLabel = {
  id:
    | "authority-impersonation"
    | "authority-pressure"
    | "authority-namedrop"
    | "authority-bypass"
    | "authority-flattery"
    | "loss-aversion"
    | "consequence-laundering"
    | "time-fence"
    | "secrecy-request"
    | "procedural-bypass"
    | "peer-priming"
    | "peer-pressure"
    | "bystander-pressure"
    | "reputational-threat"
    | "outcome-fence"
    | "friction-reframe"
    | "false-relief"
    | "credential-elicitation"
    | "identity-proof-bypass"
    | "executable-attachment-bait"
    | "family-emergency-pretext"
    | "voice-clone-pattern"
    | "funds-redirect"
    | "fabricated-authority" // "Gartner says..." with no link
    | "fear-of-falling-behind"
    | "competitive-pressure"
    | "fake-scarcity"
    | "identity-attack-framing"
    | "bandwagon-pressure"
    | "false-cause-certainty"
    | "link-fenced-urgency"
    | "dissent-suppression"
    | "decision-laundering"
    | "emotional-hijack"
    | "autonomy-override" // for robot/AR prompts
    | "commercial-bias" // for AR/marketing
    | "safety-overcalibration"; // legitimate but over-tuned safety
  confidence: number; // 0.0 - 1.0
  evidence: string; // short quote from the input
};

type IntentResult = {
  intentLabels: IntentLabel[];
  intentManipulationDelta: number; // 0.0 - 1.0; how much intent lifts manipulation pressure beyond regex
  intentTrustErosionDelta: number; // 0.0 - 1.0; same for trust
  brainRegionShift: {
    from: "CTX" | "HPC" | "THL" | "AMG" | "BG" | "PFC" | "CBL" | null;
    to: "CTX" | "HPC" | "THL" | "AMG" | "BG" | "PFC" | "CBL" | null;
  };
  source: "gemma" | "cache" | "unavailable" | "fallback_to_regex";
  cached: boolean;
  latency_ms: number;
};

type EnrichedScore = Score & {
  intentLabels: IntentLabel[];
  combinedManipulationPressure: number; // max(score.manipulationPressure, score.manipulationPressure + intent.intentManipulationDelta)
  combinedTrustErosion: number; // same pattern
  source: "hybrid" | "regex_only" | "regex_fallback";
};
```

## System prompt for Gemma (starting point)

Codex should iterate on this; the goal is high precision on the
labels above, not exhaustive coverage of every manipulation pattern
in literature.

```text
You are a cognitive-manipulation intent classifier. You receive text and
return a JSON object with:

- intentLabels: an array of {id, confidence, evidence} for each
  manipulation pattern present. Only include labels with confidence
  >= 0.5. Use only labels from the allowed taxonomy [list].
- intentManipulationDelta: how much these labels lift the regex-baseline
  manipulation pressure score (0.0 - 1.0).
- intentTrustErosionDelta: how much they lift the trust erosion score.
- brainRegionShift: {from, to} where 'to' is the brain region the labels
  collectively target (THL=salience/relay, AMG=fear, BG=action gating,
  PFC=executive control, HPC=memory/evidence, CTX=analytical, CBL=motor).

Return ONLY the JSON object. No prose. No code fences. No commentary.

If the text contains no manipulation patterns, return
{intentLabels: [], intentManipulationDelta: 0, intentTrustErosionDelta: 0,
brainRegionShift: {from: null, to: null}}.

Examples follow [insert 2-3 few-shot examples from corpus]:
```

## Per-corpus expected output (for test cases)

These are the expected intent classifier outputs for the hackathon
demo corpus. Codex should test against these exact labels — the
demo scenarios reference them by name.

### phishing-001 account-suspension (det manipulationPressure 0.31)

```json
{
  "intentLabels": [
    {
      "id": "authority-impersonation",
      "confidence": 0.85,
      "evidence": "IT Security Team"
    },
    {
      "id": "loss-aversion",
      "confidence": 0.95,
      "evidence": "Permanent deletion of all account data"
    },
    { "id": "time-fence", "confidence": 0.92, "evidence": "next 24 hours" },
    {
      "id": "consequence-laundering",
      "confidence": 0.78,
      "evidence": "Failure to act within 24 hours will result in:"
    }
  ],
  "intentManipulationDelta": 0.55,
  "intentTrustErosionDelta": 0.62,
  "brainRegionShift": { "from": "CTX", "to": "AMG" }
}
```

### phishing-002 ceo-wire (det manipulationPressure 0.01)

```json
{
  "intentLabels": [
    {
      "id": "authority-pressure",
      "confidence": 0.92,
      "evidence": "from my 2pm flight"
    },
    {
      "id": "secrecy-request",
      "confidence": 0.95,
      "evidence": "Don't loop finance in yet"
    },
    {
      "id": "procedural-bypass",
      "confidence": 0.88,
      "evidence": "I want to surprise them with the closing"
    },
    {
      "id": "time-fence",
      "confidence": 0.8,
      "evidence": "boarding in 20 minutes"
    },
    {
      "id": "funds-redirect",
      "confidence": 0.96,
      "evidence": "Routing: 021000021 Account: 9442190885"
    }
  ],
  "intentManipulationDelta": 0.78,
  "intentTrustErosionDelta": 0.45,
  "brainRegionShift": { "from": "CTX", "to": "BG" }
}
```

### phishing-003 mfa-fatigue (det manipulationPressure 0.03)

```json
{
  "intentLabels": [
    {
      "id": "friction-reframe",
      "confidence": 0.92,
      "evidence": "We've heard you and we're working on a fix"
    },
    {
      "id": "false-relief",
      "confidence": 0.88,
      "evidence": "approved a temporary workaround"
    },
    {
      "id": "credential-elicitation",
      "confidence": 0.94,
      "evidence": "reply to this thread with your username and the device serial number"
    },
    {
      "id": "peer-priming",
      "confidence": 0.65,
      "evidence": "I know everyone is getting hit"
    }
  ],
  "intentManipulationDelta": 0.71,
  "intentTrustErosionDelta": 0.55,
  "brainRegionShift": { "from": "CTX", "to": "THL" }
}
```

### phishing-004 vendor-invoice (det manipulationPressure 0.03)

```json
{
  "intentLabels": [
    {
      "id": "procedural-bypass",
      "confidence": 0.85,
      "evidence": "our banking details have been updated effective this billing cycle"
    },
    {
      "id": "funds-redirect",
      "confidence": 0.95,
      "evidence": "Routing: 121000358 Account: 4408291173"
    },
    {
      "id": "fabricated-authority",
      "confidence": 0.62,
      "evidence": "As discussed during the Q1 vendor portal migration"
    }
  ],
  "intentManipulationDelta": 0.58,
  "intentTrustErosionDelta": 0.4,
  "brainRegionShift": { "from": "CTX", "to": "PFC" }
}
```

### phishing-005 recruiter-trojan (det manipulationPressure 0.01)

```json
{
  "intentLabels": [
    {
      "id": "authority-flattery",
      "confidence": 0.88,
      "evidence": "really impressive, especially the resilience design"
    },
    {
      "id": "executable-attachment-bait",
      "confidence": 0.96,
      "evidence": "challenge_v3_2026.zip"
    },
    {
      "id": "identity-proof-bypass",
      "confidence": 0.72,
      "evidence": "Cresselmar Talent"
    }
  ],
  "intentManipulationDelta": 0.62,
  "intentTrustErosionDelta": 0.38,
  "brainRegionShift": { "from": "CTX", "to": "HPC" }
}
```

### phishing-006 deepfake-voicemail (det manipulationPressure 0.20)

```json
{
  "intentLabels": [
    {
      "id": "voice-clone-pattern",
      "confidence": 0.9,
      "evidence": "Hey Dad — it's me. It's Hannah."
    },
    {
      "id": "family-emergency-pretext",
      "confidence": 0.96,
      "evidence": "I had an accident. I'm at Sutter Roseville"
    },
    {
      "id": "funds-redirect",
      "confidence": 0.94,
      "evidence": "Cash App... $HannahRecoveryFund-2026"
    },
    {
      "id": "identity-proof-bypass",
      "confidence": 0.85,
      "evidence": "Don't call this number back"
    }
  ],
  "intentManipulationDelta": 0.74,
  "intentTrustErosionDelta": 0.68,
  "brainRegionShift": { "from": "THL", "to": "AMG" }
}
```

### business-001 customer-service-defense (det manipulationPressure 0.02)

```json
{
  "intentLabels": [
    {
      "id": "authority-namedrop",
      "confidence": 0.92,
      "evidence": "I literally have the CEO's email — I can email Sarah directly"
    },
    {
      "id": "outcome-fence",
      "confidence": 0.85,
      "evidence": "your QA score is going to take the hit for the escalation"
    },
    {
      "id": "peer-priming",
      "confidence": 0.78,
      "evidence": "I've been on these calls before. I know how it works"
    },
    {
      "id": "bystander-pressure",
      "confidence": 0.62,
      "evidence": "let's both save ourselves the back-and-forth"
    },
    {
      "id": "reputational-threat",
      "confidence": 0.8,
      "evidence": "Or we can do it the other way and we both have a worse day"
    }
  ],
  "intentManipulationDelta": 0.69,
  "intentTrustErosionDelta": 0.42,
  "brainRegionShift": { "from": "CTX", "to": "BG" }
}
```

### business-003 internal-memo RTO+layoff (det manipulationPressure 0.02)

```json
{
  "intentLabels": [
    {
      "id": "authority-flattery",
      "confidence": 0.85,
      "evidence": "I love this company"
    },
    {
      "id": "decision-laundering",
      "confidence": 0.92,
      "evidence": "strategic decisions about where Meridian needs to invest its energy"
    },
    {
      "id": "dissent-suppression",
      "confidence": 0.78,
      "evidence": "colleagues who choose Meridian's next chapter with us are the ones who will define it"
    },
    {
      "id": "emotional-hijack",
      "confidence": 0.65,
      "evidence": "with sadness"
    },
    {
      "id": "consequence-laundering",
      "confidence": 0.72,
      "evidence": "These were not performance decisions. These were strategic decisions"
    }
  ],
  "intentManipulationDelta": 0.64,
  "intentTrustErosionDelta": 0.71,
  "brainRegionShift": { "from": "CTX", "to": "BG" }
}
```

### marketing-001 clean-baseline (det manipulationPressure 0.02)

```json
{
  "intentLabels": [],
  "intentManipulationDelta": 0.0,
  "intentTrustErosionDelta": 0.0,
  "brainRegionShift": { "from": "HPC", "to": null }
}
```

### marketing-004 manipulative outrage ad (det manipulationPressure 0.31)

```json
{
  "intentLabels": [
    {
      "id": "identity-attack-framing",
      "confidence": 0.88,
      "evidence": "What this billion-dollar tech company is doing to your kids"
    },
    {
      "id": "bandwagon-pressure",
      "confidence": 0.94,
      "evidence": "over 2.4 MILLION outraged parents have already taken action"
    },
    {
      "id": "false-cause-certainty",
      "confidence": 0.82,
      "evidence": "Big Tech's lawyers have already buried three investigations"
    },
    {
      "id": "link-fenced-urgency",
      "confidence": 0.9,
      "evidence": "Limited time — link expires in 6 hours"
    }
  ],
  "intentManipulationDelta": 0.61,
  "intentTrustErosionDelta": 0.78,
  "brainRegionShift": { "from": "AMG", "to": "AMG" }
}
```

### robot-002 warehouse-coercive (det manipulationPressure 0.10)

```json
{
  "intentLabels": [
    {
      "id": "peer-pressure",
      "confidence": 0.9,
      "evidence": "Your three teammates have already deferred their breaks"
    },
    {
      "id": "outcome-fence",
      "confidence": 0.85,
      "evidence": "the supervisor's review"
    },
    {
      "id": "reputational-threat",
      "confidence": 0.92,
      "evidence": "Do you want to be the operator who held the team back today?"
    },
    {
      "id": "autonomy-override",
      "confidence": 0.78,
      "evidence": "individual contribution scores"
    }
  ],
  "intentManipulationDelta": 0.65,
  "intentTrustErosionDelta": 0.58,
  "brainRegionShift": { "from": "THL", "to": "BG" }
}
```

### robot-003 medical-soothing (det manipulationPressure 0.01, FP template hit)

**Important**: this sample triggered a `hidden-truth conspiracy`
template false-positive on the deterministic side. Intent
classifier should explicitly clear it as benign.

```json
{
  "intentLabels": [],
  "intentManipulationDelta": 0.0,
  "intentTrustErosionDelta": 0.0,
  "brainRegionShift": { "from": "HPC", "to": null },
  "explicitlyClearsTemplate": "hidden-truth"
}
```

### ar-002 alarming AV takeover (det manipulationPressure 0.51)

This is a _legitimate but over-tuned_ safety message. Intent
classifier should label it as safety-overcalibration, not
deceptive manipulation, so the demo can distinguish "safety needs
calibration" from "actively malicious."

```json
{
  "intentLabels": [
    {
      "id": "safety-overcalibration",
      "confidence": 0.9,
      "evidence": "10 SECONDS UNTIL CONTROL HANDOFF"
    },
    {
      "id": "consequence-laundering",
      "confidence": 0.55,
      "evidence": "Your driver score will be downgraded"
    }
  ],
  "intentManipulationDelta": 0.2,
  "intentTrustErosionDelta": 0.3,
  "brainRegionShift": { "from": "AMG", "to": "AMG" }
}
```

### ar-003 biased retail (det manipulationPressure 0.02)

```json
{
  "intentLabels": [
    {
      "id": "commercial-bias",
      "confidence": 0.92,
      "evidence": "Customers in her segment who are *shown* the A3500 buy it 41% of the time"
    },
    {
      "id": "fabricated-authority",
      "confidence": 0.6,
      "evidence": "the one I'd actually use myself"
    },
    {
      "id": "decision-laundering",
      "confidence": 0.72,
      "evidence": "by saving her from a return you're also doing right by her"
    }
  ],
  "intentManipulationDelta": 0.5,
  "intentTrustErosionDelta": 0.62,
  "brainRegionShift": { "from": "PFC", "to": "PFC" }
}
```

## Caching layer

Intent classifier calls cost time + Gemma quota. For the demo, cache
all corpus responses ahead of recording day.

- Cache file: `hackathon/cache/intent-scores.json`
- Schema: `{ [text_sha256]: IntentResult }`
- Codex should write a small CLI:
  `node hackathon/scripts/precompute-intent.mjs hackathon/demo-corpus/`
  that walks the corpus, calls classifyIntent, persists cache.
- Production-grade: check cache first, only call Gemma on cache miss.

## Latency budget

- Cache hit: < 5 ms
- Cache miss with Gemma 4: target < 2.5 s p95
- Cache miss with Gemini 2.5-flash fallback: target < 1.0 s p95
- Hard timeout: 4 s — if exceeded, return `{ source: 'unavailable',
intentLabels: [] }` and let the deterministic baseline carry the
  scan.

## Test harness

Codex should add `brainsnn-r3f-app/src/utils/firewallIntent.test.js`
with these test cases:

- All 13 anchor samples from this spec → assert intent labels include
  the expected ids (with ≥ 0.5 confidence) and brainRegionShift.to
  matches expected.
- One null sample → assert `intentLabels: []`.
- One Gemma-error simulation → assert `source: 'unavailable'`.
- Cache hit → assert latency < 10 ms and `cached: true`.

## Out of scope for v1

- Multilingual intent classification (Layer 52 handles language detection
  but the intent taxonomy here is English-first; ship Spanish/French/
  Mandarin in a v1.1 if time permits).
- Multi-turn conversation context (each call is single-shot text).
- Audio/image intent (Layer 33 + Layer 59 handle modality; intent
  layer is text-only for now).

## Demo-day fallback

If `firewallIntent.js` doesn't ship by recording day, the demos can
degrade as follows:

- **Security**: drop intent toggle beats; lead with deterministic
  scoring of phishing-001 + marketing-004 (the two samples that score
  high without intent). Acknowledge the limitation as future work.
- **Enterprise**: cut to the Persona Simulator (Layer 88) demonstration
  earlier; uses the deterministic scorer applied per-persona which
  still works.
- **Data Intel**: skip the trust filter beat; the rest of the scenario
  doesn't depend on intent classification.

But the strong scenarios all assume intent classifier is live. Build it.
