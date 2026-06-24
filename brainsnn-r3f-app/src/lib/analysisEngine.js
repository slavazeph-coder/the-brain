import { clampScore, titleFromContent } from './formatters.js';
import { splitIntoSegments } from './validation.js';

const TRUST_TERMS = /\b(proof|because|data|tested|customer|source|case study|measured|transparent|specific|example|evidence|verified|clear)\b/gi;
const URGENCY_TERMS = /\b(now|today|deadline|limited|last chance|before it'?s too late|only|urgent|immediately|act fast)\b/gi;
const FEAR_TERMS = /\b(risk|danger|lose|fail|threat|mistake|panic|scared|crisis|damage|betray|hidden truth)\b/gi;
const ANGER_TERMS = /\b(outrage|furious|disgusting|betrayed|enemy|fight|rigged|corrupt|they don't want)\b/gi;
const EMPATHY_TERMS = /\b(you|your|together|help|support|understand|simple|clear|feel|people|customers|team)\b/gi;
const CURIOSITY_TERMS = /\b(what if|why|how|secret|surprising|learn|discover|before|after|mistake|lesson)\b/gi;
const VAGUE_TERMS = /\b(game[- ]changer|revolutionary|world[- ]class|best|ultimate|massive|unprecedented|guaranteed|viral|explode)\b/gi;

function countMatches(text, regex) {
  return (String(text).match(regex) || []).length;
}

function stableId(content) {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `scan-${(hash >>> 0).toString(36)}-${Date.now().toString(36)}`;
}

function scoreSegment(segment, index) {
  const trust = countMatches(segment, TRUST_TERMS);
  const urgency = countMatches(segment, URGENCY_TERMS);
  const fear = countMatches(segment, FEAR_TERMS);
  const anger = countMatches(segment, ANGER_TERMS);
  const empathy = countMatches(segment, EMPATHY_TERMS);
  const curiosity = countMatches(segment, CURIOSITY_TERMS);
  const vague = countMatches(segment, VAGUE_TERMS);
  const score = clampScore(48 + curiosity * 13 + trust * 8 + empathy * 4 + urgency * 5 - vague * 10 - fear * 5 - anger * 8 + (index === 0 ? 8 : 0), 50);
  let category = 'Strong attention signal';
  if (trust > 0) category = 'Trust builder';
  if (vague > 0) category = 'Vague claim';
  if (urgency > 0 && trust === 0) category = 'Forced urgency';
  if (fear > 0) category = 'Fear pressure';
  if (empathy > 1 && fear === 0) category = 'Warm/empathic language';
  return {
    id: `segment-${index + 1}`,
    text: segment,
    score,
    category,
    reason: category === 'Trust builder'
      ? 'Specific or proof-oriented language helps credibility.'
      : category === 'Forced urgency'
        ? 'Pressure language appears without enough proof nearby.'
        : category === 'Vague claim'
          ? 'Broad claims need evidence or concrete detail.'
          : category === 'Fear pressure'
            ? 'Fear language can create attention while increasing trust risk.'
            : 'This line creates a clearer attention signal than the surrounding copy.',
  };
}

export function analyzeContentLocally({ content, contentType = 'text', forceFallback = true } = {}) {
  const rawContent = String(content || '').trim();
  const segments = splitIntoSegments(rawContent);
  const trustHits = countMatches(rawContent, TRUST_TERMS);
  const urgencyHits = countMatches(rawContent, URGENCY_TERMS);
  const fearHits = countMatches(rawContent, FEAR_TERMS);
  const angerHits = countMatches(rawContent, ANGER_TERMS);
  const empathyHits = countMatches(rawContent, EMPATHY_TERMS);
  const curiosityHits = countMatches(rawContent, CURIOSITY_TERMS);
  const vagueHits = countMatches(rawContent, VAGUE_TERMS);
  const wordCount = Math.max(1, rawContent.split(/\s+/).filter(Boolean).length);

  const trust = clampScore(48 + trustHits * 13 + empathyHits * 3 - vagueHits * 8 - fearHits * 4 - angerHits * 7, 50);
  const urgency = clampScore(28 + urgencyHits * 18 + fearHits * 7 + curiosityHits * 3, 34);
  const empathy = clampScore(38 + empathyHits * 8 - angerHits * 5, 42);
  const fear = clampScore(12 + fearHits * 18 + urgencyHits * 3, 18);
  const anger = clampScore(8 + angerHits * 22 + fearHits * 4, 10);
  const excitement = clampScore(38 + curiosityHits * 13 + urgencyHits * 5 + Math.min(18, wordCount / 20), 44);
  const viralScore = clampScore((excitement * 0.5) + (urgency * 0.25) + (empathy * 0.15) + (trust * 0.1), 50);
  const gaugeGapScore = clampScore((fear * 0.27) + (anger * 0.27) + (urgency * 0.28) + (100 - trust) * 0.18, 40);
  const confidence = clampScore(54 + Math.min(20, wordCount / 6) + Math.min(12, segments.length * 2) - (wordCount < 18 ? 12 : 0), 60);
  const riskRating = gaugeGapScore >= 70 ? 'High trust risk' : gaugeGapScore >= 48 ? 'Moderate trust risk' : 'Low trust risk';
  const title = titleFromContent(rawContent);

  const heatmap = segments.map(scoreSegment);
  const attentionCurve = heatmap.length
    ? heatmap.map((segment, index) => ({
      label: index === 0 ? 'Opening' : index === heatmap.length - 1 ? 'Close' : `Beat ${index + 1}`,
      value: segment.score,
      reason: segment.category,
    }))
    : [{ label: 'Opening', value: viralScore, reason: 'Estimated attention signal' }];

  const summary = riskRating === 'High trust risk'
    ? 'This is likely to create attention, but pressure and unsupported claims may weaken credibility.'
    : viralScore >= 72
      ? 'This has a clear hook and enough audience relevance to earn attention.'
      : 'This is directionally clear, but it needs a stronger opening and more concrete proof.';

  return {
    id: stableId(rawContent),
    timestamp: new Date().toISOString(),
    title,
    rawContent,
    contentType,
    metrics: {
      trust,
      urgency,
      empathy,
      fear,
      anger,
      excitement,
      firingRate: clampScore(18 + viralScore * 0.72),
      plasticity: clampScore(26 + empathy * 0.35 + trust * 0.25),
      wavesDamping: Number((0.18 + (100 - urgency) / 420).toFixed(2)),
      wavesFrequency: Number((0.72 + viralScore / 165).toFixed(2)),
    },
    attentionCurve,
    riskRating,
    riskDescription: gaugeGapScore >= 70
      ? 'High pressure or emotional charge appears before enough support.'
      : gaugeGapScore >= 48
        ? 'Some pressure language may need proof or softening.'
        : 'The message is unlikely to feel manipulative in its current shape.',
    viralScore,
    gaugeGapScore,
    summary,
    insights: [
      {
        label: 'What works',
        text: excitement >= 65 ? 'The opening has clear tension and gives the audience a reason to keep reading.' : 'The message has a usable core, but the first sentence needs more contrast or specificity.',
      },
      {
        label: 'What hurts',
        text: gaugeGapScore >= 60 ? 'Pressure language is doing too much of the work before trust has been earned.' : 'The main risk is clarity: make the proof and desired action easier to see.',
      },
      {
        label: 'Best next move',
        text: trust < 58 ? 'Add concrete proof, a customer example, or a measurable reason to believe the promise.' : 'Keep the strongest opening and tighten the final action.',
      },
    ],
    recommendations: [
      {
        id: 'build-trust',
        title: 'Build trust earlier',
        goal: 'Build trust',
        rationale: 'Credibility improves when a specific proof point appears before the ask.',
        rewriteHint: 'Add one concrete example, source, customer result, or constraint.',
      },
      {
        id: 'clarify-promise',
        title: 'Make the promise sharper',
        goal: 'Make it clearer',
        rationale: 'Specific promises are easier to believe and remember than broad claims.',
        rewriteHint: 'Replace vague adjectives with a measurable outcome or audience-specific detail.',
      },
      {
        id: 'reduce-pressure',
        title: 'Reduce pressure',
        goal: 'Reduce manipulation',
        rationale: 'Urgency works better when the reader sees a real reason for it.',
        rewriteHint: 'Replace forced scarcity with a calm reason to act now.',
      },
    ],
    payloadType: 'content_response_estimate',
    confidence,
    crumbModelStats: {
      model: forceFallback ? 'brainsnn-local-demo-v1' : 'brainsnn-signal-map-v1',
      latencyMs: 0,
      tokensEstimated: wordCount,
      note: 'AI-estimated content response signals. Not medical, biometric, or neurological measurement.',
    },
    isFallback: Boolean(forceFallback),
    heatmap,
  };
}
