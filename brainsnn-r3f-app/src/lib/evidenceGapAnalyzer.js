export const EVIDENCE_GAP_SCHEMA_VERSION = 'brainsnn.evidence-gaps.v1';
export const EVIDENCE_CONTEXTS = Object.freeze(['paid_ad', 'social_post', 'founder_post', 'landing_page', 'sales_email', 'video_script']);
export const MAX_EVIDENCE_INPUT_CHARS = 100_000;

const CONTEXT_ALIASES = Object.freeze({
  ad: 'paid_ad', paid: 'paid_ad', paid_ad: 'paid_ad',
  social: 'social_post', social_hook: 'social_post', post: 'social_post', social_post: 'social_post',
  founder: 'founder_post', founder_post: 'founder_post',
  landing: 'landing_page', webpage: 'landing_page', brand_message: 'landing_page', landing_page: 'landing_page',
  email: 'sales_email', sales: 'sales_email', sales_email: 'sales_email',
  video: 'video_script', script: 'video_script', video_script: 'video_script',
});

const CONTEXT_EDIT = Object.freeze({
  paid_ad: 'Place the strongest verifiable proof immediately before the claim or call to action, where a viewer can inspect it without leaving the ad.',
  social_post: 'Replace one broad assertion with a compact result, source, or visible example that fits in the post itself.',
  founder_post: 'Anchor the claim in a first-hand build log, pilot observation, or clearly bounded founder experience.',
  landing_page: 'Add an adjacent proof module with the result, method, sample, and limitation beside the claim it supports.',
  sales_email: 'Pair the claim with one relevant customer result or concrete service example before asking for a reply or meeting.',
  video_script: 'Show or narrate the strongest demonstration before the claim appears, and keep the supporting result on screen long enough to verify.',
});

function safeText(value, field = 'content') {
  const text = String(value ?? '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  if (text.length > MAX_EVIDENCE_INPUT_CHARS) throw new Error(`${field} exceeds ${MAX_EVIDENCE_INPUT_CHARS} characters.`);
  return text;
}

export function normalizeEvidenceContext(value = 'social_post') {
  return CONTEXT_ALIASES[String(value || '').toLowerCase().replace(/[ -]+/g, '_')] || 'social_post';
}

function sentences(text) {
  return (String(text).match(/[^.!?\n]+[.!?]+|[^.!?\n]+$/g) || [])
    .map((item) => item.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((item) => item.length >= 6)
    .slice(0, 500);
}

function claimType(sentence) {
  const lower = sentence.toLowerCase();
  if (/\$\s?\d|\b(?:price|pricing|cost|pay|worth|roi|return on investment)\b/.test(lower)) return 'price_claim';
  if (/\b(?:secure|security|private|privacy|compliant|encrypted|safe|breach|threat)\b/.test(lower)) return 'security_claim';
  if (/\b(?:increase|decrease|improve|reduce|save|faster|accuracy|accurate|conversion|revenue|hours? saved|turnaround)\b|\d+(?:\.\d+)?%/.test(lower)) return 'performance_claim';
  if (/\b(?:customer|client|users?|teams?|companies)\b.*\b(?:use|choose|trust|love|prefer|adopt|buy|pay)\b/.test(lower)) return 'customer_claim';
  if (/\b(?:can|could|will|supports?|provides?|enables?|automates?|processes?|labels?|detects?|predicts?)\b/.test(lower)) return 'capability_claim';
  return 'general_claim';
}

function looksLikeClaim(sentence) {
  const lower = sentence.toLowerCase();
  return /\$\s?\d|\d+(?:\.\d+)?%|\b(?:can|could|may|will|always|never|best|fastest|guaranteed|increase|reduce|save|pay|supports?|provides?|enables?|automates?|secure|compliant|accurate)\b/.test(lower);
}

function evidenceKind(sentence) {
  const lower = sentence.toLowerCase();
  if (/\b(?:pilot|customer|client|case study|testimonial)\b/.test(lower)
    && /\b(?:achieved|reported|processed|saved|reduced|increased|used|result)\b|\d+(?:\.\d+)?%/.test(lower)) return 'customer_result';
  if (/\b(?:demo|demonstration|example|sample|screenshot|before.?and.?after|before\/after|output)\b/.test(lower)) return 'demonstration';
  if (/\b(?:according to|source|study|research|benchmark|dataset|report)\b/.test(lower)) return 'source';
  if (/\b(?:measured|tested|evaluation|accuracy|quality control|qc rate|turnaround|processed)\b/.test(lower)
    && /\d|\b(?:minutes?|hours?|days?|items?|files?|videos?)\b/.test(lower)) return 'measurement';
  if (/\b(?:limited to|does not|not yet|excluding|constraint|caveat|approximately|estimated)\b/.test(lower)) return 'limitation';
  return null;
}

function locateSentence(sentence, segments = []) {
  const normalized = sentence.toLowerCase();
  const match = segments.find((segment) => String(segment?.text || '').toLowerCase().includes(normalized.slice(0, Math.min(40, normalized.length))));
  if (!match) return {};
  return {
    ...(Number.isFinite(Number(match.startMs)) ? { startMs: Number(match.startMs), timestampMs: Number(match.startMs) } : {}),
    ...(Number.isFinite(Number(match.endMs)) ? { endMs: Number(match.endMs) } : {}),
    ...(match.id ? { segmentId: String(match.id).slice(0, 160) } : {}),
  };
}

function proofNeeds(type, claim) {
  const lower = claim.toLowerCase();
  if (type === 'price_claim' && /(?:footage|video).*(?:label|annotat)|(?:label|annotat).*(?:footage|video)/.test(lower)) {
    return [
      'Minutes or hours of footage processed in a representative job.',
      'Labeling accuracy or quality-control acceptance rate.',
      'Turnaround time for that amount of footage.',
      'A before/after example of the unstructured footage and delivered structured output.',
      'A pilot or customer result showing willingness to pay at the stated price.',
    ];
  }
  const needs = {
    price_claim: [
      'A customer or pilot example at the stated price.',
      'A quantified explanation of the workload or outcome the price covers.',
      'A credible comparison to the current cost, time, or alternative.',
    ],
    performance_claim: [
      'The measured baseline and resulting value.',
      'The sample size, time period, and evaluation method.',
      'A limitation or condition under which the result may not hold.',
    ],
    security_claim: [
      'The exact security control and threat it addresses.',
      'An independent test, audit, or reproducible verification result.',
      'The boundary or limitation of the security claim.',
    ],
    customer_claim: [
      'A named or anonymized customer example with a concrete result.',
      'The customer context and why it is comparable to this audience.',
    ],
    capability_claim: [
      'A demonstration using representative input and visible output.',
      'A measurable quality, time, or reliability result.',
      'The operating constraints and failure conditions.',
    ],
    general_claim: [
      'A specific example that makes the assertion checkable.',
      'A source, measurement, or clearly bounded observation.',
    ],
  };
  return needs[type];
}

function supportingEvidence(claim, evidence) {
  const claimTerms = new Set(claim.toLowerCase().match(/[a-z]{4,}/g) || []);
  return evidence.filter((item) => {
    const words = item.text.toLowerCase().match(/[a-z]{4,}/g) || [];
    return words.some((word) => claimTerms.has(word));
  });
}

export function analyzeEvidenceGaps(input = {}) {
  const content = safeText(typeof input === 'string' ? input : input.content ?? input.text ?? '');
  const context = normalizeEvidenceContext(typeof input === 'object' ? input.context ?? input.contentType : 'social_post');
  const segments = Array.isArray(input?.segments) ? input.segments.slice(0, 500).map((segment, index) => ({
    id: segment?.id || `segment-${index}`,
    text: safeText(segment?.text || '', `segments[${index}].text`),
    startMs: Number(segment?.startMs),
    endMs: Number(segment?.endMs),
  })) : [];
  const sourceText = content || segments.map((segment) => segment.text).filter(Boolean).join(' ');
  const items = sentences(sourceText);
  const evidenceInventory = items.map((text, index) => ({ id: `evidence-${index + 1}`, text, kind: evidenceKind(text), ...locateSentence(text, segments) }))
    .filter((item) => item.kind);
  const claims = items.filter(looksLikeClaim).map((text, index) => {
    const type = claimType(text);
    const support = supportingEvidence(text, evidenceInventory).filter((item) => item.text !== text);
    return {
      id: `claim-${index + 1}`,
      text,
      type,
      supportIds: support.map((item) => item.id),
      supported: support.length > 0,
      ...locateSentence(text, segments),
    };
  });
  const gaps = claims.filter((claim) => !claim.supported).map((claim, index) => ({
    id: `gap-${index + 1}`,
    claimId: claim.id,
    claim: claim.text,
    classification: claim.type,
    evidenceGap: `No ${claim.type.replace(/_/g, ' ')} support was found near this claim.`,
    mostValuableProof: proofNeeds(claim.type, claim.text),
    ...('timestampMs' in claim ? { timestampMs: claim.timestampMs, startMs: claim.startMs, endMs: claim.endMs, segmentId: claim.segmentId } : {}),
  }));
  const recommendations = gaps.map((gap, index) => {
    const timestampPrefix = Number.isFinite(gap.timestampMs) ? `At ${Math.round(gap.timestampMs)} ms, ` : '';
    return {
      id: `evidence-recommendation-${index + 1}`,
      claimId: gap.claimId,
      title: gap.classification === 'price_claim' ? 'Support the price before asking the audience to accept it' : `Make the ${gap.classification.replace(/_/g, ' ')} checkable`,
      rationale: `${timestampPrefix}the claim "${gap.claim}" appears without nearby ${gap.classification.replace(/_/g, ' ')} evidence.`,
      recommendedEdit: CONTEXT_EDIT[context],
      mostValuableProof: gap.mostValuableProof,
      ...(Number.isFinite(gap.timestampMs) ? { timestampMs: gap.timestampMs } : {}),
    };
  });
  return {
    schemaVersion: EVIDENCE_GAP_SCHEMA_VERSION,
    context,
    claims,
    evidenceInventory,
    gaps,
    recommendations,
    topRecommendation: recommendations[0] || null,
    summary: gaps.length
      ? `${gaps.length} unsupported claim${gaps.length === 1 ? '' : 's'} found; the first recommendation targets the highest-value missing proof.`
      : claims.length ? 'Claims have nearby evidence signals in this input.' : 'No checkable commercial claim was detected.',
    limitations: 'Deterministic claim/evidence matching identifies editing opportunities; it does not verify that supplied evidence is true.',
  };
}

export class EvidenceGapAnalyzer {
  analyze(input) { return analyzeEvidenceGaps(input); }
}

export default analyzeEvidenceGaps;
