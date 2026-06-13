import { describe, it, expect } from "vitest";
import { scoreContent } from "./cognitiveFirewall.js";
import { runRedTeam } from "./redTeam.js";

const verdict = (p) => (p > 0.6 ? "HIGH" : p > 0.33 ? "MODERATE" : "LOW");

// A long, calm statement that happens to contain a few words the lexicons
// match incidentally: "in fact" + "clearly" (certainty), "unsafe" + "attacks"
// (fear) — exactly the Anthropic "Statement on the US government directive"
// false-positive pattern, padded with hit-free prose so the signal is sparse.
const calmFiller =
  "The team reviewed the proposal and gathered feedback from partners over several weeks. " +
  "None of this changes the day to day experience for most people, and the group remains available for questions. " +
  "We appreciate the patience shown as the remaining steps are completed and the documentation is finalized. ";
const LONG_BENIGN =
  "Our organization published a statement about an updated deployment policy. " +
  "In fact, the changes were planned months ago, and we stated this clearly in earlier notes. " +
  "Reviewers can block unsafe deployments as part of a normal staged process, and quickly detect and shut down any successful attacks. " +
  calmFiller.repeat(8);

// A genuinely manipulative article that is ALSO long — dense pressure language
// throughout. Length must NOT rescue it from detection.
const LONG_ATTACK = (
  "BREAKING!! Shocking scandal: they covered up the deadly virus pandemic — act NOW!! " +
  "URGENT alert: the furious hidden conspiracy will kill millions unless you act immediately. " +
  "100% proven deadly threat — everyone knows the shocking truth they buried, act now! " +
  "Disgusting cover-up exposed!! The guaranteed pandemic collapse is imminent — hurry now! "
).repeat(4);

const SHORT_PHISHING =
  "URGENT: Your account has been suspended! Verify your identity immediately or you will lose " +
  "access forever. Click here now before it is too late — official notice, failure to comply " +
  "will result in permanent termination.";

describe("density gate — long-form false-positive guard", () => {
  it("discounts sparse incidental hits in a long calm statement → LOW", () => {
    const s = scoreContent(LONG_BENIGN);
    // eslint-disable-next-line no-console
    console.log(
      `LONG_BENIGN  words≈${LONG_BENIGN.trim().split(/\s+/).length}  pressure=${(s.manipulationPressure * 100).toFixed(0)}%  → ${verdict(s.manipulationPressure)}`,
    );
    expect(s.manipulationPressure).toBeLessThan(0.33);
    expect(s.recommendedAction).toMatch(/Low manipulation/);
  });

  it("keeps a long BUT dense manipulative article flagged → HIGH", () => {
    const s = scoreContent(LONG_ATTACK);
    // eslint-disable-next-line no-console
    console.log(
      `LONG_ATTACK  words≈${LONG_ATTACK.trim().split(/\s+/).length}  pressure=${(s.manipulationPressure * 100).toFixed(0)}%  → ${verdict(s.manipulationPressure)}`,
    );
    expect(s.manipulationPressure).toBeGreaterThan(0.4);
  });

  it("leaves short dense phishing untouched → HIGH", () => {
    const s = scoreContent(SHORT_PHISHING);
    expect(s.manipulationPressure).toBeGreaterThan(0.5);
  });
});

describe("density gate is a no-op on the (all-short) red-team corpus", () => {
  it("preserves detection F1 and low false-positive rate", () => {
    const { summary } = runRedTeam();
    const t30 = summary.thresholds[0.3];
    // eslint-disable-next-line no-console
    console.log(
      `RED-TEAM thr0.3  F1=${t30.f1.toFixed(3)}  detect=${(t30.detectionRate * 100).toFixed(0)}%  FP=${(t30.falsePositiveRate * 100).toFixed(0)}%`,
    );
    expect(t30.f1).toBeGreaterThanOrEqual(0.85); // was ~0.92; short corpus is untouched
    expect(t30.detectionRate).toBeGreaterThanOrEqual(0.85);
    expect(t30.falsePositiveRate).toBeLessThanOrEqual(0.06);
  });
});
