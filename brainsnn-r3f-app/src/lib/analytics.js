// Event tracking.
//
// This used to validate an event name, strip the risky fields, and then throw
// the event away — 51 call sites feeding a function that sent nothing anywhere.
// Nothing about the funnel was measurable, and the four commerce events below
// were declared and never once fired.
//
// It now forwards to a sink when one is configured, and still does nothing when
// one is not. Two properties of the original are deliberately preserved because
// they were the right calls:
//
//   1. The allowlist. An event that is not named here is dropped, so a typo or
//      an ad-hoc event cannot start leaking new data silently.
//   2. Stripping `content` / `rawContent` / `text`. The whole product is built
//      around analysing text people paste, and none of that text may leave the
//      browser through analytics. This is enforced by a test.
const allowedEvents = new Set([
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
  'landing_viewed',
  'landing_scan_cta_clicked',
  'classic_preset_selected',
  'persona_cta_clicked',
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
]);

/** Fields that must never leave the browser, whatever a caller passes. */
const REDACTED_PROPERTIES = ['content', 'rawContent', 'text'];

export function sanitizeProperties(properties = {}) {
  const safe = { ...properties };
  for (const field of REDACTED_PROPERTIES) delete safe[field];
  return safe;
}

/**
 * Where events go. Set `VITE_ANALYTICS_URL` to a collector that accepts a JSON
 * POST. Unset — which is the default — nothing is sent, exactly as before.
 */
function sinkUrl() {
  try {
    return import.meta.env?.VITE_ANALYTICS_URL || '';
  } catch {
    return '';
  }
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
