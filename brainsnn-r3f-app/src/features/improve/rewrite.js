import { analyzeContentLocally } from '../../lib/analysisEngine.js';
import { analyzeEvidenceGaps } from '../../lib/evidenceGapAnalyzer.js';
import { createRewritePlan, REWRITE_GOALS, selectPatchesForGoal } from '../../lib/draftRewrite.js';

// The rewrite engine lives in lib/ so server.ts can serve /api/rewrite from
// exactly the same code path the browser falls back to. Client and server used
// to hold two different opinions about what a rewrite was; they no longer can.
export { REWRITE_GOALS, selectPatchesForGoal, createRewritePlan };

// Mechanical edits stay out of the copy (see lib/draftRewrite.js). Merge
// decision, kept from the coherence-landing branch: a trust rewrite also
// appends the ranked proof the evidence-gap analysis asks for when the
// strongest gap is a price claim — the one class where the missing proof is
// objectively nameable (volume, rate, turnaround) instead of coaching copy.
export function createRewrite(content, goal = 'trust') {
  const plan = createRewritePlan(content, goal);
  if (!plan.content || goal !== 'trust') return plan.content;
  const evidence = analyzeEvidenceGaps({ content: plan.content, context: 'social_post' });
  const top = evidence.topRecommendation;
  if (!top || evidence.gaps?.[0]?.classification !== 'price_claim') return plan.content;
  return `${plan.content}\n\n${top.recommendedEdit} Most valuable proof: ${top.mostValuableProof.slice(0, 3).join(' ')}`;
}

export function analyzeRewrite(originalResult, rewriteContent) {
  return analyzeContentLocally({
    content: rewriteContent,
    contentType: originalResult?.contentType || 'text',
    forceFallback: true,
  });
}
