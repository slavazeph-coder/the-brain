/* BrainSNN Arena "Beat the bot": input, HUD, sound and the result card.
 * Rules live in arena-game.js. The workspace owns the canvas, its camera and
 * the practice challenge + seed, and hands them over through create(ctx). */
(() => {
  'use strict';
  const STORE = 'brainsnn.arena.game.v1', SOUND = 'brainsnn.arena.sound';
  // One 0.1 s simulation step every 50 ms: races run at 2x real time.
  const TICK_MS = 50, MAX_CATCH_UP = 5;
  const MINT = [0.392, 1, 0.824];
  const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  // Space keeps its normal job on controls; it only drops the claw elsewhere.
  const CONTROL_TAGS = /^(BUTTON|A|SUMMARY|SELECT|INPUT|TEXTAREA)$/;
  const onControl = node => { for (let el = node; el; el = el.parentElement) if (CONTROL_TAGS.test(el.tagName || '') || el.getAttribute?.('role') === 'button') return true; return false; };
  const RACE_LABEL = 'Beat the bot race. Arrow keys or W A S D move the claw, Space drops it, Escape quits.';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const G = () => window.BrainSNNArenaGame;
  const s1 = n => (Math.round(n * 10) / 10).toFixed(1);
  const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const dialogOpen = () => Boolean(document.querySelector?.('dialog[open]'));

  // A challenge link (?play=&seed=&t=) has two lives. Its level, seed and the
  // sender's claimed time stay on offer for the whole page view. Its power to
  // force the arena into local practice ends once the page's first restore is
  // done (consumeLink), so later robot or model picks behave normally.
  let link = null, linkForcing = false;
  try { link = G()?.parseLink?.(location.search) || null; linkForcing = Boolean(link); } catch { link = null; }
  function consumeLink() {
    if (!linkForcing) return;
    linkForcing = false;
    try {
      const params = new URLSearchParams(location.search);
      ['play', 'seed', 't'].forEach(key => params.delete(key));
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
    } catch { /* URL cleanup is cosmetic. */ }
  }
  // The friend's time only counts on the exact world their link names.
  function friendFor(level, seed) {
    if (!link || link.friend === null || level !== link.level) return null;
    if (link.worldSeed === undefined) link.worldSeed = G().worldSeed(link.seed);
    return seed === link.seed || seed === link.worldSeed ? link.friend : null;
  }

  function readStore() {
    try { const v = JSON.parse(localStorage.getItem(STORE) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  }
  function bestFor(level, seed) {
    const v = (readStore().best || {})[G().bestKey(level, seed)];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  function saveBest(r) {
    const previous = bestFor(r.challenge, r.seed);
    if (!r.finished || (previous !== null && previous <= r.time)) return { best: previous, isNew: false };
    const store = readStore(); store.best = { ...(store.best || {}), [G().bestKey(r.challenge, r.seed)]: r.time };
    try { localStorage.setItem(STORE, JSON.stringify(store)); } catch { /* Best times are optional. */ }
    return { best: r.time, isNew: true };
  }
  function soundOn() { try { return localStorage.getItem(SOUND) !== 'off'; } catch { return true; } }
  function setSound(on) { try { localStorage.setItem(SOUND, on ? 'on' : 'off'); } catch { /* Preference is optional. */ } }

  // Tiny synthesized cues; nothing is downloaded. Audio starts only after a click.
  let audio = null;
  function tone(notes, { type = 'sine', gain = 0.06, length = 0.09, gap = 0.07 } = {}) {
    if (!soundOn()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      notes.forEach((freq, i) => {
        const at = audio.currentTime + i * gap, osc = audio.createOscillator(), amp = audio.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq, at);
        amp.gain.setValueAtTime(0.0001, at); amp.gain.exponentialRampToValueAtTime(gain, at + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
        osc.connect(amp).connect(audio.destination); osc.start(at); osc.stop(at + length + 0.02);
      });
    } catch { /* Sound is decorative. */ }
  }
  const SFX = {
    tick: () => tone([440], { length: 0.07 }), go: () => tone([880], { length: 0.16, gain: 0.07 }),
    grab: () => tone([620, 820], { type: 'triangle', gap: 0.05 }), deliver: () => tone([880, 1175, 1568], { type: 'triangle', gap: 0.06 }),
    miss: () => tone([260, 200], { type: 'square', gain: 0.03 }), drop: () => tone([330, 220], { type: 'triangle', gain: 0.05 }),
    bonk: () => tone([120, 90], { type: 'sawtooth', gain: 0.05, length: 0.14 }), twist: () => tone([700, 500, 700], { type: 'square', gain: 0.03 }),
    win: () => tone([523, 659, 784, 1047], { type: 'triangle', gap: 0.09, length: 0.16 }), lose: () => tone([392, 330, 262], { type: 'triangle', gap: 0.12, length: 0.18 })
  };
  const buzz = ms => { try { navigator.vibrate?.(ms); } catch { /* Haptics are optional. */ } };

  /* ctx: { bar, viewport(), canvas(), camera(), level(), seed(), selectLevel(id), onStart(), onStop(), watchBot(level, seed), tryModel() } */
  function create(ctx) {
    let game = null, raf = 0, last = 0, acc = 0, paused = false, ended = false, seen = 0, timers = [], barKey = '';
    let held = new Set(), dropQueued = false, tapQueued = null, pointer = null, inputOff = [];
    let hud = null, canvasLabel = null;
    const $h = sel => hud?.querySelector(sel);
    const active = () => Boolean(game);
    const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
    // A new race always starts on the workspace's current world; while one runs,
    // its own world is what the bar and result describe.
    const workspaceWorld = () => ({ level: G().level(ctx.level?.() || 'starter').id, seed: String(ctx.seed?.() ?? '42') });
    const target = () => game ? { level: game.challenge, seed: game.seed } : workspaceWorld();

    function renderBar() {
      if (!ctx.bar) return;
      const { level, seed } = target(), info = G().level(level);
      // Keep the compact bar until the race is dismissed so the result card
      // does not jump when the intro returns above the stage.
      if (game) {
        barKey = '';
        ctx.bar.innerHTML = '<div class="game-bar-copy"><span class="game-kicker">BEAT THE BOT · ' + esc(info.name.toUpperCase()) + '</span><strong>Race the violet ghost to the tray.</strong></div>' +
          '<div class="game-bar-actions"><button class="game-chip" data-game="sound" aria-pressed="' + soundOn() + '">' + (soundOn() ? 'Sound on' : 'Sound off') + '</button><button class="game-chip" data-game="restart">Restart</button><button class="game-chip" data-game="quit">Quit <kbd>Esc</kbd></button></div>';
        return;
      }
      const best = bestFor(level, seed), friend = friendFor(level, seed);
      barKey = [level, seed, best, friend].join('|');
      ctx.bar.innerHTML = '<div class="game-bar-copy"><span class="game-kicker">BEAT THE BOT · ' + esc(info.name.toUpperCase()) + '</span><strong>' +
        (friend !== null ? 'A friend finished this in ' + s1(friend) + ' s. Your turn.' : 'You be the brain.') + '</strong>' +
        '<small>Drive the arm yourself and race the scripted arm to the tray. Same arm, same speed limit, same world. It never cuts corners. You can.</small></div>' +
        '<div class="game-bar-actions"><button class="game-play" data-game="play">▶ Race the bot</button><span class="game-best">' + (best !== null ? 'Your best here: ' + s1(best) + ' s' : esc(info.blurb)) + '</span></div>';
    }
    // Called on every workspace refresh: re-render only when the offer changed.
    function sync() {
      if (game) return;
      const { level, seed } = target();
      if ([level, seed, bestFor(level, seed), friendFor(level, seed)].join('|') !== barKey) renderBar();
    }

    function mountHUD() {
      const viewport = ctx.viewport?.();
      if (!viewport) return;
      hud?.remove();
      viewport.classList.add('is-game');
      hud = document.createElement('div');
      hud.className = 'game-hud';
      hud.innerHTML = '<div class="game-hud-top"><div class="game-clock" aria-hidden="true"><strong id="game-time">0.0</strong><span>s</span><small id="game-par"></small></div>' +
        '<div class="game-race" aria-hidden="true"><div class="game-lane you"><span>You</span><i></i><i></i><i></i></div><div class="game-lane bot"><span>Bot</span><i></i><i></i><i></i></div></div>' +
        '<button class="game-icon" data-game="quit" aria-label="Quit Beat the bot">✕</button></div>' +
        '<div class="game-countdown" aria-hidden="true"></div><div class="game-toast" aria-hidden="true"></div>' +
        '<p class="game-sr" role="status" aria-live="polite"></p>' +
        '<p class="game-hint">Arrows or WASD, or tap the table to move. Space or Drop to grab and release. Steer while the claw rises and falls to cut corners.</p>' +
        '<button class="game-drop" data-game="drop" aria-label="Drop the claw (Space)">Drop</button>' +
        '<div class="game-paused" hidden><p>Paused</p><button class="game-play" data-game="resume">Resume</button></div>' +
        '<div class="game-result" role="dialog" aria-modal="false" aria-labelledby="game-result-title" hidden></div>';
      viewport.appendChild(hud);
      hud.addEventListener('click', onClick);
      later(() => $h('.game-hint')?.classList.add('is-faded'), 7000);
    }

    function announce(text) { const sr = $h('.game-sr'); if (sr) sr.textContent = text; }
    // Classes are removed by timers as well as by the animation, so the cues
    // still appear and clear when reduced motion turns animations off.
    function flash(el, text, ms) {
      if (!el) return;
      el.textContent = text; el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on');
      clearTimeout(el._gameTimer); el._gameTimer = later(() => el.classList.remove('is-on'), ms);
    }
    function toast(text, kind) { const el = $h('.game-toast'); if (el) el.dataset.kind = kind || ''; flash(el, text, 1400); }

    function keyDir() {
      const x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0), y = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
      if (!x && !y) return null;
      // Screen-relative: "up" pushes away from the camera, "right" to screen right.
      const yaw = ctx.camera?.().yaw ?? -0.95, f = [-Math.cos(yaw), -Math.sin(yaw)], r = [-Math.sin(yaw), Math.cos(yaw)];
      const d = [r[0] * x + f[0] * y, r[1] * x + f[1] * y], m = Math.hypot(d[0], d[1]) || 1;
      return [d[0] / m, d[1] / m];
    }

    function snapTap(point) {
      const w = game.world;
      if (w.robot.carrying != null) {
        const g = w.goal;
        if (Math.abs(point[0] - g.position[0]) <= g.size[0] * 0.75 && Math.abs(point[1] - g.position[1]) <= g.size[1] * 0.75) return [g.position[0], g.position[1]];
        return point;
      }
      let best = null, bestD = 0.16;
      w.objects.forEach(o => { if (o.delivered) return; const d = Math.hypot(point[0] - o.position[0], point[1] - o.position[1]); if (d < bestD) { bestD = d; best = o; } });
      return best ? [best.position[0], best.position[1]] : point;
    }

    function bindInput() {
      unbindInput();
      const on = (el, type, fn, opts) => { if (!el) return; el.addEventListener(type, fn, opts); inputOff.push(() => el.removeEventListener(type, fn, opts)); };
      const typing = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      on(window, 'keydown', e => {
        // An open dialog (help, worker setup) owns the keyboard, Escape included.
        if (!game || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || dialogOpen()) return;
        if (e.key === 'Escape') { e.preventDefault(); quit(); return; }
        if (ended || paused) return;
        const k = KEYS[e.code] || KEYS[e.key];
        if (k) { e.preventDefault(); held.add(k); return; }
        if ((e.code === 'Space' || e.key === ' ') && !onControl(e.target)) { e.preventDefault(); if (!e.repeat) dropQueued = true; }
      }, true);
      on(window, 'keyup', e => {
        const k = KEYS[e.code] || KEYS[e.key]; if (k) held.delete(k);
        if (e.code === 'Space' && game && !ended && !paused && !dialogOpen() && !onControl(e.target)) e.preventDefault();
      }, true);
      on(window, 'blur', () => held.clear());
      const canvas = ctx.canvas?.();
      on(canvas, 'pointerdown', e => { pointer = { x: e.clientX, y: e.clientY, at: performance.now() }; });
      on(canvas, 'pointerup', e => {
        const p = pointer; pointer = null;
        if (!p || !game || ended || paused || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 || performance.now() - p.at > 600) return;
        const point = window.BrainArena3D?.pick?.(canvas, ctx.camera?.(), e.clientX, e.clientY, 0.1);
        if (point) tapQueued = snapTap(point);
      });
      on(document, 'visibilitychange', () => { if (document.hidden && game && !ended && game.phase === 'play') setPaused(true); });
    }
    function unbindInput() { inputOff.forEach(fn => fn()); inputOff = []; held.clear(); pointer = null; }

    function setPaused(value) {
      paused = value; held.clear(); dropQueued = false; tapQueued = null;
      const el = $h('.game-paused'); if (el) el.hidden = !value;
      if (!value) last = performance.now();
      if (value) announce('Paused.');
    }

    function play() {
      if (!G() || !window.BrainArena3D || !ctx.canvas?.()) return;
      stopLoop(); clearTimers();
      const { level, seed } = workspaceWorld();
      game = G().create({ challenge: level, seed });
      ended = false; paused = false; seen = 0; acc = 0; dropQueued = false; tapQueued = null;
      ctx.onStart?.();
      mountHUD(); renderBar(); bindInput();
      const canvas = ctx.canvas();
      if (canvasLabel === null) canvasLabel = canvas.getAttribute?.('aria-label') ?? '';
      canvas.setAttribute?.('aria-label', RACE_LABEL);
      canvas.focus?.({ preventScroll: true });
      ctx.viewport?.()?.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
      $h('#game-par').textContent = 'Bot ' + s1(game.bot.time) + ' s';
      const quick = reducedMotion();
      announce('Beat the bot: ' + G().level(level).name + '. The scripted arm takes ' + s1(game.bot.time) + ' seconds. ' + (quick ? 'Go!' : 'Starting in three.'));
      (quick ? ['GO'] : ['3', '2', '1', 'GO']).forEach((text, i) => later(() => {
        flash($h('.game-countdown'), text, text === 'GO' ? 700 : 400);
        if (text === 'GO') { SFX.go(); G().start(game); last = performance.now(); if (!quick) announce('Go!'); } else SFX.tick();
      }, i * 420));
      loop();
    }

    function loop() {
      stopLoop();
      const frame = now => {
        raf = requestAnimationFrame(frame);
        if (!game) return;
        if (game.phase === 'play' && !paused && dialogOpen()) setPaused(true);
        if (game.phase === 'play' && !paused) {
          acc += Math.min(250, Math.max(0, now - last)); last = now;
          let n = 0;
          while (acc >= TICK_MS && n < MAX_CATCH_UP && game.phase === 'play') { acc -= TICK_MS; n++; stepOnce(); }
          if (n === MAX_CATCH_UP) acc = 0;
        }
        draw(now);
        if (!ended && ['won', 'timeout'].includes(game.phase)) finish();
      };
      raf = requestAnimationFrame(frame);
    }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function stepOnce() {
      G().tick(game, { dir: keyDir(), tap: tapQueued, drop: dropQueued });
      tapQueued = null; dropQueued = false;
      game.feed.filter(x => x.id > seen).forEach(x => {
        seen = x.id; toast(x.text, x.kind); announce(x.text);
        SFX[x.kind]?.();
        if (x.kind === 'bonk') buzz(40); if (x.kind === 'deliver') buzz(20);
      });
    }

    function draw(now) {
      const canvas = ctx.canvas?.();
      if (!game || !canvas || !window.BrainArena3D) return;
      const w = game.world, alpha = game.phase === 'play' && !paused ? Math.min(1, acc / TICK_MS) : 1;
      const cur = w.robot.position, prev = game.prev || cur;
      const p = [0, 1, 2].map(i => prev[i] + (cur[i] - prev[i]) * alpha);
      const carried = w.robot.carrying;
      const view = { ...(ctx.camera?.() || {}), showTarget: false, renderTime: (now || performance.now()) / 1000 };
      const state = { ...w, robot: { ...w.robot, position: p, target: p }, objects: w.objects.map((o, i) => i === carried ? { ...o, position: p } : o) };
      const under = game.phase === 'play' ? G().underClaw(game) : null;
      const block = under && under !== 'tray' && under !== 'table' ? w.objects.find(o => o.id === under) : null;
      view.claw = { beam: game.phase === 'play', color: under === 'tray' ? MINT : block ? block.color : null };
      const ghost = G().botAt(game, Math.max(0, w.time - G().DT * (1 - alpha)));
      view.ghost = { position: ghost.position, carrying: ghost.carrying };
      window.BrainArena3D.render(canvas, state, view);
      updateHUD(ghost);
    }

    function updateHUD(ghost) {
      if (!hud || !game) return;
      const t = $h('#game-time'); if (t) t.textContent = s1(game.world.time);
      const lane = (sel, n) => hud.querySelectorAll(sel + ' i').forEach((el, i) => el.classList.toggle('is-done', i < n));
      lane('.game-lane.you', game.world.delivered); lane('.game-lane.bot', ghost.delivered);
      const bot = $h('.game-lane.bot'); if (bot) bot.classList.toggle('is-finished', ghost.finished);
      const drop = $h('.game-drop');
      if (drop) { drop.textContent = game.world.robot.carrying != null ? 'Release' : 'Drop'; drop.disabled = game.phase !== 'play' || paused; }
    }

    function finish() {
      ended = true; held.clear(); hud?.classList.add('is-ended');
      const r = G().result(game), saved = saveBest(r), next = G().nextLevel(r.challenge), friend = friendFor(r.challenge, r.seed);
      const headline = !r.finished ? 'Time’s up' : r.delta < 0 ? 'You beat the bot by ' + s1(-r.delta) + ' s' : r.delta === 0 ? 'Dead heat' : 'The bot wins by ' + s1(r.delta) + ' s';
      (r.beatBot ? SFX.win : SFX.lose)(); if (r.beatBot) buzz(60);
      const stars = [1, 2, 3].map(i => '<span class="' + (i <= r.stars ? 'on' : '') + '">★</span>').join('');
      const box = $h('.game-result');
      if (box) {
        box.innerHTML = '<div class="game-stars" role="img" aria-label="' + r.stars + ' of 3 stars">' + stars + '</div>' +
          '<h3 id="game-result-title">' + headline + '</h3>' +
          '<p class="game-times"><b>You ' + (r.finished ? s1(r.time) + ' s' : r.delivered + ' / 3 blocks') + '</b><span>Bot ' + s1(r.botTime) + ' s</span>' + (saved.best !== null ? '<span>' + (saved.isNew ? 'New best' : 'Best ' + s1(saved.best) + ' s') + '</span>' : '') + '</p>' +
          (friend !== null && r.finished ? '<p class="game-friend">' + (r.time < friend ? 'You beat your friend’s ' + s1(friend) + ' s.' : r.time === friend ? 'You matched your friend’s ' + s1(friend) + ' s.' : 'Your friend’s ' + s1(friend) + ' s still stands.') + '</p>' : '') +
          '<p class="game-stats">' + r.contacts + ' bonks · ' + r.misses + ' missed grabs · ' + r.drops + ' dropped blocks</p>' +
          '<div class="game-result-actions"><button class="game-play" data-game="play">↺ Play again</button><button class="game-chip" data-game="next">' + esc(next.name) + ' →</button><button class="game-chip" data-game="share">Share</button></div>' +
          '<p class="game-legend">★ finish · ★★ beat the bot · ★★★ beat it by ' + G().THREE_STAR_MARGIN + ' s with no bonks</p>' +
          '<div class="game-result-links"><button class="game-link" data-game="watch">Watch the bot’s run</button><button class="game-link" data-game="model">Think a model can beat you? Connect one →</button></div>';
        box.hidden = false;
        later(() => box.querySelector('[data-game="play"]')?.focus({ preventScroll: true }), 60);
      }
      announce(headline + '. You ' + (r.finished ? s1(r.time) + ' seconds' : 'did not finish') + ', bot ' + s1(r.botTime) + ' seconds.');
      game.lastResult = r;
    }

    async function share() {
      const r = game?.lastResult; if (!r) return;
      const url = G().shareURL(location.origin, r.challenge, r.seed, r.finished ? r.time : null), text = G().shareText(r);
      if (navigator.share) {
        try { await navigator.share({ title: 'BrainSNN Arena · Beat the bot', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(text + ' ' + url); toast('Link copied. Send it to someone.', 'deliver'); }
      catch { window.prompt?.('Copy this link', url); }
    }

    function quit(refocus = true) {
      if (!game) return;
      stopLoop(); clearTimers(); unbindInput();
      game = null; ended = false; paused = false;
      hud?.remove(); hud = null;
      ctx.viewport?.()?.classList.remove('is-game');
      const canvas = ctx.canvas?.();
      if (canvas && canvasLabel !== null) canvas.setAttribute?.('aria-label', canvasLabel);
      canvasLabel = null;
      renderBar();
      ctx.onStop?.();
      if (refocus) ctx.bar?.querySelector('[data-game="play"]')?.focus?.({ preventScroll: true });
    }

    function onClick(e) {
      const action = e.target.closest?.('[data-game]')?.dataset.game;
      if (!action) return;
      if (action === 'play' || action === 'restart') play();
      else if (action === 'quit') quit();
      else if (action === 'drop') { if (!paused && !ended) dropQueued = true; ctx.canvas?.()?.focus?.({ preventScroll: true }); }
      else if (action === 'resume') { setPaused(false); ctx.canvas?.()?.focus?.({ preventScroll: true }); }
      else if (action === 'sound') { setSound(!soundOn()); renderBar(); if (game) ctx.canvas?.()?.focus?.({ preventScroll: true }); }
      else if (action === 'next') { ctx.selectLevel?.(G().nextLevel(target().level).id); play(); }
      else if (action === 'share') share();
      else if (action === 'watch') { const { level, seed } = target(); quit(false); ctx.watchBot?.(level, seed); ctx.canvas?.()?.focus?.({ preventScroll: true }); }
      else if (action === 'model') { quit(false); ctx.tryModel?.(); }
    }

    ctx.bar?.addEventListener('click', onClick);
    renderBar();

    return {
      active,
      sync,
      draw: () => { if (game) draw(performance.now()); },
      play,
      quit,
      destroy() { quit(false); ctx.bar?.removeEventListener('click', onClick); if (ctx.bar) ctx.bar.innerHTML = ''; },
      state: () => game ? { active: true, phase: game.phase, level: game.challenge, seed: game.seed, time: game.world.time, delivered: game.world.delivered,
        botTime: game.bot.time, claw: game.claw, robot: game.world.robot.position.slice(), carrying: game.world.robot.carrying != null,
        tray: game.world.goal.position.slice(0, 2), blocks: game.world.objects.filter(o => !o.delivered).map(o => o.position.slice(0, 2)),
        paused, ended, result: game.lastResult || null } : { active: false, ...target(), friend: friendFor(target().level, target().seed) }
    };
  }

  window.BrainSNNArenaGameUI = Object.freeze({ create, pendingLink: () => linkForcing ? link : null, consumeLink });
})();
