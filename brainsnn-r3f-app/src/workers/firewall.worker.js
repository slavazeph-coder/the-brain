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
  deserializeRules,
  setActiveRules,
  getActiveRules
} from '../utils/cognitiveFirewall.js';
import { runRedTeam } from '../utils/redTeam.js';
import { trainFromRedTeam } from '../utils/adversarialTraining.js';

handleRequests({
  score: async ({ text }) => scoreContent(text || ''),

  // Full pipeline equivalent to scoreContent on the main thread, using
  // a caller-supplied ruleset. Workers process one message at a time, so
  // temporarily swapping active rules around the call is safe (no race).
  // Restore the previous ruleset on exit so callers don't have to track
  // worker state.
  scoreWithRules: async ({ text, rules }) => {
    const rs = rules ? deserializeRules(rules) : null;
    const prev = getActiveRules();
    if (rs) setActiveRules(rs);
    try {
      return scoreContent(text || '');
    } finally {
      setActiveRules(prev);
    }
  },

  setRules: async ({ rules }) => {
    setActiveRules(rules ? deserializeRules(rules) : null);
    return { ok: true };
  },

  // Run the full 65-sample red-team corpus + compute per-threshold
  // F1 / detection / FPR. Heavy: ~150 ms per ruleset on default
  // hardware. Worker variant uses ITS active rules (set via setRules
  // beforehand or supplied inline), not the main thread's.
  runRedTeam: async ({ thresholds, rules } = {}) => {
    const prev = rules ? getActiveRules() : null;
    if (rules) setActiveRules(deserializeRules(rules));
    try {
      // Strip onProgress — postMessage can't carry functions, and
      // panel-side progress is overkill at <200ms total.
      return runRedTeam({ thresholds });
    } finally {
      if (rules) setActiveRules(prev);
    }
  },

  // n-gram lift mining over a runRedTeam report. Pure compute on
  // serializable data; no rule state needed.
  trainFromRedTeam: async ({ report, opts }) => trainFromRedTeam(report, opts || {})
});
