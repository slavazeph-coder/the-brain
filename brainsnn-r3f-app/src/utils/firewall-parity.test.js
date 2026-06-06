import { describe, it, expect } from "vitest";
import { scoreContent } from "./cognitiveFirewall.js";
import { scoreServer } from "../../viral/api-score.js";

// The firewall scorer is intentionally duplicated: the client copy
// (src/utils/cognitiveFirewall.js) powers the on-page scan, and the server copy
// (viral/api-score.js) powers the public POST /api/score endpoint + SSE stream.
// They MUST agree — a drift once shipped "High 87%" on the page while the API
// said "Low 18%". This test fails the moment the English rulesets diverge.
const SAMPLES = [
  "URGENT: unauthorized login detected on your account. Immediate action required. Click here now to verify your identity or your account will be terminated within the hour.",
  "BREAKING: Shocking betrayal! Everyone is furious. This is the most disgusting scandal they covered up — and you won't believe what they did next.",
  "ACT FAST — last chance! This limited-time offer ends in minutes. Don't miss it. Guaranteed results. 100% proven. Everyone is switching — clearly you should too.",
  "Take a slow breath. Notice the weight of your body. There is nothing you have to do right now — just this breath, and the next one, arriving gently.",
  "The quarterly report is attached. Let me know if you have any questions and we can review it together next week.",
];

const DIMS = [
  "emotionalActivation",
  "cognitiveSuppression",
  "manipulationPressure",
  "trustErosion",
];

const verdict = (a = "") =>
  a.startsWith("High") ? "high" : a.startsWith("Moderate") ? "moderate" : "low";

describe("firewall client/server parity (English)", () => {
  it("exposes the same four dimensions from both scorers", () => {
    for (const text of SAMPLES) {
      const client = scoreContent(text);
      const server = scoreServer(text);
      for (const dim of DIMS) {
        // Identical lexicons + formulas → identical numbers (allow float noise).
        expect(server[dim], `${dim} for: ${text.slice(0, 32)}…`).toBeCloseTo(
          client[dim],
          2,
        );
      }
    }
  });

  it("agrees on the verdict bucket for every sample", () => {
    for (const text of SAMPLES) {
      expect(
        verdict(scoreServer(text).recommendedAction),
        text.slice(0, 32),
      ).toBe(verdict(scoreContent(text).recommendedAction));
    }
  });
});
