// Server-side landing place for analytics events.
//
// `track()` forwards to VITE_ANALYTICS_URL, and that variable was unset, so 51
// call sites were feeding a function that sent nothing anywhere. Rather than
// block measurement on choosing a third-party analytics account, events land on
// the Express server this product already runs and are written to stdout, which
// Railway retains and which is greppable.
//
// This is deliberately the humblest possible sink: no schema, no database, no
// migration. Pointing it at a real analytics service later is one env var.
//
// TRUST BOUNDARY
//
// analytics.js validates the event name and strips content/rawContent/text
// before sending. Once the endpoint is public that is a courtesy, not a
// guarantee — anyone can POST whatever they like to /api/events. So everything
// is validated again here, and the redaction is re-applied rather than assumed.
//
// Pure module with no Express import, because server.ts has no tests: the
// Playwright spec mocks every /api route, so no test in this repo executes real
// server code. Same shape as routeMeta.js — data in, string out.

/** Mirrors the allowlist in analytics.js. Anything not named here is dropped. */
export const ALLOWED_EVENTS = new Set([
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
]);

/**
 * Never logged, whatever a caller sends.
 *
 * The whole product analyses text people paste. None of it may reach a log
 * line, and a forged request must not be able to smuggle it there.
 */
export const REDACTED_PROPERTIES = Object.freeze(['content', 'rawContent', 'text']);

/** Property values are labels and counts, not prose. */
const MAX_PROPERTY_LENGTH = 120;
const MAX_PROPERTIES = 12;
const MAX_PATH_LENGTH = 512;

/**
 * The only attribution fields that may be logged. Mirrors ATTRIBUTION_FIELDS in
 * attribution.js, duplicated for the same reason the event allowlist is: this
 * endpoint is public, so what the client promises to send is a courtesy and this
 * is the check that actually holds.
 */
const ATTRIBUTION_FIELDS = Object.freeze([
  'utm_source', 'utm_medium', 'utm_campaign', 'share', 'ref',
]);

/**
 * Attribution values are hostnames and short campaign tags.
 *
 * A value containing a slash is either a full referrer URL — which carries the
 * search query someone typed, and is exactly what attribution.js exists to strip
 * — or something being smuggled past the property redaction into a different
 * field. Either way it is not a channel name, so it is dropped rather than
 * truncated: a half a URL in the log is worse than no value.
 */
function attributionValue(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PROPERTY_LENGTH) return undefined;
  if (/[/\\?#\s]/.test(trimmed)) return undefined;
  return trimmed;
}

/** @returns {object} the bounded source fields; `{}` for a direct visit. */
function normalizeAttribution(from) {
  const out = {};
  if (!from || typeof from !== 'object' || Array.isArray(from)) return out;
  for (const key of ATTRIBUTION_FIELDS) {
    const safe = attributionValue(from[key]);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

function scalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_PROPERTY_LENGTH);
  return undefined; // objects and arrays are how prose sneaks in
}

/**
 * Validates one posted event.
 * @returns {object|null} the record to log, or null if it should be dropped
 */
export function normalizeEvent(body, { path: reqPath = '', at = new Date() } = {}) {
  if (!body || typeof body !== 'object') return null;

  const name = typeof body.event === 'string' ? body.event : '';
  if (!ALLOWED_EVENTS.has(name)) return null;

  const properties = {};
  const source = body.properties && typeof body.properties === 'object' ? body.properties : {};
  let kept = 0;
  for (const [key, value] of Object.entries(source)) {
    if (kept >= MAX_PROPERTIES) break;
    if (REDACTED_PROPERTIES.includes(key)) continue;
    const safe = scalar(value);
    if (safe === undefined) continue;
    properties[key] = safe;
    kept += 1;
  }

  const clientPath = typeof body.path === 'string' ? body.path : '';
  return {
    event: name,
    properties,
    // Where the visitor came from, host-only and first-touch. Its own field
    // rather than a property, so the property cap stays available for event
    // detail and the redaction rules above stay independent of it.
    from: normalizeAttribution(body.from),
    // The client reports its own path; keep it, bounded, and prefer it over the
    // request path because /api/events is the same for every event.
    path: (clientPath || reqPath).slice(0, MAX_PATH_LENGTH),
    at: at.toISOString(),
  };
}

/** Prefix that makes events greppable in Railway's log stream. */
export const LOG_PREFIX = '[brainsnn:event]';

/** One line, so a log search returns whole events rather than fragments. */
export function formatEventLine(record) {
  return `${LOG_PREFIX} ${JSON.stringify(record)}`;
}
