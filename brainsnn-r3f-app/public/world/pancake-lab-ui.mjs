import { PANCAKE_ACTION_LIMIT, createPancake, pancakeEpisode, readPancake, stepPancake } from './pancake-material.mjs';

const actionLabels = {
  stir: 'Stir batter',
  heat: 'Add heat',
  flip: 'Flip over',
  press: 'Press gently',
  cool: 'Cool down',
  serve: 'Serve',
};

const results = {
  cooked: 'Both sides are cooked. You made a pancake!',
  burnt: 'This pancake burnt. With a fresh batch, try flipping sooner.',
  unmixed: 'Some flour stayed dry. With a fresh batch, stir before adding heat.',
  undercooked: 'At least one side still needs more cooking. With a fresh batch, cook both sides before serving.',
};

const nextHints = {
  stir: 'Choose “Stir batter” to mix the flour and liquid.',
  heat: 'Choose “Add heat” to cook the side touching the pan.',
  flip: 'Choose “Flip over” to cook the other side.',
  serve: 'Both sides are ready. Choose “Serve” to put your pancake on the plate.',
};

const percent = value => Math.round(value * 100) + '%';

function nextHint(state, reading) {
  if (state.served) return results[reading.outcome];
  if (reading.stage === 'unmixed') return 'The batter is firm with dry patches. Choose “Serve” to see how it turned out, or start again.';
  if (reading.stage === 'burnt') return 'Your pancake has burnt. Choose “Serve” to see the result, or start again.';
  if (reading.nextAction === 'serve' && reading.outcome !== 'ready') return 'Choose “Serve” to finish this run.';
  return nextHints[reading.nextAction];
}

function describeChange(action, before, after, state) {
  switch (action) {
    case 'stir': return after.mix > before.mix + 0.001 ? 'The batter is now ' + percent(after.mix) + ' mixed.' : 'The batter stayed about the same when you stirred it.';
    case 'heat': return 'You added heat. The side touching the pan is ' + percent(after.bottomSet) + ' firm.';
    case 'flip': return 'You turned the pancake over. Side ' + (2 - state.sideDown) + ' is now facing up.';
    case 'press': return after.indent > 0.5 ? 'The soft batter sank deeply under your press.' : 'The firm pancake held its shape better and took a shallow dent.';
    case 'cool': return 'You let the pancake cool. Its warmth is now ' + percent(after.temperature) + '.';
    default: return '';
  }
}

function circle(ctx, x, y, radius, fill) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
}

function radial(ctx, x, y, radius, stops) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

// Every patch uses its own flour, liquid, firmness and browning. Flipping shows the opposite field.
function batterColor(flour, liquid, firmness, char, heat) {
  const flourShare = flour / Math.max(0.0001, flour + liquid);
  const toast = Math.min(1, firmness * 0.92 + heat * 0.08);
  const raw = [167 + 88 * flourShare, 130 + 118 * flourShare, 81 + 150 * flourShare];
  const golden = [210, 145, 71];
  const browning = 1 - (1 - char) ** 2.5;
  const burnt = [47, 33, 29];
  return raw.map((channel, i) => Math.round((channel * (1 - toast) + golden[i] * toast) * (1 - browning) + burnt[i] * browning));
}

function drawBatter(ctx, state, reading) {
  const face = 1 - state.sideDown;
  const flipped = state.sideDown === 1 ? -1 : 1;
  ctx.save();
  ctx.scale(flipped, 1);
  const crust = new Path2D();
  for (let i = 0; i < 128; i++) {
    const angle = i * Math.PI / 64;
    const radius = 101 + 2.8 * Math.cos(3 * angle + 0.8) + 2.4 * Math.sin(5 * angle) + 1.6 * Math.cos(9 * angle);
    const x = radius * Math.cos(angle), y = radius * Math.sin(angle) * 0.95;
    if (!i) crust.moveTo(x, y);
    else crust.lineTo(x, y);
  }
  crust.closePath();
  const average = batterColor(1, 1, reading.topSet, reading.topChar, reading.temperature);
  ctx.shadowColor = '#030507b3';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = 'rgb(' + average.join(',') + ')';
  ctx.fill(crust);
  ctx.shadowColor = 'transparent';
  ctx.clip(crust);

  for (const cell of state.cells) {
    const x = cell.x * 24, y = cell.y * 23;
    const color = batterColor(cell.flour, cell.liquid, cell.set[face], cell.char[face], cell.heat[face]).join(',');
    const patch = radial(ctx, x, y, 32, [[0,'rgba(' + color + ',1)'],[0.48,'rgba(' + color + ',0.94)'],[1,'rgba(' + color + ',0)']]);
    circle(ctx, x, y, 32, patch);
  }
  for (const cell of state.cells) {
    const x = cell.x * 24, y = cell.y * 23;
    const seed = (cell.x + 5) * 101 + (cell.y + 5) * 37 + face * 543;
    const set = cell.set[face], char = cell.char[face];
    for (let i = 0; i < 16; i++) {
      const a = Math.sin(seed + i * 17) * 43758.5453;
      const b = Math.sin(seed + i * 29 + 7) * 19642.349;
      const dx = (a - Math.floor(a) - 0.5) * 27, dy = (b - Math.floor(b) - 0.5) * 27;
      const px = x + dx, py = y + dy;
      if (i < 3) {
        const r = 4 + i * 2;
        const light = (0.1 + 0.34 * set) * (1 - char);
        const patch = radial(ctx, px, py, r, [[0,'rgba(255,222,159,' + light + ')'],[1,'#ffde9f00']]);
        circle(ctx, px, py, r, patch);
      } else {
        const alpha = 0.03 + set * 0.17 + char * 0.35;
        const r = 0.45 + (i % 4) * 0.37;
        circle(ctx, px, py, r, 'rgba(79,38,16,' + alpha + ')');
      }
    }
    if (cell.indent > 0.008) {
      const depth = Math.min(0.55, cell.indent * 0.65);
      circle(ctx, x, y, 21, radial(ctx, x, y, 21, [[0,'rgba(64,34,20,' + depth + ')'],[1,'rgba(64,34,20,0)']]));
    }
  }
  ctx.strokeStyle = 'rgba(255,224,157,' + (0.12 + reading.topSet * 0.36) * (1 - reading.topChar) + ')';
  ctx.lineWidth = 7;
  ctx.stroke(crust);
  ctx.strokeStyle = 'rgba(141,83,31,' + (0.20 + reading.topSet * 0.23) + ')';
  ctx.lineWidth = 2;
  ctx.stroke(crust);
  ctx.restore();
}

function drawPan(canvas, state, reading) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const {width, height} = canvas;
  const counter = ctx.createLinearGradient(0, 0, width, height);
  counter.addColorStop(0, '#263949');
  counter.addColorStop(1, '#101b27');
  ctx.fillStyle = counter;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(state.served ? width / 2 : 256, height / 2);
  if (state.served) {
    ctx.shadowColor = '#060e17aa';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 7;
    circle(ctx, 0, 0, 141, '#c9e0db');
    ctx.shadowColor = 'transparent';
    circle(ctx, 0, 0, 138, radial(ctx, 0, 0, 138, [[0,'#f0f2e4'],[0.76,'#e8eee1'],[0.82,'#b7cec7'],[0.89,'#e8f0e2'],[0.97,'#d9e6de'],[1,'#83a69e']]));
  } else {
    circle(ctx, 0, 2, 146, '#15222d');
    const warmth = reading.temperature;
    ctx.strokeStyle = 'rgba(255,151,83,' + (0.10 + warmth * 0.72) + ')';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 142, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.rotate(0.29);
    ctx.lineCap = 'round';
    for (const [start, end, lineWidth, color] of [[120,277,25,'#0d1319'],[122,167,17,'#78838a'],[163,277,20,'#3b4850'],[163,275,13,'#495861']]) {
      ctx.beginPath();
      ctx.moveTo(start, 0);
      ctx.lineTo(end, 0);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    circle(ctx, 277, 0, 4, '#18242e');
    ctx.restore();
    circle(ctx, 0, 0, 133, radial(ctx, 0, 0, 133, [[0,'#364450'],[0.79,'#2c3943'],[0.88,'#212d37'],[0.94,'#17222c'],[0.97,'#64747d'],[0.99,'#849197'],[1,'#2b3842']]));
  }
  drawBatter(ctx, state, reading);
  ctx.restore();
}

export function mountPancakeLab(host) {
  const root = host.ownerDocument.createElement('section');
  root.className = 'pancake-lab';
  root.setAttribute('aria-label', 'Pancake cooking experiment');
  root.innerHTML = `
    <p class="pancake-intro">Can you cook both sides of a pancake? Try one move at a time. The pan waits for you.</p>
    <div class="pancake-workbench">
      <figure class="pancake-pan">
        <canvas width="560" height="314" role="img" aria-label="Pancake in a pan"></canvas>
        <figcaption><span data-face></span><span data-count></span></figcaption>
      </figure>
      <div class="pancake-controls">
        <div class="pancake-feedback" role="status" aria-atomic="true">
          <strong data-state></strong>
          <p data-hint></p>
        </div>
        <div class="pancake-moves" role="group" aria-label="Cooking moves">
          ${Object.entries(actionLabels).map(([action, label]) => `<button type="button" data-move="${action}">${label}</button>`).join('')}
        </div>
      </div>
    </div>
    <details class="pancake-readings"><summary>Check the measurements</summary>
      <dl>
        <div><dt>Mixed together</dt><dd data-metric="mix"></dd></div>
        <div><dt>Facing up · firmness</dt><dd data-metric="topSet"></dd></div>
        <div><dt>Underneath · firmness</dt><dd data-metric="bottomSet"></dd></div>
        <div><dt>Charring on the darker side</dt><dd data-metric="char"></dd></div>
        <div><dt>Warmth</dt><dd data-metric="temperature"></dd></div>
        <div><dt>Dent depth</dt><dd data-metric="indent"></dd></div>
      </dl>
    </details>
    <div class="pancake-tools">
      <button type="button" data-reset>Start again</button>
      <button type="button" data-save>Save my steps (.json)</button>
    </div>`;
  host.append(root);
  const get = selector => root.querySelector(selector);
  const canvas = get('canvas');
  const buttons = Array.from(root.querySelectorAll('[data-move]'));
  const metrics = Array.from(root.querySelectorAll('[data-metric]'));
  let state = createPancake();
  let reading = readPancake(state);

  function render(message = '') {
    const side = 'Side ' + (2 - state.sideDown) + ' faces up';
    const count = state.actions.length;
    get('[data-face]').textContent = (state.served ? 'On the plate' : 'In the pan') + ' · ' + side;
    get('[data-count]').textContent = count + (count === 1 ? ' move' : ' moves');
    get('[data-state]').textContent = state.served ? 'Pancake served' : message || 'Your first move';
    get('[data-hint]').textContent = nextHint(state, reading);
    for (const button of buttons) {
      const action = button.dataset.move;
      button.toggleAttribute('data-suggested', !state.served && action === reading.nextAction);
      button.disabled = state.served || (count >= PANCAKE_ACTION_LIMIT - 1 && action !== 'serve');
    }
    for (const metric of metrics) metric.textContent = percent(reading[metric.dataset.metric]);
    canvas.setAttribute('aria-label', (state.served ? 'Pancake on a plate. ' : 'Pancake in a pan. ') + side + '. This side is ' + percent(reading.topSet) + ' firm.');
    drawPan(canvas, state, reading);
  }

  function handleClick(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button) || button.disabled) return;
    if (button.hasAttribute('data-move')) {
      const action = button.dataset.move;
      const before = reading;
      const wasFocused = root.ownerDocument.activeElement === button;
      state = stepPancake(state, action);
      reading = readPancake(state);
      render(describeChange(action, before, reading, state));
      if (button.disabled && wasFocused) (state.served ? get('[data-reset]') : get('[data-move="serve"]')).focus({preventScroll:true});
    } else if (button.hasAttribute('data-reset')) {
      state = createPancake();
      reading = readPancake(state);
      render('You have fresh batter.');
    } else if (button.hasAttribute('data-save')) {
      const blob = new Blob([JSON.stringify(pancakeEpisode(state), null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const link = root.ownerDocument.createElement('a');
      link.href = url;
      link.download = 'pancake-cooking-steps.json';
      link.hidden = true;
      root.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  render();
  root.addEventListener('click', handleClick);
  return () => {
    root.removeEventListener('click', handleClick);
    root.remove();
  };
}
