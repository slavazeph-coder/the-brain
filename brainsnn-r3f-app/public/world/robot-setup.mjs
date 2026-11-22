import {ROBOT_ART, WORLD_ICONS, ICONS} from './playground-icons.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Plain words first; the planner's numbers second. Names follow core.mjs ROBOTS except the humanoid, which is a body envelope only. */
const ROBOT_WORDS = {
  cleaner: ['Cleaning robot', 'Cleans big floors'],
  vacuum: ['Robot vacuum', 'Small and round'],
  amr: ['Mobile robot', 'Carries boxes'],
  humanoid: ['Humanoid', 'Person-sized body'],
  forklift: ['Compact forklift', 'Moves heavy loads'],
};
/** Worlds the playground already has. Each choice runs the existing control, so its checks and confirmations still apply. */
export const WORLD_CHOICES = [
  {kind:'sample', title:'Example room', plain:'A practice room with boxes'},
  {kind:'street', title:'Street', plain:'A street with buildings'},
  {kind:'empty', title:'Empty room', plain:'Start from nothing'},
  {kind:'capture', title:'My photo or video', plain:'Bring your own space'},
  {kind:'saved', title:'Saved map', plain:'Open what you saved here'},
];

export const pace = speed => speed <= 0.3 ? 'Slow' : speed <= 0.6 ? 'Steady' : 'Fast';
const trim = n => Number(n.toFixed(2)).toString();
export const bodySize = r => r.width >= 1 || r.depth >= 1 ? `${trim(r.width)} × ${trim(r.depth)} m` : `${Math.round(r.width * 100)} × ${Math.round(r.depth * 100)} cm`;

/**
 * The robot and room pickers sit beside the route action and share the simulation state.
 * It owns no state. `getState()` reads the playground and `actions` call the playground's existing paths.
 */
export function mountRobotSetup({host, robots, getState, actions}) {
  if (!host) return {refresh() {}, dispose() {}};
  const ids = Object.keys(robots);
  host.innerHTML = `<h2 id="robot-setup-title" class="visually-hidden">Set up a robot route</h2>
    <div class="setup-grid">
      <details name="playground-route-picker" class="setup-step setup-robots">
        <summary id="setup-robots-label"><span>Robot</span><strong data-picked-robot></strong></summary>
        <div class="robot-cards" role="group" aria-labelledby="setup-robots-label">${ids.map(id => {
          const r = robots[id], [title, plain] = ROBOT_WORDS[id] || [r.name, ''];
          return `<button type="button" class="robot-card" data-robot="${esc(id)}" aria-pressed="false">
            <span class="robot-art-wrap">${ROBOT_ART[id] || ROBOT_ART.amr}</span>
            <strong>${esc(title)}</strong><span class="robot-plain">${esc(plain)}</span>
            <span class="robot-facts"><span>${esc(bodySize(r))}</span><span>${esc(pace(r.speed))} · ${esc(trim(r.speed))} m/s</span></span>
            <span class="robot-chosen" aria-hidden="true">✓ Chosen</span></button>`;
        }).join('')}</div>
        <p class="setup-note">Each robot has its own size and speed. The simulation uses its body shape to check where it fits.</p>
      </details>
      <details name="playground-route-picker" class="setup-step setup-worlds">
        <summary id="setup-worlds-label"><span>World</span><strong data-picked-world></strong></summary>
        <div class="world-cards" role="group" aria-labelledby="setup-worlds-label">${WORLD_CHOICES.map(w => `<button type="button" class="world-card" data-world="${w.kind}" aria-pressed="false">
            <span class="world-art-wrap">${WORLD_ICONS[w.kind]}</span><span class="world-words"><strong>${esc(w.title)}</strong><span>${esc(w.plain)}</span></span>
            <span class="world-chosen" aria-hidden="true">✓ Here now</span></button>`).join('')}</div>
        <p class="setup-note" id="robot-setup-world">Now: the example room.</p>
      </details>
      <div class="setup-step setup-try">
        <button type="button" class="primary setup-run" id="robot-setup-run"><span class="run-icon"></span><span class="run-label">Let it try</span></button>
        <p class="setup-run-note" id="robot-setup-note" aria-live="polite"></p>
        <button type="button" class="setup-fix" id="robot-setup-fix" hidden></button>
      </div>
    </div>`;
  const run = host.querySelector('#robot-setup-run');
  const note = host.querySelector('#robot-setup-note');
  const worldNote = host.querySelector('#robot-setup-world');
  const fix = host.querySelector('#robot-setup-fix');
  const pickedRobot = host.querySelector('[data-picked-robot]');
  const pickedWorld = host.querySelector('[data-picked-world]');
  let fixAction = null;
  const abort = new AbortController();
  host.addEventListener('click', event => {
    const choice = event.target.closest('[data-robot], [data-world]');
    if (choice) {
      const picker = choice.closest('details');
      picker.open = false;
      picker.querySelector('summary').focus({preventScroll:true});
      if (choice.dataset.robot) actions.chooseRobot(choice.dataset.robot);
      else void actions.chooseWorld(choice.dataset.world);
      return;
    }
    if (event.target.closest('#robot-setup-run')) void actions.run();
    if (event.target.closest('#robot-setup-fix') && fixAction) fixAction();
  }, {signal: abort.signal});

  // Write only what changed, so the live note is announced once per change, not on every status message.
  const put = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  let icon = '';
  function refresh() {
    const s = getState();
    for (const card of host.querySelectorAll('[data-robot]')) card.setAttribute('aria-pressed', String(card.dataset.robot === s.robotId));
    for (const card of host.querySelectorAll('[data-world]')) card.setAttribute('aria-pressed', String(card.dataset.world === s.origin));
    host.dataset.origin = s.origin || '';
    put(pickedRobot, ROBOT_WORDS[s.robotId]?.[0] || robots[s.robotId]?.name || 'Choose a robot');
    put(pickedWorld, WORLD_CHOICES.find(world => world.kind === s.origin)?.title || s.worldName || 'Choose a world');
    put(worldNote, s.origin === 'street' ? 'Now: the street block.' : s.origin === 'capture' ? 'Now: adding your photo or video.' : `Now: ${s.worldName || 'no map yet'}.`);
    const stopping = !!s.planning && s.origin !== 'street';
    if (icon !== (stopping ? 'stop' : 'play')) { icon = stopping ? 'stop' : 'play'; run.querySelector('.run-icon').innerHTML = ICONS[icon]; }
    put(run.querySelector('.run-label'), stopping ? 'Stop' : s.origin === 'street' ? 'Open street routes' : 'Run a route');
    run.disabled = s.origin !== 'street' && !!s.runDisabled;
    // When size is supplied, the advised start fits that smaller envelope only.
    const needsSmallerEnvelope = s.issue?.advice?.size !== undefined;
    const spot = needsSmallerEnvelope ? null : s.issue?.advice?.start, robotName = (s.robotName || 'robot').toLowerCase();
    put(note, s.origin === 'street'
      ? 'The street has its own robot route tools. Your robot choice is used in rooms and maps.'
      : s.origin === 'capture' ? 'Add your photo or video first. A robot needs a checked map to try a route.'
      : needsSmallerEnvelope ? `No starting spot fits the ${robotName} at its current size and clearance. Review the robot size or clearance settings. ${s.issue.message}`
      : spot ? `The ${robotName} is too big for its starting spot. ${s.issue.message}`
      : s.issue ? `It could not finish: ${s.issue.message}`
      : s.gate ? `Before it can try: ${s.gate}`
      : stopping ? 'Planning the route…'
      : 'Watch a simulation of your robot finding a path.');
    // Moving the current robot is only useful when the planner found room for its current envelope.
    const inMap = s.origin !== 'street' && s.origin !== 'capture';
    const canChangeEnvelope = inMap && needsSmallerEnvelope && typeof actions.showRobotSettings === 'function';
    fixAction = canChangeEnvelope ? () => actions.showRobotSettings() : inMap && spot ? () => actions.moveStart(spot) : inMap && s.gate ? () => actions.showCheck() : null;
    put(fix, canChangeEnvelope ? 'Change robot size or clearance' : inMap && spot ? 'Move the start to where it fits' : inMap && s.gate ? 'Show me what to check' : '');
    fix.hidden = !fixAction;
  }
  refresh();
  return {refresh, dispose() { abort.abort(); host.replaceChildren(); }};
}
