// A bounded, source-derived review of reconstruction coverage.
// Registered frames do not measure physical area, completeness, or metric accuracy.
export function reconstructionRecovery(evidence) {
  if (!evidence || evidence.schema !== 'brainsnn.reconstruction.v1') return null;
  const capture = evidence.capture || {};
  const total = Number(capture.images);
  const used = Number(capture.registered_images);
  const hasCounts = Number.isInteger(total) && total > 0 && Number.isInteger(used) && used >= 0 && used <= total;
  const models = Number.isInteger(capture.models_found) && capture.models_found >= 0 ? capture.models_found : null;
  const folded = capture.consistency?.status === 'folded';
  const fraction = hasCounts ? used / total : null;
  const poor = hasCounts && fraction < 0.65;
  const partial = hasCounts && used < total;
  const label = folded ? 'Geometry conflict' : poor ? 'Partial reconstruction' : partial ? 'Some views missing' : 'Registration needs review';
  const summary = folded
    ? 'The reconstructed layout contradicts the video matches. Do not use its dimensions or route map.'
    : poor
      ? `Only ${used} of ${total} sampled frames aligned (${Math.round(100 * fraction)}%). This is a partial model, not a measured room.`
      : partial
        ? `${used} of ${total} sampled frames aligned (${Math.round(100 * fraction)}%). Some views did not contribute to this model.`
        : hasCounts
          ? `All ${total} sampled frames registered. This does not prove full coverage or physical accuracy.`
          : 'Frame registration counts are unavailable. Inspect source evidence before measuring.';
  const actions = folded
    ? ['Retake the route with gradual turns and overlapping stationary details.', 'Start and finish in the same textured area so geometry can be checked.']
    : poor
      ? ['Film missing corners and doorways from several angles with side-to-side motion.', 'Move slowly and revisit a familiar textured area rather than panning across blank surfaces.']
      : ['Compare reconstructed geometry against the original media before measuring.', 'Capture additional overlapping views wherever walls, doors or obstacles are missing.'];
  if (models !== null && models > 1) actions.push('Multiple disconnected camera models were found. Revisit the transition between the areas.');
  return { label, summary, actions, registered: hasCounts ? used : null, total: hasCounts ? total : null, fraction, folded, partial, models,
    note: 'Registered-frame percentage measures camera alignment, not spatial coverage. All displayed dimensions require independent scale and checks.' };
}
