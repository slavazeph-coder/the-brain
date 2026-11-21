/**
 * Robot missions: a game layer on the playground's own loop (pick a robot, change the room, let it try).
 *
 * Stars come only from what actually happened in this browser: the planner's route lengths, the
 * what-if comparison after a reviewed edit, and the playground actions people already take. Nothing
 * is scored that the planner did not compute, and every route stays labelled as a simulation.
 * Progress is a per-browser convenience (localStorage); the page works the same without it.
 */

export const STORE_KEY = 'brainsnn-world-missions-v1';
export const SOUND_KEY = 'brainsnn-world-missions-sound';

/** Each mission: plain goal, a short how-to, star tiers, and where "Show me" takes you. */
export const MISSIONS = [
  { id: 'first', icon: '▶', title: 'First run', goal: 'Pick any robot and press Let it try.',
    how: 'Choose a robot card, then the big Let it try button.', stars: 1, show: 'run' },
  { id: 'garage', icon: '🤖', title: 'Robot garage', goal: 'Find a route with different robots.',
    how: 'Two robots earn one star, three earn two, all five earn three.', stars: 3, show: 'robots' },
  { id: 'shortcut', icon: '✂', title: 'Shortcut', goal: 'Change the room so the same route gets shorter.',
    how: 'Route to a spot. Move or remove a box in the way, tick “I reviewed obstacles” again, then Route again to compare. 0.5 m, 2 m and 4 m shorter earn one, two and three stars.',
    stars: 3, show: 'spot' },
  { id: 'spot', icon: '📍', title: 'Pick the spot', goal: 'Send the robot to a spot you choose.',
    how: 'In Try robots, enter a spot in metres and route to it.', stars: 1, show: 'spot' },
  { id: 'street', icon: '🏙', title: 'Street explorer', goal: 'Open the Street world.',
    how: 'Choose Street under Build its world.', stars: 1, show: 'street' },
  { id: 'before', icon: '⧉', title: 'Before and after', goal: 'Keep a before copy of your map.',
    how: 'Press Keep a before copy, then change the room and compare.', stars: 1, show: 'before' },
  { id: 'own', icon: '📷', title: 'Your own space', goal: 'Add your own photo or video.',
    how: 'Choose My photo or video. It stays in this browser until you choose to upload.', stars: 1, show: 'own' },
];
export const TOTAL_STARS = MISSIONS.reduce((sum, mission) => sum + mission.stars, 0);

export const LEVELS = [
  { at: 0, name: 'Rookie' }, { at: 3, name: 'Explorer' }, { at: 6, name: 'Builder' },
  { at: 9, name: 'Expert' }, { at: TOTAL_STARS, name: 'Master' },
];

export function emptyProgress() {
  return { robots: [], bestCut: 0, firstRun: false, spot: false, street: false, before: false, own: false, shortest: {} };
}

/** Sanitise stored progress: anything malformed starts again rather than inventing stars. */
export function readProgress(raw) {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const robots = Array.isArray(raw.robots) ? [...new Set(raw.robots.filter(id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/u.test(id)))].slice(0, 20) : [];
  const shortest = {};
  if (raw.shortest && typeof raw.shortest === 'object') {
    for (const [key, value] of Object.entries(raw.shortest).slice(0, 200)) {
      if (typeof key === 'string' && key.length <= 200 && Number.isFinite(value) && value > 0) shortest[key] = value;
    }
  }
  const cut = Number(raw.bestCut);
  return { ...base, robots, shortest, bestCut: Number.isFinite(cut) && cut > 0 ? Math.min(cut, 10_000) : 0,
    firstRun: raw.firstRun === true, spot: raw.spot === true, street: raw.street === true, before: raw.before === true, own: raw.own === true };
}

const metres = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);

/**
 * Fold one playground event into progress. Returns the new progress and what this event achieved
 * ({run: {metres, previous, key, newShortest}} for a completed route), without mutating the input.
 */
export function applyEvent(progress, event) {
  const next = { ...progress, robots: [...progress.robots], shortest: { ...progress.shortest } };
  const outcome = {};
  const type = event?.type, detail = event?.detail;
  if (type === 'plan_completed' || type === 'goal_routed' || type === 'what_if_rerouted') {
    const length = metres(detail?.metres);
    if (length !== null) {
      next.firstRun = true;
      if (typeof event.robotId === 'string' && /^[a-z0-9-]{1,40}$/u.test(event.robotId) && !next.robots.includes(event.robotId)) next.robots.push(event.robotId);
      if (type === 'plan_completed') {
        // Let it try covers the floor the robot can reach: report the area and the path, not a "shortest" score.
        outcome.run = { kind: 'cover', metres: length, area: metres(event.area) };
      } else {
        const key = `${event.robotId || 'robot'}|${String(event.map || 'map').slice(0, 120)}`;
        const previous = next.shortest[key] ?? null;
        const newShortest = previous === null || length < previous - 0.05;
        if (newShortest) next.shortest[key] = length;
        outcome.run = { kind: 'route', metres: length, previous, key, newShortest };
      }
    }
    if (type === 'goal_routed' && length !== null) next.spot = true;
    if (type === 'what_if_rerouted') {
      const before = metres(detail?.before);
      if (before !== null && length !== null && before > length) {
        const cut = before - length;
        outcome.cut = cut;
        if (cut > next.bestCut) next.bestCut = cut;
      }
    }
  }
  if (type === 'sandbox_selected' && detail?.workspace === 'street') next.street = true;
  if (type === 'scenario_forked') next.before = true;
  if (type === 'source_added') next.own = true;
  return { progress: next, outcome };
}

export function missionStars(id, progress) {
  switch (id) {
    case 'first': return progress.firstRun ? 1 : 0;
    case 'garage': return progress.robots.length >= 5 ? 3 : progress.robots.length >= 3 ? 2 : progress.robots.length >= 2 ? 1 : 0;
    case 'shortcut': return progress.bestCut >= 4 ? 3 : progress.bestCut >= 2 ? 2 : progress.bestCut >= 0.5 ? 1 : 0;
    case 'spot': return progress.spot ? 1 : 0;
    case 'street': return progress.street ? 1 : 0;
    case 'before': return progress.before ? 1 : 0;
    case 'own': return progress.own ? 1 : 0;
    default: return 0;
  }
}

export function totalStars(progress) {
  return MISSIONS.reduce((sum, mission) => sum + missionStars(mission.id, progress), 0);
}

export function levelFor(stars) {
  let level = LEVELS[0], index = 0;
  LEVELS.forEach((entry, i) => { if (stars >= entry.at) { level = entry; index = i; } });
  const next = LEVELS[index + 1] || null;
  return { number: index + 1, name: level.name, next, toNext: next ? next.at - stars : 0 };
}

/** The first mission with stars still to earn, in board order (null when every star is earned). */
export function nextMission(progress) {
  return MISSIONS.find(mission => missionStars(mission.id, progress) < mission.stars) || null;
}

/** Which missions gained stars between two progress states, with the new count. */
export function newlyEarned(before, after) {
  return MISSIONS.map(mission => ({ mission, from: missionStars(mission.id, before), to: missionStars(mission.id, after) }))
    .filter(change => change.to > change.from);
}

const STAR = '★', EMPTY = '☆';
const starText = (earned, of) => STAR.repeat(earned) + EMPTY.repeat(Math.max(0, of - earned));

/** The browser half: HUD button, mission panel, toast, run card, confetti and optional sound. */
export function mountMissions({ button, studio, viewport, show = () => {}, storage = globalThis.localStorage }) {
  if (!button) return null;
  let progress = emptyProgress();
  try { progress = readProgress(JSON.parse(storage?.getItem(STORE_KEY) || 'null')); } catch { /* start fresh */ }
  let sound = false;
  try { sound = storage?.getItem(SOUND_KEY) === 'on'; } catch { /* default off */ }
  const save = () => { try { storage?.setItem(STORE_KEY, JSON.stringify(progress)); } catch { /* still works this visit */ } };
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const counter = button.querySelector('[data-mission-stars]');
  const levelLabel = button.querySelector('[data-mission-level]');
  function hud() {
    const stars = totalStars(progress), level = levelFor(stars);
    counter.textContent = `${stars}/${TOTAL_STARS}`;
    levelLabel.textContent = `Level ${level.number}`;
    button.setAttribute('aria-label', `Missions: ${stars} of ${TOTAL_STARS} stars, level ${level.number}, ${level.name}`);
    button.style.setProperty('--mission-progress', String(stars / TOTAL_STARS));
  }

  // Toast and confetti never take pointer events, so they cannot cover a control.
  const toast = document.createElement('div');
  toast.className = 'mission-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  document.body.append(toast);
  let toastTimer = 0, toastShown = 0;
  function celebrate(lines, big) {
    const nodes = lines.map(([cls, text]) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; return p; });
    // One route can finish two missions (a new robot and a shortcut): keep both lines in one toast.
    if (!toast.hidden && performance.now() - toastShown < 400) {
      toast.querySelectorAll('.mission-toast-sub,.mission-toast-level,.mission-toast-next').forEach(node => node.remove());
      toast.append(...nodes);
    } else toast.replaceChildren(...nodes);
    toastShown = performance.now();
    toast.hidden = false;
    toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove('show'); toast.hidden = true; }, 4200);
    if (big && !reduced()) confetti();
    if (big && sound) chime();
  }

  function confetti() {
    const canvas = document.createElement('canvas');
    canvas.className = 'mission-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    const scale = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = innerWidth * scale; canvas.height = innerHeight * scale;
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }
    ctx.scale(scale, scale);
    const colors = ['#00f5ff', '#a855f7', '#ffffff', '#ffd166', '#7cf7c4'];
    const bits = Array.from({ length: 110 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 160, y: innerHeight * .72,
      vx: (Math.random() - .5) * 9, vy: -7 - Math.random() * 8, r: 3 + Math.random() * 4,
      spin: Math.random() * 6, color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const start = performance.now();
    function frame(now) {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.vy += .32; b.x += b.vx; b.y += b.vy; b.spin += .2;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.spin); ctx.globalAlpha = Math.max(0, 1 - t / 1.6);
        ctx.fillStyle = b.color; ctx.fillRect(-b.r, -b.r / 2, b.r * 2, b.r); ctx.restore();
      }
      if (t < 1.6) requestAnimationFrame(frame); else canvas.remove();
    }
    requestAnimationFrame(frame);
  }

  let audio = null;
  function chime() {
    try {
      audio ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      const now = audio.currentTime;
      [523.25, 659.25, 783.99].forEach((hz, i) => {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.type = 'triangle'; osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.0001, now + i * .09);
        gain.gain.exponentialRampToValueAtTime(0.12, now + i * .09 + .02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * .09 + .35);
        osc.connect(gain).connect(audio.destination); osc.start(now + i * .09); osc.stop(now + i * .09 + .4);
      });
    } catch { /* sound is optional */ }
  }

  // A score card on the map after every route: the number, the change, and the shortest so far.
  let card = null, cardTimer = 0;
  function runCard(run, cut) {
    if (!viewport) return;
    if (!card) {
      card = document.createElement('div');
      card.className = 'mission-run-card';
      card.setAttribute('aria-hidden', 'true');  // the status line and toast already announce the result
      viewport.append(card);
    }
    card.innerHTML = '';
    let rows;
    if (run.kind === 'cover') {
      rows = [['mission-run-head', 'Floor covered!'], ['mission-run-metres', run.area ? `${run.area.toFixed(1)} m²` : `${run.metres.toFixed(1)} m`],
        ['mission-run-best', run.area ? `Path ${run.metres.toFixed(1)} m to cover it` : 'Path to cover the floor it can reach'],
        ['mission-run-note', 'Simulated route']];
    } else {
      const headline = cut ? `${cut.toFixed(1)} m shorter!` : run.newShortest && run.previous !== null ? 'New shortest route!' : 'Route found!';
      rows = [['mission-run-head', headline], ['mission-run-metres', `${run.metres.toFixed(1)} m`],
        ['mission-run-best', run.previous === null ? 'First route to here for this robot' : `Shortest so far: ${Math.min(run.previous, run.metres).toFixed(1)} m`],
        ['mission-run-note', 'Simulated route']];
    }
    for (const [cls, text] of rows) { const p = document.createElement('p'); p.className = cls; p.textContent = text; card.append(p); }
    card.dataset.tone = cut || (run.newShortest && run.previous !== null) ? 'win' : 'plain';
    card.classList.remove('show'); void card.offsetWidth; card.classList.add('show');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => card?.classList.remove('show'), 6000);
  }

  function handle(event) {
    const before = progress;
    const { progress: after, outcome } = applyEvent(before, event);
    progress = after;
    save();
    hud();
    if (outcome.run) runCard(outcome.run, outcome.cut);
    const earned = newlyEarned(before, after);
    if (earned.length) {
      const stars = totalStars(after), level = levelFor(stars), previousLevel = levelFor(totalStars(before));
      const lines = earned.map(({ mission, to }) => ['mission-toast-title', `${starText(to, mission.stars)}  ${mission.title}`]);
      if (level.number > previousLevel.number) lines.push(['mission-toast-level', `Level ${level.number}: ${level.name}!`]);
      else lines.push(['mission-toast-sub', `${stars} of ${TOTAL_STARS} stars`]);
      // Always say what to try next, so the loop keeps going without opening the board.
      const upNext = nextMission(after);
      if (upNext) lines.push(['mission-toast-next', `Next: ${upNext.goal}`]);
      celebrate(lines, true);
      if (studio?.open === 'missions') renderPanel();
    } else if (outcome.cut) {
      celebrate([['mission-toast-title', `${outcome.cut.toFixed(1)} m shorter`], ['mission-toast-sub', 'Shortcut: beat your best cut for more stars']], false);
    }
  }
  document.addEventListener('world:event', e => handle(e.detail));

  function renderPanel() {
    const stars = totalStars(progress), level = levelFor(stars);
    const root = document.createElement('div');
    root.className = 'mission-board';
    const head = document.createElement('div');
    head.className = 'studio-panel-head mission-head';
    head.innerHTML = '<span class="studio-panel-icon mission-trophy" aria-hidden="true">★</span><div><h2></h2><p></p></div><p class="studio-panel-count"></p>';
    head.querySelector('h2').textContent = `Level ${level.number}: ${level.name}`;
    head.querySelector('div p').textContent = level.next ? `${level.toNext} more star${level.toNext === 1 ? '' : 's'} to ${level.next.name}. Every star comes from a real simulated run or action here.` : 'Every mission complete. Try beating your shortest routes.';
    head.querySelector('.studio-panel-count').textContent = `${stars} of ${TOTAL_STARS} stars`;
    const bar = document.createElement('div');
    bar.className = 'mission-progress';
    bar.innerHTML = '<span></span>';
    bar.querySelector('span').style.width = `${Math.round((stars / TOTAL_STARS) * 100)}%`;
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${stars} of ${TOTAL_STARS} stars`);
    const grid = document.createElement('div');
    grid.className = 'studio-tools mission-grid';
    for (const mission of MISSIONS) {
      const earned = missionStars(mission.id, progress);
      const item = document.createElement('div');
      item.className = 'mission-card';
      item.dataset.mission = mission.id;
      item.dataset.done = String(earned === mission.stars);
      if (nextMission(progress)?.id === mission.id) item.dataset.next = 'true';
      item.innerHTML = '<div class="mission-card-head"><span class="mission-icon" aria-hidden="true"></span><strong></strong><span class="mission-stars"></span></div><p class="mission-goal"></p><p class="mission-how"></p><button type="button" class="mission-go"></button>';
      item.querySelector('.mission-icon').textContent = mission.icon;
      item.querySelector('strong').textContent = mission.title;
      const starsNode = item.querySelector('.mission-stars');
      starsNode.textContent = starText(earned, mission.stars);
      starsNode.setAttribute('aria-label', `${earned} of ${mission.stars} star${mission.stars === 1 ? '' : 's'}`);
      item.querySelector('.mission-goal').textContent = mission.goal;
      item.querySelector('.mission-how').textContent = mission.how;
      const go = item.querySelector('.mission-go');
      go.dataset.missionShow = mission.show;
      go.textContent = earned === mission.stars ? 'Play again' : 'Show me';
      grid.append(item);
    }
    const foot = document.createElement('div');
    foot.className = 'mission-foot';
    foot.innerHTML = '<button type="button" class="mission-sound" aria-pressed="false"></button><button type="button" class="mission-reset">Start missions again</button><p>Stars stay in this browser. Routes are simulations on the map; no robot moves.</p>';
    const soundButton = foot.querySelector('.mission-sound');
    soundButton.textContent = sound ? 'Sound: on' : 'Sound: off';
    soundButton.setAttribute('aria-pressed', String(sound));
    root.append(head, bar, grid, foot);
    root.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.missionShow) { studio.closePanel(); show(target.dataset.missionShow); }
      else if (target.classList.contains('mission-sound')) {
        sound = !sound;
        try { storage?.setItem(SOUND_KEY, sound ? 'on' : 'off'); } catch { /* this visit only */ }
        if (sound) chime();
        renderPanel();
        studio.panel.querySelector('.mission-sound')?.focus();
      } else if (target.classList.contains('mission-reset')) {
        if (!confirm('Start all missions again? Your stars and shortest routes in this browser will be cleared.')) return;
        progress = emptyProgress(); save(); hud(); renderPanel();
        studio.panel.querySelector('.mission-go')?.focus();
      }
    });
    studio.panel.replaceChildren(root);
    return root;
  }

  button.addEventListener('click', () => {
    if (studio.open === 'missions') { studio.closePanel(); return; }
    studio.openCustom('missions', button, renderPanel, 'Missions');
  });
  hud();
  return { get progress() { return progress; }, handle, renderPanel };
}
