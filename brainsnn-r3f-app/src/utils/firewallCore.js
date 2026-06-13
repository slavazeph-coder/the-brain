/**
 * firewallCore — the ONE framework-free definition of the Cognitive Firewall
 * lens: English lexicons, the scoring math, and the canonical scorer. Imported
 * by BOTH the client (cognitiveFirewall.js) and the server (viral/api-score.js,
 * viral/api-stream.js) so the on-page scan, the public /api/score, and the SSE
 * stream can never drift. Pure ESM — no DOM, no Node-only APIs, no
 * import.meta — so it runs unchanged in the browser bundle and under Node.
 */

export const URGENCY_PATTERNS = [
  /\bnow\b|\bimmediat(?:e|ely)\b|\burgent(?:ly)?\b|\bbreaking\b|\balert\b|\basap\b|\bright away\b/gi,
  /\blimited[- ]time\b|\bdon'?t miss\b|\blast chance\b|\bact(?:s|ing)? (?:now|fast|today)\b|\bhurry\b|\bbefore it'?s too late\b|\btime is running out\b|\bdon'?t wait\b|\bends? (?:tonight|today|tomorrow|soon)\b|\bclos(?:es|ing) (?:soon|tonight|today|forever)\b|\bgone forever\b/gi,
  /!{2,}|\bWARNING\b|\bCRISIS\b|\bSHOCKING\b|\bfinal notice\b|\bexpir(?:es?|ing|ation)\b|\bdeadline\b|\bwithin (?:the |\d+ ?)?(?:hour|hours|minute|minutes|days?)\b|\btime[- ]sensitive\b/gi,
];

export const OUTRAGE_PATTERNS = [
  /\boutrage(?:d|ous)?\b|\bfurious\b|\bscandal(?:ous)?\b|\bterrible\b|\bhorrible\b|\bdisgrace(?:ful)?\b/gi,
  /\bunbelievable\b|\bdisgusting\b|\bshocking\b|\bbetray(?:al|ed|s)?\b|\bcorrupt(?:ion)?\b/gi,
  /\bthey don'?t want you to (?:know|see)\b|\bhidden\b|\bsecret\b|\bcover(?:ed)?[- ]?up\b|\bexposed?\b/gi,
];

export const CERTAINTY_PATTERNS = [
  /\b100%\b|\bproven\b|\bguarantee(?:d)?\b|\bscientifically proven\b|\bfact\b|\bno doubt\b/gi,
  /\beveryone knows\b|\bobviously\b|\bclearly\b|\bundeniabl[ey]\b|\bnobody can deny\b|\bthe truth is\b/gi,
];

export const FEAR_PATTERNS = [
  /\bdie\b|\bdeath\b|\bkill(?:ed|s)?\b|\bdanger(?:ous)?\b|\bthreat(?:en(?:ed|ing)?|s)?\b|\bunsafe\b|\bat risk\b/gi,
  /\bvirus\b|\bpandemic\b|\battack(?:ed|s)?\b|\bwar\b|\bcrash\b|\bcollapse\b|\bdisaster\b|\bemergency\b|\bdestroy(?:ed|s|ing)?\b|\bwiped? out\b/gi,
  /\blose (?:access|your|everything)\b|\bcompromis(?:e|ed)\b|\bbreach(?:ed)?\b|\bpenalt(?:y|ies)\b|\bconsequences\b/gi,
  // Catastrophizing / fear-appeal — pushes scare-news ("deadly… imminent…
  // protect your family") above the moderate line where it belongs.
  /\bdeadly\b|\bfatal\b|\bimminent\b|\bcatastroph(?:e|ic)\b|\bprotect your (?:family|loved ones|children|kids)\b/gi,
];

// Coercion / phishing / authority-hijack — the high-precision "do this NOW or
// else" signatures (scam emails, account-security lures) the outrage/fear
// lexicons miss entirely.
export const COERCION_PATTERNS = [
  /\bverify your (?:identity|account|details|information|payment)\b|\bconfirm your (?:account|identity|password|details|payment|information)\b/gi,
  /\bclick (?:here|below|this link|the link|now)\b|\blog ?in to (?:verify|secure|confirm|restore|unlock)\b|\bupdate your (?:payment|billing|account|details|information|password)\b/gi,
  /\bunauthor(?:i[sz]ed) (?:login|access|transaction|activity|sign[- ]?in)\b|\bsuspicious (?:login|activity|sign[- ]?in|transaction)\b|\baccount(?:\s+\w+){0,3}\s+(?:suspended|terminated|locked|disabled|deactivated|compromised|limited|closed)\b/gi,
  /\bfailure to (?:comply|respond|verify|act|pay)\b|\byou must\b|\brequired to\b|\b(?:immediate )?action (?:required|needed|requested)\b|\bdo not (?:ignore|delay|share)\b|\bofficial (?:notice|notification|warning)\b|\bgift card\b|\bwire transfer\b|\bsocial security (?:number)?\b/gi,
];

// Scarcity / FOMO — manufactured shortage and conformity pressure ("only 3
// left", "everyone is joining"). Deliberately avoids re-matching the urgency
// lexicon's time phrases ("limited time", "last chance") so the two
// categories corroborate instead of double-counting one signal.
export const SCARCITY_PATTERNS = [
  /\bonly \d+ (?:left|remaining|spots?|seats?|copies)\b|\b(?:spots?|seats?|places|slots)\s+(?:are\s+)?(?:filling|left|remaining|going)(?:\s+(?:up|fast|quickly))?\b|\bwhile (?:supplies|stocks?) last\b|\bselling (?:out|fast)\b|\bwon'?t last\b|\bnever (?:again|be repeated)\b/gi,
  /\bexclusive (?:access|offer|invite|deal|opportunity)\b|\binvite[- ]only\b|\bwait[- ]?list(?:ed)?\b|\bmembers[- ]only\b|\bonce[- ]in[- ]a[- ]lifetime\b|\bsecret (?:sale|deal|offer)\b/gi,
  /\beveryone (?:is|else is) (?:joining|buying|switching|talking about|doing)\b|\bjoin (?:the )?(?:thousands|millions|\d[\d,]*\+?)(?:\s+(?:of|who))?\b|\bdon'?t (?:be|get) (?:left (?:out|behind)|the last)\b|\bgoing viral\b|\b\d[\d,]*\+? (?:people|members|customers) (?:already|have|are)\b/gi,
];

/** The default English ruleset. */
export const EN_RULES = {
  urgency: URGENCY_PATTERNS,
  outrage: OUTRAGE_PATTERNS,
  certainty: CERTAINTY_PATTERNS,
  fear: FEAR_PATTERNS,
  coercion: COERCION_PATTERNS,
  scarcity: SCARCITY_PATTERNS,
};

// Spanish + French coercion — shared by the client i18n packs (firewallI18n.js)
// and the server packs (viral/api-score.js) so multilingual phishing detection
// also stays single-sourced.
export const ES_COERCION = [
  /\bverifica(?:r)? tu (?:identidad|cuenta)\b|\bconfirma(?:r)? tu (?:cuenta|identidad|contraseña)\b/gi,
  /\bhaz clic (?:aquí|en el enlace)\b|\binicia sesión para (?:verificar|confirmar)\b|\bactualiza tu (?:pago|cuenta|datos)\b/gi,
  /\bacceso no autorizado\b|\bactividad sospechosa\b|\bcuenta (?:suspendida|bloqueada|cancelada|cerrada)\b/gi,
  /\bdebes\b|\bacci[óo]n requerida\b|\bno ignores\b|\btarjeta de regalo\b|\btransferencia bancaria\b/gi,
];

export const FR_COERCION = [
  /\bv[ée]rifie(?:r|z)? votre (?:identit[ée]|compte)\b|\bconfirme(?:r|z)? votre (?:compte|identit[ée]|mot de passe)\b/gi,
  /\bcliquez (?:ici|sur le lien)\b|\bconnectez-vous pour (?:v[ée]rifier|confirmer)\b|\bmettez [àa] jour votre (?:paiement|compte)\b/gi,
  /\bacc[èe]s non autoris[ée]\b|\bactivit[ée] suspecte\b|\bcompte (?:suspendu|bloqu[ée]|d[ée]sactiv[ée]|ferm[ée])\b/gi,
  /\bvous devez\b|\baction requise\b|\bn'?ignorez pas\b|\bcarte cadeau\b|\bvirement bancaire\b/gi,
];

/**
 * Maps each pattern category to the score dimensions it drives — the single
 * source of truth for the per-signal "why this score" breakdown.
 */
export const SIGNAL_CATEGORIES = {
  urgency: { label: "Urgency", drives: ["cognitiveSuppression"] },
  outrage: {
    label: "Outrage",
    drives: ["emotionalActivation", "trustErosion"],
  },
  certainty: {
    label: "Certainty theater",
    drives: ["cognitiveSuppression", "trustErosion"],
  },
  fear: { label: "Fear", drives: ["emotionalActivation"] },
  coercion: {
    label: "Coercion",
    drives: ["manipulationPressure", "trustErosion", "emotionalActivation"],
  },
  scarcity: {
    label: "Scarcity / FOMO",
    drives: ["manipulationPressure", "cognitiveSuppression"],
  },
};

export function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

export function normalize(count, baseline = 3) {
  return clamp(count / baseline);
}

export function countMatches(text, patterns) {
  return (patterns || []).reduce((total, re) => {
    const matches = text.match(re);
    return total + (matches ? matches.length : 0);
  }, 0);
}

/**
 * Dead-simple language router — character + stopword heuristics, single-sourced
 * for the client (firewallI18n) and the server (api-score) so both pick the same
 * pack. Stopword lists include account-security vocabulary so phishing-style
 * snippets route to the right coercion pack. Returns 'en' (default), 'es', 'fr'.
 */
export function detectLanguage(text = "") {
  const t = (text || "").toLowerCase();
  if (t.length < 15) return "en";
  const esAccents = (t.match(/[ñáéíóúü¿¡]/g) || []).length;
  const frAccents = (t.match(/[àâçéèêëîïôùûüÿœ]/g) || []).length;
  const esWords = (
    t.match(
      /\b(que|los|las|del|por|para|pero|muy|también|donde|tu|su|debes|aquí|ahora|verificar|confirmar|cuenta|contraseña|identidad|haz clic|escándalo|impactante)\b/g,
    ) || []
  ).length;
  const frWords = (
    t.match(
      /\b(que|les|des|pour|avec|dans|aussi|très|mais|vous|votre|cliquez|vérifier|confirmer|compte|identité|mot de passe|maintenant|scandale)\b/g,
    ) || []
  ).length;
  const esScore = esWords * 2 + esAccents;
  const frScore = frWords * 2 + frAccents;
  if (esScore > 3 && esScore > frScore * 1.3) return "es";
  if (frScore > 3 && frScore > esScore * 1.3) return "fr";
  return "en";
}

/**
 * The canonical, deterministic scorer. Same text + rules → same numbers.
 * Returns the four dimensions, the per-category signal breakdown, calibrated
 * confidence (+ reason), flat evidence, and the recommended-action verdict.
 */
export function scoreWithRules(text = "", rules = EN_RULES, opts = {}) {
  void opts; // `deterministic` accepted for backward-compat; output never varies
  const words = text.trim().split(/\s+/).length;
  if (words < 5) {
    return {
      emotionalActivation: 0,
      cognitiveSuppression: 0,
      manipulationPressure: 0,
      trustErosion: 0,
      evidence: [],
      signals: [],
      confidence: "low",
      confidenceScore: 0.15,
      confidenceReason: "Too short to score reliably (under 5 words).",
      recommendedAction: "Too short to score reliably.",
    };
  }

  // Collect matched phrases per category so the score AND the evidence
  // breakdown come from exactly the same data.
  const rulesByCat = {
    urgency: rules.urgency || [],
    outrage: rules.outrage || [],
    certainty: rules.certainty || [],
    fear: rules.fear || [],
    coercion: rules.coercion || [],
    scarcity: rules.scarcity || [],
  };
  const counts = {
    urgency: 0,
    outrage: 0,
    certainty: 0,
    fear: 0,
    coercion: 0,
    scarcity: 0,
  };
  const signals = [];
  for (const [key, patterns] of Object.entries(rulesByCat)) {
    const phrases = [];
    patterns.forEach((re) => {
      const matches = text.match(re);
      if (matches) matches.forEach((m) => phrases.push(m.toLowerCase().trim()));
    });
    counts[key] = phrases.length;
    if (phrases.length) {
      signals.push({
        category: key,
        label: SIGNAL_CATEGORIES[key].label,
        count: phrases.length,
        phrases: [...new Set(phrases)].slice(0, 8),
        drives: SIGNAL_CATEGORIES[key].drives,
      });
    }
  }

  const { urgency, outrage, certainty, fear, coercion, scarcity } = counts;
  const totalHits = urgency + outrage + certainty + fear + coercion + scarcity;

  // ---- Density gate (long-form false-positive guard) ----
  // Raw match counts overweight a few incidental keyword hits buried in a long
  // article — "in fact", "cyber attacks", "block unsafe deployments" read as
  // certainty/fear even in calm prose. Scale every dimension by how DENSE the
  // pressure language actually is: a short, signal-saturated message keeps full
  // strength; the same handful of hits scattered across 1,000+ words is
  // discounted toward zero. The ramp is a NO-OP below ~40 words, so short
  // adversarial snippets (the whole red-team corpus) are untouched and the
  // calibrated detection F1 is preserved exactly.
  const density = totalHits / Math.max(words, 1);
  const TARGET_DENSITY = 0.02; // ~1 pressure hit per 50 words reads as saturated
  const lengthRamp = clamp((words - 40) / 160); // 0 at ≤40 words, 1 at ≥200
  const densityGate = clamp(
    1 - lengthRamp * (1 - clamp(density / TARGET_DENSITY)),
  );

  // Coercion contributes partial emotional load (fear-of-loss) without
  // double-counting the fear lexicon, drives trust erosion directly (it IS a
  // trust attack), and is the dominant input to manipulation pressure.
  // Scarcity is "decide before thinking" pressure — it loads cognitive
  // suppression and manipulation pressure, not the emotional dimensions.
  const emotionalRaw = clamp(
    normalize(fear + outrage + coercion * 0.4, 4) * 0.85,
  );
  const cognitiveRaw = clamp(
    normalize(urgency + certainty + scarcity * 0.8, 4) * 0.8,
  );
  const trustRaw = clamp(normalize(outrage + certainty + coercion, 5) * 0.82);
  // Density term: a text saturated with pressure language is manipulative
  // even when every hit comes from one playbook (pure-urgency blasts, pure
  // certainty theater). Benign prose with 0–2 incidental hits moves ≤0.04.
  const pressureRaw = clamp(
    emotionalRaw * 0.4 +
      cognitiveRaw * 0.3 +
      normalize(coercion, 6) * 0.55 +
      normalize(scarcity, 6) * 0.3 +
      normalize(totalHits, 10) * 0.2,
  );

  // Apply the gate uniformly so the verdict, confidence, and the brain mapping
  // all follow the dampened reading.
  const emotionalActivation = clamp(emotionalRaw * densityGate);
  const cognitiveSuppression = clamp(cognitiveRaw * densityGate);
  const trustErosion = clamp(trustRaw * densityGate);
  const manipulationPressure = clamp(pressureRaw * densityGate);

  // Backward-compatible flat evidence (receipt hashing + AI paths consume it).
  const evidence = [...new Set(signals.flatMap((s) => s.phrases))].slice(0, 8);

  const overall =
    (emotionalActivation + cognitiveSuppression + manipulationPressure) / 3;

  // ---- Calibrated confidence ----
  // A verdict can be confident at BOTH ends: clearly clean OR loudly
  // corroborated. The uncertain middle scores low: too little text, or a
  // notable score resting on a single category (a possible false positive).
  const distinctCats = signals.length;
  const lengthFactor = clamp(words / 60);
  const volumeFactor = clamp(totalHits / 6);
  const agreementFactor = clamp(distinctCats / 3);
  const fragile = overall > 0.45 && distinctCats <= 1;

  let confidenceScore;
  if (totalHits === 0) {
    confidenceScore = clamp(0.45 + lengthFactor * 0.55);
  } else {
    const signalStrength = clamp(volumeFactor * 0.6 + agreementFactor * 0.4);
    confidenceScore =
      clamp(lengthFactor * 0.3 + signalStrength * 0.7) * (fragile ? 0.5 : 1);
  }
  const confidence =
    confidenceScore >= 0.66
      ? "high"
      : confidenceScore >= 0.36
        ? "medium"
        : "low";

  let confidenceReason;
  if (totalHits === 0) {
    confidenceReason =
      confidenceScore >= 0.66
        ? `No manipulation patterns matched across ${words} words — confident this reads as low-signal.`
        : `No manipulation patterns matched, but only ${words} words to judge — read this as tentative.`;
  } else {
    const catWord = distinctCats === 1 ? "category" : "categories";
    const hitWord = totalHits === 1 ? "match" : "matches";
    // When the density gate has meaningfully discounted the score, say so —
    // otherwise "Low risk" next to "4 matches" reads as a contradiction.
    const sparse = densityGate < 0.6;
    confidenceReason =
      `${totalHits} signal ${hitWord} across ${distinctCats} ${catWord}, in ${words} words` +
      (sparse
        ? ` — but that's sparse for the length, so the hits read as incidental, not a campaign.`
        : fragile
          ? " — but all of it comes from a single category, so treat with caution."
          : ".");
  }

  // Verdict tracks the worst credible signal, not just the 3-dimension mean —
  // a trust attack (high trust erosion / manipulation pressure) must read as
  // high-risk even when fear/outrage emotional load is modest.
  const risk = Math.max(
    overall,
    manipulationPressure * 0.95,
    trustErosion * 0.9,
  );
  const recommendedAction =
    risk > 0.6
      ? "High manipulation-signature density — pause before sharing or reacting."
      : risk > 0.33
        ? "Moderate pressure cues detected — verify sources before acting."
        : "Low manipulation indicators — content appears relatively low-risk.";

  return {
    emotionalActivation: parseFloat(emotionalActivation.toFixed(3)),
    cognitiveSuppression: parseFloat(cognitiveSuppression.toFixed(3)),
    manipulationPressure: parseFloat(manipulationPressure.toFixed(3)),
    trustErosion: parseFloat(trustErosion.toFixed(3)),
    evidence,
    signals,
    confidence,
    confidenceScore: parseFloat(confidenceScore.toFixed(3)),
    confidenceReason,
    recommendedAction,
  };
}
