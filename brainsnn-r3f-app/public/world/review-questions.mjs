// "Before you plan, check": at most three plain questions about what this map itself says is uncertain, most important
// first, each with the one thing to do about it. Like an engineer who asks about drawing inconsistencies before modelling,
// it checks the scan against itself (the estimated scale against how high the phone must have been held) instead of
// listing every caveat.

const one = v => Math.round(v * 10) / 10;
const TYPICAL_PHONE = [1.0, 1.9];  // metres: from chest height to raised above the head while filming

/** The floor area the map covers, in m². */
function floorArea(world) {
  const f = world.floor;
  if (!Array.isArray(f) || f.length < 3) return world.width * world.depth;
  let sum = 0;
  for (let i = 0; i < f.length; i++) { const [x1, z1] = f[i], [x2, z2] = f[(i + 1) % f.length]; sum += x1 * z2 - x2 * z1; }
  return Math.abs(sum) / 2;
}

/** Distance in metres from the robot's start to the nearest obstacle or unknown area. */
function startClearance(world) {
  let best = Infinity;
  for (const o of world.objects) {
    if (!['obstacle', 'unknown', 'no-go'].includes(o.kind)) continue;
    const dx = Math.max(o.x - world.start.x, 0, world.start.x - (o.x + o.w)), dz = Math.max(o.z - world.start.z, 0, world.start.z - (o.z + o.d));
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** [{id, ask, action?: {workflow?|action?, label}}], at most three. Hand-drawn and imported maps get none: there is no scan to
 *  check them against, and the review boxes already ask for their scale and obstacles. */
export function reviewQuestions(world) {
  if (!world || world.geometrySource?.kind !== 'reconstruction-proposal') return [];
  const questions = [], said = (world.geometrySource.warnings || []).join(' ');
  const size = `${one(world.width)} × ${one(world.depth)} m`, phone = Number(said.match(/phone (\d+(?:\.\d+)?) m above the floor/)?.[1]);
  const measure = {workflow: 'scale', label: 'Measure one distance'};
  if (/self-reported/.test(said)) {
    // Measured: one distance fixes the scale; a second one checks the pick.
  } else if (/metric-depth model/.test(said)) {
    if (Number.isFinite(phone) && (phone < TYPICAL_PHONE[0] || phone > TYPICAL_PHONE[1]))
      questions.push({id: 'scale', action: measure,
        ask: `At the estimated scale your phone was ${one(phone)} m above the floor while filming. Is that right? If not, the scale is off: measure one distance, such as a doorway.`});
    else
      questions.push({id: 'scale', action: measure,
        ask: `Is the space about ${size}? The scale is estimated, not measured${Number.isFinite(phone) ? `, and it puts your phone a typical ${one(phone)} m above the floor` : ''}. Measure one distance to make it exact.`});
  } else {
    // The height the person entered (default 1.35 m), as the map's own warning records it.
    const assumed = said.match(/assumed (\d+(?:\.\d+)?) m camera height/)?.[1];
    questions.push({id: 'scale', action: measure,
      ask: `Is the space about ${size}? Its scale assumes you held the phone ${assumed ? `${assumed} m high` : 'at a typical height'}. Measure one distance to make it exact.`});
  }
  const unknown = world.objects.filter(o => o.kind === 'unknown').reduce((sum, o) => sum + o.w * o.d, 0);
  if (unknown >= Math.max(2, .1 * floorArea(world)))
    questions.push({id: 'unknown', ask: `${Math.round(unknown)} m² was never seen, so it stays blocked. Walk it with the phone, or keep it blocked?`});
  const clearance = startClearance(world);
  if (clearance < .6)
    questions.push({id: 'start', ask: `The robot starts ${clearance < .05 ? 'against' : `${one(clearance)} m from`} an obstacle. Is that where it really docks? If not, set the start below.`});
  if (questions.length < 3)
    questions.push({id: 'glass', action: {action: 'add-object', label: 'Add an obstacle'},
      ask: 'Any glass doors, mirrors or plain white walls? Scans miss them, so add them as obstacles.'});
  return questions.slice(0, 3);
}
