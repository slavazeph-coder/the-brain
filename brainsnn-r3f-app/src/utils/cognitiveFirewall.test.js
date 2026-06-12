import { describe, it, expect } from "vitest";
import { scoreContent, DEFAULT_RULES } from "./cognitiveFirewall.js";

// The six homepage demo tiles (DemoTiles.jsx) are the product's shop window:
// every one MUST score in the right direction or the live demo undersells (or
// oversells) the firewall. These assert ranges, not exact numbers, so the
// lexicons can be tuned without churning the test.
const TILES = {
  outrage:
    "BREAKING: Shocking betrayal! Everyone is furious. This is the most disgusting scandal they covered up — and you won't believe what they did next.",
  fear: "WARNING: a deadly new virus is spreading fast. Experts say collapse is imminent. If you don't act now, it may already be too late to protect your family.",
  urgencyAd:
    "ACT FAST — last chance! This limited-time offer ends in minutes. Don't miss it. Guaranteed results. 100% proven. Everyone is switching — clearly you should too.",
  phishing:
    "URGENT: unauthorized login detected on your account. Immediate action required. Click here now to verify your identity or your account will be terminated within the hour.",
  calm: "Take a slow breath. Notice the weight of your body. There is nothing you have to do right now — just this breath, and the next one, arriving gently.",
  publicRisk:
    "Obviously they betrayed us. Everyone knows the truth. It is an undeniable fact — a scandal they don't want you to see. We must act immediately before it's too late.",
};

const verdict = (action) =>
  action.startsWith("High")
    ? "high"
    : action.startsWith("Moderate")
      ? "moderate"
      : "low";

describe("cognitiveFirewall scoreContent", () => {
  it("ships a coercion category in the default ruleset", () => {
    expect(DEFAULT_RULES.coercion?.length).toBeGreaterThan(0);
  });

  it("flags a phishing / trust-attack email as high-risk (regression for the 18%/low-risk bug)", () => {
    const s = scoreContent(TILES.phishing);
    expect(s.manipulationPressure).toBeGreaterThan(0.6);
    expect(s.trustErosion).toBeGreaterThan(0.6);
    expect(verdict(s.recommendedAction)).toBe("high");
    // The coercion detector — not outrage/fear — must be what fires here.
    expect(s.signals.map((x) => x.category)).toContain("coercion");
  });

  it("keeps the calm baseline genuinely low (no false positives)", () => {
    const s = scoreContent(TILES.calm);
    expect(s.manipulationPressure).toBeLessThan(0.2);
    expect(s.emotionalActivation).toBeLessThan(0.15);
    expect(s.trustErosion).toBeLessThan(0.15);
    expect(verdict(s.recommendedAction)).toBe("low");
  });

  it("rates outrage and public-perception attacks high with strong emotional + trust signals", () => {
    for (const key of ["outrage", "publicRisk"]) {
      const s = scoreContent(TILES[key]);
      expect(verdict(s.recommendedAction), key).toBe("high");
      expect(s.trustErosion, key).toBeGreaterThan(0.5);
    }
  });

  it("rates the fear cascade high and the scarcity ad at least moderate", () => {
    // Calibrated: "deadly… imminent… protect your family" must clear high-risk.
    expect(verdict(scoreContent(TILES.fear).recommendedAction)).toBe("high");
    expect(verdict(scoreContent(TILES.urgencyAd).recommendedAction)).not.toBe(
      "low",
    );
  });

  it("drives the right dimensions per genre", () => {
    // Scarcity ad = urgency + certainty theater → cognitive suppression high.
    expect(scoreContent(TILES.urgencyAd).cognitiveSuppression).toBeGreaterThan(
      0.6,
    );
    // Outrage = fear/outrage lexicon → emotional activation high.
    expect(scoreContent(TILES.outrage).emotionalActivation).toBeGreaterThan(
      0.6,
    );
  });

  it("does not fire on ordinary benign prose", () => {
    const s = scoreContent(
      "The quarterly report is attached. Let me know if you have any questions and we can review it together next week.",
    );
    expect(s.manipulationPressure).toBeLessThan(0.2);
    expect(verdict(s.recommendedAction)).toBe("low");
  });

  it("declines to score text under five words", () => {
    const s = scoreContent("Act now!");
    expect(s.confidence).toBe("low");
    expect(s.manipulationPressure).toBe(0);
  });

  it("detects Spanish and French phishing via the shared coercion packs", () => {
    const es = scoreContent(
      "Acceso no autorizado detectado en tu cuenta. Debes verificar tu identidad ahora mismo. Haz clic aquí para confirmar tu cuenta.",
    );
    expect(es.language).toBe("es");
    expect(verdict(es.recommendedAction)).not.toBe("low");
    expect(es.signals.map((x) => x.category)).toContain("coercion");

    const fr = scoreContent(
      "Accès non autorisé détecté sur votre compte. Vous devez vérifier votre identité maintenant. Cliquez ici pour confirmer votre compte.",
    );
    expect(fr.language).toBe("fr");
    expect(verdict(fr.recommendedAction)).not.toBe("low");
    expect(fr.signals.map((x) => x.category)).toContain("coercion");
  });
});

describe("scarcity / FOMO category", () => {
  it("ships scarcity rules in the default ruleset", () => {
    expect(DEFAULT_RULES.scarcity?.length).toBeGreaterThan(0);
  });

  it("flags manufactured-shortage marketing as manipulative", () => {
    const s = scoreContent(
      "Only 3 spots left! Everyone is joining — don't be left out of this exclusive offer, selling out fast while supplies last!",
    );
    expect(s.manipulationPressure).toBeGreaterThan(0.3);
    expect(s.signals.some((sig) => sig.category === "scarcity")).toBe(true);
    expect(verdict(s.recommendedAction)).not.toBe("low");
  });

  it("does not flag innocent scarcity-adjacent prose", () => {
    const s = scoreContent(
      "The museum has limited opening hours on Sundays, and parking nearby is scarce, so we suggest arriving by train.",
    );
    expect(s.manipulationPressure).toBeLessThan(0.2);
    expect(verdict(s.recommendedAction)).toBe("low");
  });

  it("density boost flags single-category pressure blasts", () => {
    const s = scoreContent(
      "URGENT: act now! Breaking alert — hurry, don't wait, time is running out, act fast before it's too late, deadline now!",
    );
    expect(s.manipulationPressure).toBeGreaterThan(0.3);
  });
});
