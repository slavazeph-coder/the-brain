import { clampScore, titleFromContent } from './formatters.js';
import { splitIntoSegments } from './validation.js';

const TRUST_TERMS = /\b(proof|because|data|tested|customer|source|case study|measured|transparent|specific|example|evidence|verified|clear)\b/gi;
const URGENCY_TERMS = /\b(now|today|deadline|limited|last chance|before it'?s too late|only|urgent|immediately|act fast)\b/gi;
const FEAR_TERMS = /\b(risk|danger|lose|fail|threat|mistake|panic|scared|crisis|damage|betray|hidden truth)\b/gi;
const ANGER_TERMS = /\b(outrage|furious|disgusting|betrayed|enemy|fight|rigged|corrupt|they don't want)\b/gi;
const EMPATHY_TERMS = /\b(you|your|together|help|support|understand|simple|clear|feel|people|customers|team)\b/gi;
const CURIOSITY_TERMS = /\b(what if|why|how|secret|surprising|learn|discover|before|after|mistake|lesson)\b/gi;
const SPECIFIC_TERMS = /\b(\d+(?:[.,:]\d+)?%?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|seconds?|minutes?|hours?|days?|weeks?|months?)\b/gi;
const LIMITATION_TERMS = /\b(do not know|don'?t know|not yet|uncertain|directional|rather than|caveat|limitation|approximately|estimated|remaining|unchanged|treat .{0,12} as)\b/gi;
const COERCED_SPECIFIC_TERMS = /\b(?:within|in|for|after|before|next|only|just|last)\s+(?:the\s+)?(?:next\s+)?\d+(?:[.,:]\d+)?\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?)?|\b\d+\s*(?:seconds?|minutes?|hours?|days?)\s+(?:or|before|left|remaining)\b/gi;
const VAGUE_TERMS = /\b(game[- ]changer|revolutionary|world[- ]class|best|ultimate|massive|unprecedented|guaranteed|viral|explode)\b/gi;

const CTA_PATTERN = /\b(book|buy|reply|call|click|start|try|test|scan|compare|approve|apply|download|subscribe|sign up|schedule|send|share|publish|learn more|get started)\b/i;
const CLAIM_PATTERN = /\b(will|can|helps?|increase|reduce|save|grow|double|triple|improve|faster|cheaper|better|best|convert|generate|make|turn|guarantee|guaranteed)\b/i;
const OUTCOME_PATTERN = /\b(result|outcome|revenue|conversion|saved|reduced|increased|decreased|faster|cheaper|accuracy|time|cost|roi|roas|ctr|cpc|cpa|profit|sales|leads?)\b/i;
const VAGUE_PATTERN = /\b(game[- ]changer|revolutionary|world[- ]class|best|ultimate|massive|unprecedented|guaranteed|viral|explode)\b/i;
const URGENCY_PATTERN = /\b(now|today|deadline|limited|last chance|before it'?s too late|urgent|immediately|act fast)\b/i;
const PROOF_PATTERN = /(\$\s?\d|\b\d+(?:\.\d+)?%|\b\d{2,}\b|customer|client|tested|measured|case study|benchmark|source|data|pilot|revenue|conversion|roas|ctr|cpc|cpa)/i;

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

function excerpt(value = '', max = 120) {
  const clean = String(value).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function quote(value = '', max = 120) {
  const text = excerpt(value, max);
  return text ? `“${text}”` : 'this line';
}

function firstMatching(segments, pattern) {
  return segments.find((segment) => pattern.test(segment)) || '';
}

function parseMultimodalPacket(rawContent) {
  if (!rawContent.startsWith('[BrainSNN multimodal video packet]')) return null;
  const transitionCount = Number(rawContent.match(/Detected visual transitions:\s*(\d+)/i)?.[1] || 0);
  const timeline = [...rawContent.matchAll(/^- (\d+:\d+): (Major visual change|Visual transition)[^\n]*/gmi)]
    .map((match) => ({ time: match[1], label: match[2] }));
  const workflow = [...rawContent.matchAll(/^- Step \d+: (.+)$/gmi)].map((match) => match[1].trim());
  const proofSection = rawContent.split('Concrete proof / constraints found:')[1]?.split('Transcript / operator notes:')[0] || '';
  const proof = proofSection.split('\n').map((line) => line.replace(/^[-\s]+/, '').trim()).filter(Boolean);
  const notes = rawContent.split('Transcript / operator notes:')[1]?.trim() || '';
  return { transitionCount, timeline, workflow, proof, notes };
}

function recommendation(id, title, goal, rationale, rewriteHint) {
  return { id, title, goal, rationale, rewriteHint };
}

function multimodalRecommendations(packet) {
  const firstTime = packet.timeline[0]?.time;
  const lastStep = packet.workflow[packet.workflow.length - 1];
  const recs = [];

  if (!packet.notes) {
    recs.push(recommendation(
      'label-scenes',
      'Give the transitions meaning',
      'Explain the workflow',
      `${packet.transitionCount || packet.timeline.length} visual transition(s) were detected, but pixels changing does not reveal what the operator actually did.`,
      firstTime
        ? `The first meaningful visual change is around ${firstTime}. Add a short note for what happens there and at the other transitions so BrainSNN can turn the timeline into named steps.`
        : 'Add a short operator note or transcript naming what happens in the recording; visual change alone cannot infer the business action.',
    ));
  }

  if (lastStep && !packet.proof.length && !OUTCOME_PATTERN.test(packet.notes)) {
    recs.push(recommendation(
      'finish-with-outcome',
      'Finish the workflow with an outcome',
      'Tie workflow to value',
      `The extracted workflow ends at ${quote(lastStep)}, but the input never says what that step produced or improved.`,
      `After ${quote(lastStep)}, state the measurable result: time saved, errors reduced, revenue affected, conversion change, or another checkable outcome.`,
    ));
  }

  if (packet.proof.length) {
    recs.push(recommendation(
      'connect-proof-to-step',
      'Attach the proof to the step',
      'Make evidence actionable',
      `${quote(packet.proof[0])} is concrete, but evidence is more useful when it is tied to the exact workflow step that produced it.`,
      `Name which step caused or measured ${quote(packet.proof[0])}; that turns a loose proof point into a testable workflow claim.`,
    ));
  }

  if (packet.timeline.length) {
    const peak = packet.timeline[packet.timeline.length - 1];
    recs.push(recommendation(
      'verify-transition',
      'Verify the visual change',
      'Reduce false interpretation',
      `BrainSNN sees a visual transition around ${peak.time}, but V0.1 does not identify objects, clicks, people, or actions from that change.`,
      `Check ${peak.time} in the recording and label what changed there. Treat the timestamp as a review cue, not as object or action recognition.`,
    ));
  }

  if (!lastStep && packet.notes) {
    recs.push(recommendation(
      'name-actions',
      'Turn the notes into actions',
      'Extract a usable SOP',
      'The notes do not contain enough action verbs to form a reliable ordered workflow.',
      `Rewrite the notes as actions such as “Open…”, “Select…”, “Export…”, and “Approve…” so the recording can become a structured SOP draft.`,
    ));
  }

  return recs.slice(0, 3);
}

function textRecommendations(rawContent, segments, evidenceHits, trust, urgencyHits) {
  const claimLine = firstMatching(segments, CLAIM_PATTERN) || segments[0] || rawContent;
  const proofLine = firstMatching(segments, PROOF_PATTERN);
  const vagueLine = firstMatching(segments, VAGUE_PATTERN);
  const urgencyLine = firstMatching(segments, URGENCY_PATTERN);
  const ctaLine = firstMatching(segments, CTA_PATTERN);
  const closeLine = segments[segments.length - 1] || claimLine;
  const recs = [];

  if (evidenceHits === 0 && claimLine) {
    recs.push(recommendation(
      'support-this-claim',
      'Support this exact claim',
      'Build trust',
      `${quote(claimLine)} carries the promise, but the scan found no checkable evidence attached to it.`,
      `Add a number, source, customer result, test condition, or explicit limitation directly beside ${quote(claimLine)}.`,
    ));
  } else if (proofLine && ctaLine && proofLine !== ctaLine) {
    recs.push(recommendation(
      'move-proof-to-ask',
      'Move the proof closer to the ask',
      'Build trust',
      `${quote(proofLine)} is the strongest evidence signal, while ${quote(ctaLine)} carries the action.`,
      `Put ${quote(proofLine)} immediately before ${quote(ctaLine)} so the reason to believe arrives before the ask.`,
    ));
  } else if (proofLine) {
    recs.push(recommendation(
      'lead-with-proof',
      'Use the strongest evidence earlier',
      'Build trust',
      `${quote(proofLine)} is the most concrete line in the draft.`,
      `Move ${quote(proofLine)} closer to the opening instead of making the reader wait for the strongest reason to believe you.`,
    ));
  }

  if (vagueLine) {
    recs.push(recommendation(
      'replace-vague-line',
      'Replace the vague claim',
      'Make it clearer',
      `${quote(vagueLine)} uses broad language that is difficult to verify or compare.`,
      `Rewrite ${quote(vagueLine)} with the audience, measurable change, and condition under which the claim is true.`,
    ));
  } else if (urgencyLine && (trust < 62 || evidenceHits === 0)) {
    recs.push(recommendation(
      'explain-deadline',
      'Explain the urgency',
      'Reduce manipulation',
      `${quote(urgencyLine)} asks the reader to move faster than the evidence currently justifies.`,
      `Keep the timing in ${quote(urgencyLine)} only if there is a real deadline; name what changes after that deadline.`,
    ));
  } else if (!ctaLine) {
    recs.push(recommendation(
      'clarify-close',
      'Give the close one job',
      'Make the action clear',
      `${quote(closeLine)} does not contain a clear next action for the reader.`,
      `After ${quote(closeLine)}, add one specific action: reply, test it, book, download, compare, or another step that matches the goal.`,
    ));
  }

  const opening = segments[0] || rawContent;
  if (ctaLine && recs.length < 3) {
    recs.push(recommendation(
      'protect-best-line',
      'Keep the message focused',
      'Preserve the strongest signal',
      `${quote(opening)} is the opening the reader encounters before ${quote(ctaLine)}.`,
      `Keep the core idea in ${quote(opening)} and remove any sentence between it and ${quote(ctaLine)} that does not add proof, clarity, or necessary context.`,
    ));
  }

  if (recs.length < 3 && urgencyHits === 0) {
    recs.push(recommendation(
      'check-specificity',
      'Make one detail checkable',
      'Increase specificity',
      `${quote(claimLine)} is the line most likely to shape the reader’s expectation.`,
      `Make one noun or outcome in ${quote(claimLine)} independently checkable rather than adding more adjectives.`,
    ));
  }

  return recs.slice(0, 3);
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
  const specificHits = countMatches(rawContent, SPECIFIC_TERMS);
  const coercedSpecifics = countMatches(rawContent, COERCED_SPECIFIC_TERMS);
  const evidenceHits = Math.max(0, specificHits - coercedSpecifics);
  const limitationHits = countMatches(rawContent, LIMITATION_TERMS);
  const wordCount = Math.max(1, rawContent.split(/\s+/).filter(Boolean).length);

  const trust = clampScore(
    46 + trustHits * 7 + evidenceHits * 8 + limitationHits * 9 + empathyHits * 2
    - vagueHits * 9 - fearHits * 4 - angerHits * 7,
    50,
  );
  const urgency = clampScore(28 + urgencyHits * 18 + fearHits * 7 + curiosityHits * 3, 34);
  const empathy = clampScore(38 + empathyHits * 8 - angerHits * 5, 42);
  const fear = clampScore(12 + fearHits * 18 + urgencyHits * 3, 18);
  const anger = clampScore(8 + angerHits * 22 + fearHits * 4, 10);
  const excitement = clampScore(38 + curiosityHits * 13 + urgencyHits * 5 + Math.min(18, wordCount / 20), 44);
  const viralScore = clampScore((excitement * 0.58) + (urgency * 0.27) + (empathy * 0.15), 50);
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

  const multimodalPacket = parseMultimodalPacket(rawContent);
  const recommendations = multimodalPacket
    ? multimodalRecommendations(multimodalPacket)
    : textRecommendations(rawContent, segments, evidenceHits, trust, urgencyHits);
  const firstRecommendation = recommendations[0];
  const strongestSegment = heatmap.slice().sort((a, b) => b.score - a.score)[0];

  const summary = multimodalPacket
    ? multimodalPacket.workflow.length
      ? `BrainSNN extracted ${multimodalPacket.workflow.length} workflow step(s) and ${multimodalPacket.transitionCount} visual transition(s); the main uncertainty is whether the observed changes have been given the right business meaning.`
      : `BrainSNN detected ${multimodalPacket.transitionCount} visual transition(s), but it needs operator context before those changes can become a reliable workflow.`
    : firstRecommendation
      ? `${firstRecommendation.title}: ${firstRecommendation.rationale}`
      : riskRating === 'High trust risk'
        ? 'This is likely to create attention, but pressure and unsupported claims may weaken credibility.'
        : 'The message has a usable core; the remaining work is specificity and sequencing.';

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
        text: multimodalPacket
          ? multimodalPacket.workflow[0]
            ? `The input contains an actionable first step: ${quote(multimodalPacket.workflow[0])}.`
            : `${multimodalPacket.transitionCount} visual transition(s) give you concrete timestamps to inspect.`
          : strongestSegment
            ? `${quote(strongestSegment.text)} is the strongest attention signal in this scan.`
            : 'The message has a usable core.',
      },
      {
        label: 'What hurts',
        text: firstRecommendation?.rationale || 'The biggest uncertainty is not yet specific enough to act on.',
      },
      {
        label: 'Best next move',
        text: firstRecommendation?.rewriteHint || 'Make the next claim or workflow step independently checkable.',
      },
    ],
    recommendations,
    payloadType: 'content_response_estimate',
    confidence,
    crumbModelStats: {
      model: forceFallback ? 'brainsnn-local-context-v2' : 'brainsnn-signal-map-v2',
      latencyMs: 0,
      tokensEstimated: wordCount,
      note: 'AI-estimated content response signals. Not medical, biometric, or neurological measurement.',
    },
    isFallback: Boolean(forceFallback),
    heatmap,
  };
}
