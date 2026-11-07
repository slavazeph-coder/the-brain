// What-if: an edit to a reviewed map, then the same goal routed again, with the previous route kept for comparison.
// The edit never plans by itself. The map goes back to review (the product's gate), and only a reviewed map routes
// again; the card says what changed and by how much, in metres, on the same robot and the same grid.
import {label} from './core.mjs';

const num = (v) => Number.isFinite(v) ? v : null;

/** The record to keep before an edit: the goal and the route that reached it, and what the edit was. Null when
 *  there is no routed goal to compare against. */
export function captureBefore({goal, result, world, selected, kind}) {
  if (!goal || !result?.route?.length || !result.goal || !Number.isFinite(result.distance)) return null;
  const object = world?.objects?.find(o => o.id === selected) || null;
  return {
    goal: {x: num(goal.x), z: num(goal.z)},
    previous: {distance: result.distance, travelSeconds: num(result.travelSeconds), route: result.route.map(p => ({x: p.x, z: p.z}))},
    edit: {kind: label(kind, 'edit'), objectId: object ? object.id : null, objectName: object ? label(object.name, 'Obstacle') : null},
    after: null,
  };
}

/** The comparison line once the reviewed map routed to the same goal again. */
export function compare(whatIf, route) {
  const before = whatIf.previous.distance, after = route.distance, delta = after - before;
  const what = whatIf.edit.objectName ? `${whatIf.edit.kind} ${whatIf.edit.objectName}` : whatIf.edit.kind;
  const sign = delta < 0 ? '−' : delta > 0 ? '+' : '±';
  return {
    before, after, deltaM: delta,
    text: `Same spot, same robot, after "${what}": ${before.toFixed(1)} m → ${after.toFixed(1)} m (${sign}${Math.abs(delta).toFixed(1)} m). A simulation on the reviewed map; no robot was moved.`,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/** The panel card. `gate` is planningGate(world): the reason the map cannot route yet, or null. */
export function whatIfCard(whatIf, gate) {
  if (!whatIf) return '';
  const what = whatIf.edit.objectName ? `${esc(whatIf.edit.kind)} ${esc(whatIf.edit.objectName)}` : esc(whatIf.edit.kind);
  if (whatIf.after) {
    return `<div class="proposal-card what-if" data-testid="what-if"><h4>What changed</h4><p>${esc(whatIf.after.text)}</p>` +
      `<p class="micro">The previous route stays drawn, dimmed, until the goal or the map changes.</p>` +
      `<button class="wide" data-action="what-if-clear">Done comparing</button></div>`;
  }
  return `<div class="proposal-card what-if" data-testid="what-if"><h4>What changed</h4>` +
    `<p>Before "${what}" the route to the tapped spot was <strong>${whatIf.previous.distance.toFixed(1)} m</strong>.` +
    ` ${gate ? 'Review the edited map, then route again to compare.' : 'The map is reviewed. Route again to compare.'}</p>` +
    `<button class="wide primary" data-action="what-if-route" ${gate ? 'disabled' : ''}>Route again to the same spot</button>` +
    (gate ? `<p class="micro">${esc(gate)}</p>` : '') + `</div>`;
}
