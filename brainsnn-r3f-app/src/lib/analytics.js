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
  'autopsy_started',
  'autopsy_completed',
  'layer_trace_viewed',
]);

export function track(eventName, properties = {}) {
  if (!allowedEvents.has(eventName)) return;
  const safeProperties = { ...properties };
  delete safeProperties.content;
  delete safeProperties.rawContent;
  delete safeProperties.text;
  if (typeof window !== 'undefined' && window.__BRAINSNN_ANALYTICS_DEBUG__) {
    console.info('[brainsnn:track]', eventName, safeProperties);
  }
}
