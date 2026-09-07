import { analyzeContentLocally } from '../../lib/analysisEngine.js';

// The rewrite engine lives in lib/ so server.ts can serve /api/rewrite from
// exactly the same code path the browser falls back to. Client and server used
// to hold two different opinions about what a rewrite was; they no longer can.
export { createRewrite, createRewritePlan, REWRITE_GOALS, selectPatchesForGoal } from '../../lib/draftRewrite.js';

export function analyzeRewrite(originalResult, rewriteContent) {
  return analyzeContentLocally({
    content: rewriteContent,
    contentType: originalResult?.contentType || 'text',
    forceFallback: true,
  });
}
