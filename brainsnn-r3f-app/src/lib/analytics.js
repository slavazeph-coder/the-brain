// Event tracking.
//
// Events post to /api/events by default. The allowlist prevents ad-hoc event
// names from silently widening what the product collects, and pasted content is
// stripped before anything leaves the browser.
import { attribution } from './attribution.js';

const allowedEvents = new Set([
  'visit',
  'cortex_viewed',
  'scan_started',
  'scan_completed',
  'scan_fallback_completed',
  'scan_failed',
  'example_selected',
  'result_section_viewed',
  'result_feedback_submitted',
  'improve_started',
  'rewrite_goal_selected',
  'version_created',
  'version_compared',
  'memory_saved',
  'queue_added',
  'content_approved',
  'export_opened',
  'export_downloaded',
  'share_text_copied',
  'upgrade_clicked',
  'pilot_clicked',
  'pricing_viewed',
  'checkout_started',
  'lead_form_viewed',
  'lead_captured',
  'autopsy_started',
  'autopsy_completed',
  'layer_trace_viewed',
  'classic_preset_selected',
  'share_card_shared',
  'share_card_downloaded',
  'brain3d_fallback_used',
  'gaugegap_landing_viewed',
  'gaugegap_hero_play_clicked',
  'gaugegap_lab_clicked',
  'gaugegap_lab_selected',
  'gaugegap_filter_selected',
  'gaugegap_surprise_clicked',
  'gaugegap_pathway_selected',
  'gaugegap_client_cta_clicked',
  'gaugegap_research_cta_clicked',
  'gaugegap_pricing_cta_clicked',
  'gaugegap_content_scan_started',
  'gaugegap_content_scan_completed',
  'gaugegap_content_challenge_opened',
  'gaugegap_content_challenge_shared',
  'gaugegap_content_challenge_copied',
  'gaugegap_content_sample_loaded',
  'gaugegap_content_rewrite_created',
  'gaugegap_snn_run',
  'gaugegap_brain_challenge_opened',
  'gaugegap_brain_mission_won',
  'gaugegap_brain_intervention',
  'gaugegap_brain_level_loaded',
  'gaugegap_brain_proof_exported',
  'reconstruct_page_viewed',
  'reconstruct_command_copied',
  'reconstruct_scan_copy_clicked',
  'holdout_evidence_viewed',
  'holdout_evidence_cta_clicked',
  'behaviour_home_viewed',
  'behaviour_nav_missions_clicked',
  'behaviour_hero_missions_clicked',
  'survival_world_opened',
  'survival_world_external_clicked',
  'proof_missions_viewed',
  'proof_mission_opened',
  'refund_mission_viewed',
  'refund_mission_run',
  'refund_mission_forked',
  'refund_mission_proof_exported',
  'workflow_mission_viewed',
  'workflow_mission_run',
  'workflow_mission_forked',
  'workflow_mission_proof_exported',
  'bug_hunt_mission_viewed',
  'bug_hunt_mission_run',
  'bug_hunt_mission_forked',
  'bug_hunt_mission_proof_exported',
  'reproduce_mission_viewed',
  'reproduce_mission_run',
  'reproduce_mission_forked',
  'reproduce_mission_proof_exported',
  'navigation_mission_viewed',
  'navigation_mission_run',
  'navigation_mission_forked',
  'navigation_mission_proof_exported',
]);

export const __ALLOWED_EVENTS_FOR_TEST = Object.freeze([...allowedEvents]);

const REDACTED_PROPERTIES = ['content', 'rawContent', 'text'];

export function sanitizeProperties(properties = {}) {
  const safe = { ...properties };
  for (const field of REDACTED_PROPERTIES) delete safe[field];
  return safe;
}

export const DEFAULT_SINK_URL = '/api/events';

function sinkUrl() {
  let configured;
  try {
    configured = import.meta.env?.VITE_ANALYTICS_URL;
  } catch {
    configured = undefined;
  }
  if (configured === 'off') return '';
  return configured || DEFAULT_SINK_URL;
}

export function isAnalyticsConfigured() {
  return Boolean(sinkUrl());
}

export function track(eventName, properties = {}) {
  if (!allowedEvents.has(eventName)) return;
  const safeProperties = sanitizeProperties(properties);

  if (typeof window !== 'undefined' && window.__BRAINSNN_ANALYTICS_DEBUG__) {
    console.info('[brainsnn:track]', eventName, safeProperties);
  }

  const url = sinkUrl();
  if (!url || typeof window === 'undefined') return;

  const payload = JSON.stringify({
    event: eventName,
    properties: safeProperties,
    from: attribution(),
    path: window.location?.pathname,
    at: new Date().toISOString(),
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must never break the page it is measuring.
  }
}
