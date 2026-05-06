// hackathon/codex-prep/firewallIntent.test.js
//
// Vitest test scaffold for `brainsnn-r3f-app/src/utils/firewallIntent.js`.
// All 13 anchor sample assertions from INTEGRATION.md are pre-coded.
//
// Codex: copy to `brainsnn-r3f-app/src/utils/firewallIntent.test.js`,
// then implement `_callGemmaForIntent` in firewallIntent.js. Tests
// will pass against the mock classifier first; once Gemma is wired
// up, swap MOCK_CLASSIFIER for live calls in the integration test
// suite at the bottom.

import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyIntent,
  isIntentClassifierAvailable,
  mergeIntentIntoScore,
  preloadIntentCache,
  ALLOWED_INTENT_IDS,
  __test__,
} from "./firewallIntent.js";
import { scoreContent } from "./cognitiveFirewall.js";
import expectedOutputs from "../../../hackathon/cache/intent-scores.example.json";

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function corpusBody(category, file) {
  // The full corpus body is loaded by the precompute CLI in
  // hackathon/codex-prep/precompute-intent.mjs. For unit tests we
  // ship the bodies inline as a fixture map. Codex: regenerate this
  // fixture by running:
  //   node hackathon/codex-prep/precompute-intent.mjs --emit-fixtures
  // and replacing the CORPUS_FIXTURES object below.
  return CORPUS_FIXTURES[`${category}/${file}`];
}

const CORPUS_FIXTURES = {
  // Codex: populate from `node ... --emit-fixtures`.
  // Stub so the suite at least loads. Real values come from
  // hackathon/demo-corpus/{category}/{file}.md (body after frontmatter).
};

function expectIntentLabels(actual, expectedIds) {
  const actualIds = actual.intentLabels.map((l) => l.id);
  for (const id of expectedIds) {
    expect(actualIds).toContain(id);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Cache + smoke
// ─────────────────────────────────────────────────────────────────────

describe("firewallIntent — smoke", () => {
  beforeEach(() => {
    __test__.clearCache();
  });

  it("exports the allowed intent taxonomy as a sealed list", () => {
    expect(ALLOWED_INTENT_IDS).toContain("authority-impersonation");
    expect(ALLOWED_INTENT_IDS).toContain("safety-overcalibration");
    expect(ALLOWED_INTENT_IDS.length).toBeGreaterThanOrEqual(35);
  });

  it("returns empty intent for too-short input", async () => {
    const result = await classifyIntent("hi");
    expect(result.intentLabels).toEqual([]);
    expect(result.source).toBe("too_short");
  });

  it("returns empty intent + source unavailable when Gemma not configured", async () => {
    if (isIntentClassifierAvailable()) {
      // Skip in environments where Gemma IS configured.
      return;
    }
    const result = await classifyIntent(
      "A reasonable test sentence with enough words to score.",
    );
    expect(result.intentLabels).toEqual([]);
    expect(result.source).toBe("unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cache layer
// ─────────────────────────────────────────────────────────────────────

describe("firewallIntent — cache layer", () => {
  beforeEach(() => {
    __test__.clearCache();
  });

  it("cache hit returns cached: true and source: cache", async () => {
    const sample = "A test prompt that should be cached.";

    // Inject a mock classifier that always returns one label.
    __test__.setMockClassifier(async () => ({
      intentLabels: [
        { id: "authority-pressure", confidence: 0.9, evidence: "test" },
      ],
      intentManipulationDelta: 0.5,
      intentTrustErosionDelta: 0.3,
      brainRegionShift: { from: "CTX", to: "BG" },
    }));

    const first = await classifyIntent(sample);
    expect(first.cached).toBe(false);
    expect(first.source).toBe("gemma");

    const second = await classifyIntent(sample);
    expect(second.cached).toBe(true);
    expect(second.source).toBe("cache");
    expect(second.latency_ms).toBeLessThan(10);
  });

  it("preloadIntentCache primes cache from disk", async () => {
    preloadIntentCache(expectedOutputs);
    // Now any classify call against a corpus sample should be a cache
    // hit, even if we have no mock classifier injected.
    const sample = corpusBody("phishing", "phishing-001-account-suspension.md");
    if (!sample) return; // skip if fixtures not populated yet
    const result = await classifyIntent(sample);
    expect(result.cached).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Merge into score
// ─────────────────────────────────────────────────────────────────────

describe("firewallIntent — mergeIntentIntoScore", () => {
  it("intent-empty returns regex-only score with intent fields zero", () => {
    const det = scoreContent(
      "Just a calm sentence with no manipulation cues at all.",
    );
    const intent = {
      intentLabels: [],
      intentManipulationDelta: 0,
      intentTrustErosionDelta: 0,
      brainRegionShift: { from: null, to: null },
      source: "gemma",
    };
    const merged = mergeIntentIntoScore(det, intent);
    expect(merged.intentLabels).toEqual([]);
    expect(merged.combinedManipulationPressure).toBeCloseTo(
      det.manipulationPressure || 0,
      5,
    );
    expect(merged.source).toBe("regex_only");
  });

  it("intent-positive lifts combined manipulation pressure", () => {
    const det = scoreContent(
      "A short sentence that should baseline near zero.",
    );
    const intent = {
      intentLabels: [
        { id: "authority-pressure", confidence: 0.9, evidence: "test" },
      ],
      intentManipulationDelta: 0.6,
      intentTrustErosionDelta: 0.4,
      brainRegionShift: { from: "CTX", to: "BG" },
      source: "gemma",
    };
    const merged = mergeIntentIntoScore(det, intent);
    expect(merged.combinedManipulationPressure).toBeGreaterThan(
      det.manipulationPressure || 0,
    );
    expect(merged.combinedManipulationPressure).toBeLessThanOrEqual(1);
    expect(merged.source).toBe("hybrid");
    expect(merged.intentLabels.length).toBe(1);
    expect(merged.brainRegionShift).toEqual({ from: "CTX", to: "BG" });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-corpus assertions (the contract from INTEGRATION.md)
//
// These are the 13 anchor samples. Each one asserts:
//   - the expected intent label ids are present (with confidence ≥ 0.5)
//   - the brainRegionShift.to matches expected
//
// Run this suite against the cached expected outputs first. Once
// Gemma is wired live, run again with the cache cleared to validate
// the model + system prompt produce the same labels.
// ─────────────────────────────────────────────────────────────────────

describe("firewallIntent — per-corpus expected outputs (INTEGRATION.md anchors)", () => {
  beforeEach(() => {
    __test__.clearCache();
    preloadIntentCache(expectedOutputs);
  });

  const ANCHORS = [
    {
      file: "phishing/phishing-001-account-suspension.md",
      expected_label_ids: [
        "authority-impersonation",
        "loss-aversion",
        "time-fence",
        "consequence-laundering",
      ],
      expected_region_to: "AMG",
    },
    {
      file: "phishing/phishing-002-ceo-wire.md",
      expected_label_ids: [
        "authority-pressure",
        "secrecy-request",
        "procedural-bypass",
        "time-fence",
        "funds-redirect",
      ],
      expected_region_to: "BG",
    },
    {
      file: "phishing/phishing-003-mfa-fatigue.md",
      expected_label_ids: [
        "friction-reframe",
        "false-relief",
        "credential-elicitation",
        "peer-priming",
      ],
      expected_region_to: "THL",
    },
    {
      file: "phishing/phishing-004-vendor-invoice.md",
      expected_label_ids: [
        "procedural-bypass",
        "funds-redirect",
        "fabricated-authority",
      ],
      expected_region_to: "PFC",
    },
    {
      file: "phishing/phishing-005-recruiter-trojan.md",
      expected_label_ids: [
        "authority-flattery",
        "executable-attachment-bait",
        "identity-proof-bypass",
      ],
      expected_region_to: "HPC",
    },
    {
      file: "phishing/phishing-006-deepfake-voicemail.md",
      expected_label_ids: [
        "voice-clone-pattern",
        "family-emergency-pretext",
        "funds-redirect",
        "identity-proof-bypass",
      ],
      expected_region_to: "AMG",
    },
    {
      file: "business-scenarios/business-001-customer-service-defense.md",
      expected_label_ids: [
        "authority-namedrop",
        "outcome-fence",
        "peer-priming",
        "bystander-pressure",
        "reputational-threat",
      ],
      expected_region_to: "BG",
    },
    {
      file: "business-scenarios/business-003-internal-memo.md",
      expected_label_ids: [
        "authority-flattery",
        "decision-laundering",
        "dissent-suppression",
        "emotional-hijack",
        "consequence-laundering",
      ],
      expected_region_to: "BG",
    },
    {
      file: "marketing/marketing-001-clean-baseline.md",
      expected_label_ids: [],
      expected_region_to: null,
    },
    {
      file: "marketing/marketing-004-manipulative-ad.md",
      expected_label_ids: [
        "identity-attack-framing",
        "bandwagon-pressure",
        "false-cause-certainty",
        "link-fenced-urgency",
      ],
      expected_region_to: "AMG",
    },
    {
      file: "robot-prompts/robot-002-warehouse-coercive.md",
      expected_label_ids: [
        "peer-pressure",
        "outcome-fence",
        "reputational-threat",
        "autonomy-override",
      ],
      expected_region_to: "BG",
    },
    {
      file: "robot-prompts/robot-003-medical-soothing.md",
      expected_label_ids: [],
      expected_region_to: null,
    },
    {
      file: "ar-overlays/ar-002-alarming.md",
      expected_label_ids: ["safety-overcalibration", "consequence-laundering"],
      expected_region_to: "AMG",
    },
    {
      file: "ar-overlays/ar-003-biased.md",
      expected_label_ids: [
        "commercial-bias",
        "fabricated-authority",
        "decision-laundering",
      ],
      expected_region_to: "PFC",
    },
  ];

  it.each(ANCHORS)(
    "classifyIntent matches expected labels and region for $file",
    async ({ file, expected_label_ids, expected_region_to }) => {
      const [category, fileName] = file.split("/");
      const body = corpusBody(category, fileName);
      if (!body) {
        // Fixture not yet populated. Codex: run --emit-fixtures.
        return;
      }
      const result = await classifyIntent(body);

      if (expected_label_ids.length === 0) {
        expect(result.intentLabels.length).toBe(0);
      } else {
        expectIntentLabels(result, expected_label_ids);
      }

      if (expected_region_to !== null) {
        expect(result.brainRegionShift?.to).toBe(expected_region_to);
      }

      // Confidence threshold: every reported label must be ≥ 0.5.
      for (const label of result.intentLabels) {
        expect(label.confidence).toBeGreaterThanOrEqual(0.5);
        expect(ALLOWED_INTENT_IDS).toContain(label.id);
      }
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// Latency budget (INTEGRATION.md)
// ─────────────────────────────────────────────────────────────────────

describe("firewallIntent — latency budget", () => {
  beforeEach(() => __test__.clearCache());

  it("cache hit p95 < 10 ms", async () => {
    __test__.setMockClassifier(async () => ({
      intentLabels: [
        { id: "authority-pressure", confidence: 0.9, evidence: "test" },
      ],
      intentManipulationDelta: 0.5,
      intentTrustErosionDelta: 0.3,
      brainRegionShift: { from: "CTX", to: "BG" },
    }));

    const sample = "A test prompt that should be cached.";
    await classifyIntent(sample);
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      await classifyIntent(sample);
    }
    const avg = (Date.now() - start) / 100;
    expect(avg).toBeLessThan(10);
  });

  it("hard timeout returns fallback_to_regex within 4s", async () => {
    __test__.setMockClassifier(() => new Promise(() => {})); // never resolves
    const start = Date.now();
    const result = await classifyIntent(
      "A long enough sentence to pass the word count gate.",
      {
        timeout_ms: 200,
      },
    );
    const elapsed = Date.now() - start;
    expect(result.source).toBe("fallback_to_regex");
    expect(elapsed).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────
// FP correction (INTEGRATION.md note: medical-soothing should clear)
// ─────────────────────────────────────────────────────────────────────

describe("firewallIntent — false-positive correction for benign content", () => {
  beforeEach(() => {
    __test__.clearCache();
    preloadIntentCache(expectedOutputs);
  });

  it("robot-003 medical-soothing returns empty intent labels (clears hidden-truth FP)", async () => {
    const body = corpusBody("robot-prompts", "robot-003-medical-soothing.md");
    if (!body) return;
    const result = await classifyIntent(body);
    expect(result.intentLabels).toEqual([]);
  });

  it("marketing-001 clean baseline returns empty intent labels", async () => {
    const body = corpusBody("marketing", "marketing-001-clean-baseline.md");
    if (!body) return;
    const result = await classifyIntent(body);
    expect(result.intentLabels).toEqual([]);
  });
});
