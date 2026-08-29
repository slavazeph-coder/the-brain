// Server-side landing place for analytics events.
// Public input is validated again here even though analytics.js already strips
// pasted content in the browser.

export const ALLOWED_EVENTS = new Set([
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
]);

export const REDACTED_PROPERTIES = Object.freeze(['content', 'rawContent', 'text']);

const MAX_PROPERTY_LENGTH = 120;
const MAX_PROPERTIES = 12;
const MAX_PATH_LENGTH = 512;
const ATTRIBUTION_FIELDS = Object.freeze([
  'utm_source', 'utm_medium', 'utm_campaign', 'share', 'ref',
]);

function attributionValue(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PROPERTY_LENGTH) return undefined;
  if (/[/\\?#\s]/.test(trimmed)) return undefined;
  return trimmed;
}

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
  return undefined;
}

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
    from: normalizeAttribution(body.from),
    path: (clientPath || reqPath).slice(0, MAX_PATH_LENGTH),
    at: at.toISOString(),
  };
}

export const LOG_PREFIX = '[brainsnn:event]';

export function formatEventLine(record) {
  return `${LOG_PREFIX} ${JSON.stringify(record)}`;
}
