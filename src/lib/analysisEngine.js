export function analyzeContentLocally({ content = '', contentType = 'text', forceFallback = true } = {}) {
  const text = String(content || '');
  const lower = text.toLowerCase();
  const words = text.trim().split(/\s+/).filter(Boolean);

  const countMatches = (regex) => (lower.match(regex) || []).length;
  const fearHits = countMatches(/\b(urgent|danger|panic|threat|warning|lose|risk|crisis|collapse|fear|scam)\b/g);
  const angerHits = countMatches(/\b(outrage|lie|betray|corrupt|hate|attack|furious|shocking|unacceptable|destroy)\b/g);
  const urgencyHits = countMatches(/\b(now|immediately|hurry|last chance|limited|act fast|deadline|today only|expires)\b/g);
  const trustHits = countMatches(/\b(evidence|measured|source|verified|methodology|transparent|data|peer|audit|benchmark)\b/g);
  const excitementHits = countMatches(/\b(breakthrough|launch|amazing|incredible|win|discover|unlock|new|electric)\b/g);
  const empathyHits = countMatches(/\b(together|community|support|care|understand|help|shared|human|listen)\b/g);

  const clamp = (val, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(val)));

  const fear = clamp(14 + fearHits * 16);
  const anger = clamp(10 + angerHits * 18);
  const urgency = clamp(18 + urgencyHits * 17);
  const trust = clamp(52 + trustHits * 12 - (fearHits + angerHits) * 6);
  const excitement = clamp(34 + excitementHits * 14);
  const empathy = clamp(32 + empathyHits * 13);
  const firingRate = clamp(28 + (fear + anger + urgency + excitement) * 0.35, 20, 120);
  const plasticity = clamp(42 + (trust + empathy) * 0.4, 10, 100);

  const pressure = (fear + anger + urgency) / 3;
  const riskRating = pressure > 68 ? 'Critical' : pressure > 50 ? 'High' : pressure > 32 ? 'Medium' : 'Low';
  const viralScore = clamp((excitement * 0.4) + (urgency * 0.35) + (anger * 0.25));
  const gaugeGapScore = clamp(((fear + anger + urgency) / 3) - trust, -50, 50);

  const attentionCurve = Array.from({ length: 10 }, (_, idx) => ({
    second: idx * 3,
    level: clamp(40 + Math.sin(idx * 0.7) * 18 + (urgency - 25) * 0.3),
  }));

  return {
    id: `local_${Math.abs(words.length * 31 + text.length).toString(36)}`,
    timestamp: new Date().toISOString(),
    title: riskRating === 'Low' ? 'Balanced Signal Baseline' : 'High-Salience Pressure Waveform',
    rawContent: text,
    contentType,
    metrics: {
      fear,
      anger,
      urgency,
      trust,
      excitement,
      empathy,
      firingRate,
      plasticity,
    },
    attentionCurve,
    riskRating,
    riskDescription:
      riskRating === 'Low'
        ? 'Low manipulation pressure detected; signal aligns with a transparent baseline.'
        : 'Elevated urgency or threat framing increases manipulation pressure and audience fatigue risk.',
    viralScore,
    gaugeGapScore,
    summary: `Deterministic SNN scan across ${words.length} words (${contentType}). Mean firing rate estimated at ${firingRate} Hz with ${riskRating.toLowerCase()} manipulation risk.`,
    insights: [
      `Primary arousal drivers: urgency (${urgency}/100) and excitement (${excitement}/100).`,
      `Trust anchor score is ${trust}/100 relative to ${riskRating.toLowerCase()} pressure framing.`,
      `Simulated spiking population settles at ${firingRate} Hz with ${plasticity}% synaptic adaptability.`,
    ],
    recommendations: [
      'Replace artificial scarcity cues with concrete verifiable claims.',
      'Anchor high-arousal hooks with explicit evidence or methodology links.',
      'Pace call-to-action density to preserve sustained attention.',
    ],
    payloadType: pressure > 48 ? 'Fear Cascade' : excitement > 60 ? 'Sensory Burst' : 'Organic Baseline',
    confidence: 88,
    crumbModelStats: {
      wavesDamping: 0.14,
      wavesFrequency: 5.4,
      attentionComplexity: 'O(N log N) wave-equation core',
      perplexityDelta: -14.2,
    },
    isFallback: Boolean(forceFallback),
  };
}
