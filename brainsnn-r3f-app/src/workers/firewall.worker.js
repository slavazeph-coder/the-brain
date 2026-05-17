/**
 * Firewall worker — runs the Cognitive Firewall + propaganda template
 * detection off the main thread.
 *
 * The firewall's regex sweep is O(patterns × text length); on a long
 * article (50k+ chars) it freezes the 3D viewer for ~800ms. Pushing it
 * here lets BrainScene render uninterrupted during the scan.
 *
 * Active ruleset is stateful per-worker (setActiveRules/getActiveRules in
 * cognitiveFirewall.js use module-level vars). For now the worker uses
 * DEFAULT_RULES; rule promotion (Brain Evolve, custom rules) will be
 * propagated via a 'setRules' message in a follow-up.
 */

import { handleRequests } from '../utils/workerPool.js';
import {
  scoreContent,
  scoreContentWithRules,
  DEFAULT_RULES,
  deserializeRules,
  setActiveRules
} from '../utils/cognitiveFirewall.js';

handleRequests({
  score: async ({ text }) => scoreContent(text || ''),

  scoreWithRules: async ({ text, rules, opts }) => {
    const rs = rules && typeof rules === 'object' && !Array.isArray(rules)
      ? (rules.urgency instanceof RegExp || !rules.urgency
        ? rules
        : deserializeRules(rules))
      : DEFAULT_RULES;
    return scoreContentWithRules(text || '', rs, opts || {});
  },

  setRules: async ({ rules }) => {
    setActiveRules(rules ? deserializeRules(rules) : null);
    return { ok: true };
  }
});
