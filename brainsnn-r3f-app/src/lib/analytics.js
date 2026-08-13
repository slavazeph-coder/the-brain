// Event tracking.
//
// This used to validate an event name, strip the risky fields, and then throw
// the event away — 51 call sites feeding a function that sent nothing anywhere.
// Nothing about the funnel was measurable.
//
// It now posts to /api/events by default, so measurement works without an
// account anywhere. Two properties of the original are deliberately preserved
// because they were the right calls:
//
//   1. The allowlist. An event that is not named here is dropped, so a typo or
//      an ad-hoc event cannot start leaking new data silently.
//   2. Stripping `content` / `rawContent` / `text`. The whole product is built
//      around analysing text people paste, and none of that text may leave the
//      browser through analytics. This is enforced by a test.
import { attribution } from './attribution.js';

const allowedEvents = new Set([
  // Fired once per session, and the only event that is about arriving rather
  // than about something done after arriving. Everything below measures the
  // funnel; without this one there is nothing to measure the funnel *against*.
  'visit',
  'cortex_viewed',
  'scan_started',
  'scan_completed',
  'scan_fallback_completed',
  'scan_failed',
  'example_selected',
  'result_section_viewed',
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
  // `landing_viewed`, `landing_scan_cta_clicked` and `persona_cta_clicked` used
  // to sit here. LandingPage.jsx is now a one-line re-export of
  // GaugeGapLanding.jsx, so those three named a page that no longer exists and
  // `gaugegap_landing_viewed` covers what they measured. Deleted rather than
  // given invented call sites — a list that describes the app is worth more
  // than a longer one that does not.
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
  // Sixteen names below were being fired by real call sites and dropped here,
  // because the allowlist was never updated as the labs were built. Every
  // question about whether the labs are actually played — missions won, scans
  // run, challenges shared — was unanswerable, and looked exactly like nobody
  // doing those things. analyticsCoverage.test.js now fails if this recurs.
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
]);

/** Exported so eventSink.test.js can assert the two allowlists have not drifted
 *  apart — a name on one list and not the other silently drops real events,
 *  which is indistinguishable from nobody having done that thing. */
export const __ALLOWED_EVENTS_FOR_TEST = Object.freeze([...allowedEvents]);

/** Fields that must never leave the browser, whatever a caller passes. */
const REDACTED_PROPERTIES = ['content', 'rawContent', 'text'];

export function sanitizeProperties(properties = {}) {
  const safe = { ...properties };
  for (const field of REDACTED_PROPERTIES) delete safe[field];
  return safe;
}

/**
 * Where events go.
 *
 * Defaults to this app's own `/api/events`, so measurement works out of the box
 * and does not wait on choosing a third-party analytics account. Set
 * `VITE_ANALYTICS_URL` to point somewhere else later; set it to `off` to send
 * nothing at all.
 */
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

  // Attribution rides as its own field rather than inside `properties`, for two
  // reasons: `sanitizeProperties` must stay free to strip whatever it likes
  // without taking the source with it, and the 12-property cap in eventSink.js
  // is there for event detail — spending four of those twelve on the same four
  // values in every event would starve it.
  const payload = JSON.stringify({
    event: eventName,
    properties: safeProperties,
    from: attribution(),
    path: window.location?.pathname,
    at: new Date().toISOString(),
  });

  try {
    // sendBeacon survives the page unload that follows most conversion clicks,
    // which is exactly when the interesting events fire.
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
