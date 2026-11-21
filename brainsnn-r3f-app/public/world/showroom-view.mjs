import {mountRecordedViews} from './recorded-views-ui.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 500;
const HEIGHT = 290;
const mounted = new WeakMap();

function svg(tag, attributes, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node);
  return node;
}

function caption(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function sourceTime(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const tenths = Math.round(seconds * 10);
  return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
}

function frameImage(image) {
  if (typeof image !== 'string' || !image) return null;
  if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(image)) return image;
  try {
    const url = new URL(image, document.baseURI);
    if (/^https?:$/.test(url.protocol) && url.origin === location.origin) return url.href;
  } catch { /* A missing source leaves the frame visibly unavailable. */ }
  return null;
}

function fitProjection(bounds, project, elevations) {
  const [x0, z0, x1, z1] = bounds;
  const corners = [];
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) {
      for (const h of elevations) corners.push(project(x, z, h));
    }
  }
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const scale = Math.min((WIDTH - 32) / Math.max(0.01, right - left), (HEIGHT - 28) / Math.max(0.01, bottom - top));
  return (x, z, h = 0) => {
    const [u, v] = project(x, z, h);
    return [(u - (left + right) / 2) * scale + WIDTH / 2, (v - (top + bottom) / 2) * scale + HEIGHT / 2];
  };
}

function vertex([x, y]) { return x.toFixed(2) + ',' + y.toFixed(2); }

function polyline(points, project) {
  return points.map(([x, z]) => vertex(project(x, z))).join(' ');
}

function routePlayback(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i], [lastX, lastZ] = points[i - 1];
    distances.push(distances[i - 1] + Math.hypot(x - lastX, z - lastZ));
  }
  return fraction => {
    const distance = fraction * distances.at(-1);
    const i = distances.findIndex(value => value >= distance);
    if (i <= 0) return points[i === 0 ? 0 : points.length - 1];
    const t = (distance - distances[i - 1]) / (distances[i] - distances[i - 1]);
    return points[i].map((coord, axis) => points[i - 1][axis] + (coord - points[i - 1][axis]) * t);
  };
}

export function mountShowroom(root, bundle) {
  mounted.get(root)?.();
  const { objects, frames, points, bounds, unknown } = bundle;
  const byId = new Map(objects.map(object => [object.id, object]));
  const pairs = [bundle.routes, ...(bundle.comparisons || [])].filter(Boolean);
  const visible = new Set(frames.flatMap(frame => frame.observations.map(obs => obs.objectId)));
  const firstVisiblePair = pairs.find(pair => visible.has(pair.objectId));
  let selected = firstVisiblePair?.objectId ?? [...visible][0] ?? objects[0]?.id;
  let routes = firstVisiblePair ?? pairs[0];
  let pairedObject = byId.get(routes?.objectId);
  const editedCopies = new Set();
  let frameIndex = Math.max(0, frames.findIndex(frame => frame.observations.some(obs => obs.objectId === selected)));
  let copied = false, rotation = 0, sampleTimer = null, animation = null;
  let progress = 0, positionAt = null, robot = null;

  const section = document.createElement('section');
  section.className = 'showroom-view';
  section.setAttribute('aria-label', 'Linked room views');
  section.innerHTML = `
    <header class="showroom-heading">
      <div><h2 data-el="title"></h2><p data-el="description"></p></div>
      <label class="showroom-picker">Follow an object <select data-el="picker"></select></label>
    </header>
    <div class="showroom-timebar">
      <button type="button" data-el="playViews">Play views</button>
      <label>Source view <input data-el="timeline" type="range" min="0" step="1"></label>
      <output data-el="viewNumber"></output>
    </div>
    <details class="recorded-views" data-el="memory"></details>
    <div class="showroom-tabs" role="group" aria-label="Choose a view">
      <button type="button" data-tab="source">Source</button><button type="button" data-tab="boxes">Objects</button>
      <button type="button" data-tab="cloud">Points</button><button type="button" data-tab="floor">Map</button>
    </div>
    <div class="showroom-grid">
      <section class="showroom-card" data-panel="source"><h3>Source view</h3>
        <div class="showroom-photo" data-el="source"></div><p data-el="sourceNote"></p></section>
      <section class="showroom-card" data-panel="boxes"><h3>Objects in this view</h3>
        <div class="showroom-photo" data-el="boxes"></div><p data-el="boxNote"></p></section>
      <section class="showroom-card" data-panel="cloud"><div class="showroom-card-head"><h3>Room points in 3D</h3>
        <div class="showroom-rotation"><button type="button" data-el="left" aria-label="Turn points left" title="Turn left">↶</button>
        <button type="button" data-el="right" aria-label="Turn points right" title="Turn right">↷</button></div></div>
        <svg data-el="cloud" viewBox="0 0 500 290" role="img" aria-label="Room points in 3D"></svg><p data-el="cloudNote"></p></section>
      <section class="showroom-card" data-panel="floor"><h3>Floor map</h3>
        <svg data-el="floor" viewBox="0 0 500 290" role="img" aria-label="Floor map"></svg>
        <p data-el="floorNote"></p></section>
    </div>
    <section class="showroom-scenario">
      <div><h3>Try a different route</h3>
        <label class="showroom-route-picker" data-el="pairLabel">Compare a route <select data-el="pair"></select></label>
        <p data-el="routeNote"></p></div>
      <div class="showroom-comparison" data-el="comparison">
        <div><span>Original room</span><strong data-el="before"></strong></div>
        <div><span>Edited copy</span><strong data-el="after"></strong></div>
      </div>
      <div class="showroom-actions">
        <button type="button" class="showroom-change" data-el="change"></button>
        <button type="button" data-el="playRoute">Replay route</button>
      </div>
      <label class="showroom-route-scrub" data-el="scrubLabel">Route progress
        <input data-el="scrub" type="range" min="0" max="1000" step="1" value="0"><output data-el="traveled"></output></label>
    </section>
    <p class="showroom-provenance" data-el="provenance"></p>
    <div class="showroom-announce" data-el="announcement" role="status"></div>`;
  const el = Object.fromEntries([...section.querySelectorAll('[data-el]')].map(node => [node.dataset.el, node]));
  root.replaceChildren(section);
  caption(el.title, bundle.title);
  caption(el.description, bundle.description || '');
  caption(el.provenance, bundle.provenance || '');
  for (const object of objects) {
    const option = document.createElement('option');
    option.value = object.id;
    option.textContent = object.label;
    el.picker.append(option);
  }
  el.pairLabel.hidden = pairs.length < 2;
  for (const pair of pairs) {
    const option = document.createElement('option');
    option.value = pair.objectId;
    option.textContent = pair.label || byId.get(pair.objectId)?.label || pair.objectId;
    el.pair.append(option);
  }
  el.pair.value = routes?.objectId ?? '';
  el.picker.disabled = !objects.length;
  el.picker.value = selected ?? '';
  el.timeline.max = String(Math.max(0, frames.length - 1));
  el.timeline.disabled = frames.length < 2;
  el.playViews.disabled = frames.length < 2;
  const floorProject = fitProjection(bounds, (x, z) => [x, -z], [0]);
  const elevations = points.reduce(([min, max], [, , h]) => [Math.min(min, h), Math.max(max, h)], [0, 0]);
  const pointCounts = new Map();
  for (const [, , , id] of points) if (byId.has(id)) pointCounts.set(id, (pointCounts.get(id) || 0) + 1);
  let pointGroups = [], floorCamera = null;

  function switchPanel(key) {
    for (const node of section.querySelectorAll('[data-panel]')) node.dataset.active = String(node.dataset.panel === key);
    for (const node of section.querySelectorAll('[data-tab]')) node.setAttribute('aria-pressed', String(node.dataset.tab === key));
  }
  for (const node of section.querySelectorAll('[data-tab]')) node.onclick = () => switchPanel(node.dataset.tab);
  switchPanel('source');

  function stopViews() {
    clearTimeout(sampleTimer);
    sampleTimer = null;
    caption(el.playViews, 'Play views');
  }

  function setFrame(index, notify = false) {
    if (!Number.isInteger(index) || index < 0 || index >= frames.length || index === frameIndex) return;
    frameIndex = index;
    renderFrame();
    updateCloud();
    if (floorCamera) markCamera(floorCamera, floorProject);
    if (notify) root.dispatchEvent(new CustomEvent('showroom-frame-change', { bubbles: true, detail: { index } }));
  }

  function nextView() {
    if (frameIndex >= frames.length - 1) { stopViews(); return; }
    // This is a slideshow of sampled views. Original video playback is separate.
    sampleTimer = setTimeout(() => { setFrame(frameIndex + 1, true); nextView(); }, 900);
  }

  function choose(id) {
    if (!byId.has(id)) return;
    stopViews();
    const pair = pairs.find(item => item.objectId === id);
    if (pair && pair !== routes) {
      stopRoute();
      routes = pair;
      pairedObject = byId.get(pair.objectId);
      el.pair.value = id;
      copied = editedCopies.has(id);
      progress = 0;
    }
    selected = id;
    el.picker.value = id;
    // A map selection opens the nearest sampled view that actually contains the object.
    let nearest = -1;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].observations.some(obs => obs.objectId === id) &&
          (nearest < 0 || Math.abs(i - frameIndex) < Math.abs(nearest - frameIndex))) nearest = i;
    }
    const changedFrame = nearest >= 0 && nearest !== frameIndex;
    if (changedFrame) frameIndex = nearest;
    renderFrame();
    updateCloud();
    renderFloor();
    renderScenario();
    caption(el.announcement, 'Following ' + byId.get(id).label + '. ' + el.boxNote.textContent);
    // Even a tap in the current frame should pause attached original footage.
    if (nearest >= 0) root.dispatchEvent(new CustomEvent('showroom-frame-change', { bubbles: true, detail: { index: frameIndex } }));
  }

  function showImage(panel, frame, withBoxes) {
    panel.replaceChildren();
    const src = frameImage(frame?.image);
    const empty = () => {
      const note = document.createElement('span');
      note.className = 'showroom-missing';
      note.textContent = 'Source image unavailable for this view.';
      panel.replaceChildren(note);
    };
    if (!src) { empty(); return; }
    const stage = document.createElement('div');
    stage.className = 'showroom-photo-stage';
    stage.style.aspectRatio = frame.width + '/' + frame.height;
    stage.style.width = 'min(100%, ' + (58 * frame.width / frame.height) + 'cqw)';
    const img = new Image();
    img.alt = 'Room capture, view ' + (frameIndex + 1);
    img.onerror = () => { if (stage.parentElement === panel) empty(); };
    img.src = src;
    stage.append(img);
    for (const obs of frame.observations) {
      const object = byId.get(obs.objectId);
      if (!object) continue;
      const [x1, y1, x2, y2] = obs.box;
      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'showroom-hit';
      mark.dataset.marked = String(withBoxes);
      mark.dataset.selected = String(selected === object.id);
      mark.setAttribute('aria-label', 'Follow ' + object.label);
      mark.title = object.label;
      mark.style.left = (100 * x1) + '%';
      mark.style.top = (100 * y1) + '%';
      mark.style.width = (100 * (x2 - x1)) + '%';
      mark.style.height = (100 * (y2 - y1)) + '%';
      if (withBoxes && selected === object.id) {
        const label = document.createElement('span');
        label.textContent = object.label;
        mark.append(label);
      }
      mark.onclick = () => { choose(object.id); el.picker.focus({ preventScroll: true }); };
      stage.append(mark);
    }
    panel.append(stage);
  }

  function renderFrame() {
    updateMemory();
    const frame = frames[frameIndex];
    const time = sourceTime(frame?.timeSeconds);
    const view = frame ? (frameIndex + 1) + ' of ' + frames.length : 'No views';
    el.timeline.value = String(frameIndex);
    el.timeline.setAttribute('aria-valuetext', view + (time ? ', source time ' + time : ''));
    caption(el.viewNumber, view + (time ? ' · ' + time : ''));
    showImage(el.source, frame, false);
    showImage(el.boxes, frame, true);
    caption(el.sourceNote, frame ? (time ? 'Source time ' + time + '.' : 'Original time unavailable.') : 'No source frames in this room.');
    const seen = frame?.observations.some(obs => obs.objectId === selected);
    const label = byId.get(selected)?.label;
    caption(el.boxNote, label ? label + (seen ? ' is marked in this view.' : ' has no linked box in this view.') : 'No linked objects.');
  }

  function cloudProjector() {
    const angle = Math.PI * (.15 + rotation / 8);
    const c = Math.cos(angle), s = Math.sin(angle);
    return fitProjection(bounds, (x, z, h) => [c * x - s * z, -.5 * (s * x + c * z) - .866 * h], elevations);
  }

  let cloudProject, cloudCamera;
  function buildCloud() {
    el.cloud.replaceChildren();
    cloudProject = cloudProjector();
    const paths = new Map();
    for (const [x, z, h, id] of points) {
      const key = byId.has(id) ? id : null;
      const xy = vertex(cloudProject(x, z, h));
      if (!paths.has(key)) paths.set(key, []);
      paths.get(key).push('M' + xy + 'h.01');
    }
    pointGroups = [];
    for (const [id, marks] of paths) {
      const path = svg('path', { d: marks.join(''), class: 'showroom-dots', 'data-linked': String(id !== null) }, el.cloud);
      if (id !== null) path.onclick = () => choose(id);
      pointGroups.push({ id, path });
    }
    cloudCamera = svg('circle', { r: 4.5, class: 'showroom-camera' }, el.cloud);
    updateCloud();
  }

  function markCamera(node, project) {
    const camera = frames[frameIndex]?.camera;
    node.style.display = camera ? '' : 'none';
    if (camera) {
      const [x, y] = project(...camera);
      node.setAttribute('cx', x); node.setAttribute('cy', y);
    }
  }

  function updateCloud() {
    if (!cloudCamera) return;
    for (const { id, path } of pointGroups) {
      const active = id != null && id === selected;
      path.dataset.selected = String(active);
      if (active) el.cloud.insertBefore(path, cloudCamera);
    }
    markCamera(cloudCamera, cloudProject);
    const count = pointCounts.get(selected) || 0;
    const label = byId.get(selected)?.label;
    const note = count ? count.toLocaleString() + ' sample points linked to ' + label + '.' :
      label ? 'No sample points linked to ' + label + '.' : 'No object selected.';
    caption(el.cloudNote, note + (frames[frameIndex]?.camera ? ' Gold dot shows the camera on the floor.' : ''));
    el.cloud.setAttribute('aria-label', 'Room points in 3D. ' + note);
  }

  function renderFloor() {
    el.floor.replaceChildren();
    const [x0, z0, x1, z1] = bounds;
    svg('polygon', { points: polyline([[x0,z0],[x1,z0],[x1,z1],[x0,z1]], floorProject), class: 'showroom-ground' }, el.floor);
    for (const polygon of unknown) svg('polygon', { points: polyline(polygon, floorProject), class: 'showroom-unknown' }, el.floor);
    for (const object of objects) {
      if (object.polygon.length < 3) continue;
      const shape = svg('polygon', { points: polyline(object.polygon, floorProject), class: 'showroom-footprint',
        'data-selected': String(object.id === selected), 'data-removed': String(copied && object.id === pairedObject?.id) }, el.floor);
      svg('title', {}, shape).textContent = object.label;
      shape.onclick = () => choose(object.id);
    }
    const route = copied ? routes?.after : routes?.before;
    robot = null; positionAt = null;
    if (route?.points?.length >= 2) {
      const pts = route.points;
      const [sx, sy] = floorProject(...pts[0]), [gx, gy] = floorProject(...pts.at(-1));
      svg('polyline', { points: polyline(pts, floorProject), class: 'showroom-route' }, el.floor);
      svg('circle', { cx: sx, cy: sy, r: 3.5, class: 'showroom-start' }, el.floor);
      svg('rect', { x: gx-3, y: gy-3, width: 6, height: 6, class: 'showroom-goal' }, el.floor);
      robot = svg('circle', { r: 5.3, class: 'showroom-robot' }, el.floor);
      positionAt = routePlayback(pts);
      updateProgress();
    }
    floorCamera = svg('circle', { r: 4.5, class: 'showroom-camera' }, el.floor);
    markCamera(floorCamera, floorProject);
    const label = byId.get(selected)?.label;
    const marked = byId.get(selected)?.polygon.length >= 3;
    const selectedText = label ? label + (copied && selected === pairedObject?.id ? ' removed in the copy.' :
      marked ? ' outlined on the map.' : ' has no mapped footprint.') : '';
    caption(el.floorNote, [selectedText, unknown.length ? 'Shaded areas are unknown.' : '', robot ? 'The line is the simulated route.' : ''].filter(Boolean).join(' '));
    el.floor.setAttribute('aria-label', 'Floor map. ' + el.floorNote.textContent);
  }

  function stopRoute() {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    caption(el.playRoute, 'Replay route');
  }

  function meters(route) { return Number.isFinite(route?.meters) ? route.meters.toFixed(2) + ' m' : '—'; }

  function updateProgress() {
    if (!robot || !positionAt) return;
    const [x, y] = floorProject(...positionAt(progress));
    robot.setAttribute('cx', x); robot.setAttribute('cy', y);
    el.scrub.value = String(Math.round(1000 * progress));
    const traveled = Math.round(100 * progress) + '%';
    caption(el.traveled, traveled);
    el.scrub.setAttribute('aria-valuetext', traveled + ' of route');
  }

  function renderScenario() {
    const paired = pairedObject && routes?.before?.points?.length >= 2 && routes?.after?.points?.length >= 2;
    el.change.hidden = !paired;
    el.comparison.hidden = !paired;
    el.playRoute.disabled = !robot;
    el.scrubLabel.hidden = !robot;
    if (!paired) { caption(el.routeNote, robot ? 'Replay the supplied simulated route.' : 'No route comparison for this room.'); return; }
    const label = pairedObject.label;
    const chooseFirst = !copied && selected !== pairedObject.id;
    caption(el.change, copied ? 'Restore ' + label : chooseFirst ? 'Find ' + label : 'Remove ' + label + ' in a copy');
    caption(el.before, meters(routes.before));
    caption(el.after, copied ? meters(routes.after) : '—');
    // Match the two distances shown to the visitor at centimetre precision.
    const saved = (Math.round(routes.before.meters * 100) - Math.round(routes.after.meters * 100)) / 100;
    const difference = Number.isFinite(saved) ? (Math.abs(saved) < .005 ? 'Both routes have the same length.' :
      'The route is ' + Math.abs(saved).toFixed(2) + ' m ' + (saved > 0 ? 'shorter.' : 'longer.')) : '';
    caption(el.routeNote, copied ? (label + ' is removed in your copy. ' + difference).trim() :
      'Compare the two simulated routes recorded with and without ' + label + '.');
  }

  el.change.onclick = () => {
    if (!copied && selected !== pairedObject.id) { choose(pairedObject.id); return; }
    stopRoute();
    copied = !copied; progress = 0;
    if (copied) editedCopies.add(pairedObject.id);
    else editedCopies.delete(pairedObject.id);
    switchPanel('floor');
    choose(pairedObject.id);
    caption(el.announcement, el.routeNote.textContent);
  };
  el.playRoute.onclick = () => {
    if (animation !== null) { stopRoute(); return; }
    if (!positionAt) return;
    if (progress >= 1) progress = 0;
    switchPanel('floor');
    const start = performance.now() - progress * 4000;
    caption(el.playRoute, 'Pause route');
    const tick = now => {
      progress = Math.min(1, (now - start) / 4000);
      updateProgress();
      if (progress >= 1) stopRoute();
      else animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
  };
  el.scrub.oninput = () => { stopRoute(); progress = Number(el.scrub.value) / 1000; switchPanel('floor'); updateProgress(); };
  el.playViews.onclick = () => {
    if (sampleTimer !== null) { stopViews(); return; }
    if (frameIndex === frames.length - 1) setFrame(0, true);
    caption(el.playViews, 'Pause views');
    nextView();
  };
  el.timeline.oninput = () => { stopViews(); setFrame(Number(el.timeline.value), true); };
  el.picker.onchange = () => choose(el.picker.value);
  el.pair.onchange = () => choose(el.pair.value);
  el.left.onclick = () => { rotation--; buildCloud(); };
  el.right.onclick = () => { rotation++; buildCloud(); };
  const updateMemory = mountRecordedViews(el.memory, {
    frames, objects, current: () => frameIndex, selected: () => selected,
    open: index => {
      stopViews();
      if (index === frameIndex) root.dispatchEvent(new CustomEvent('showroom-frame-change', {bubbles: true, detail: {index}}));
      else setFrame(index, true);
      switchPanel('source');
    },
  });
  buildCloud();
  renderFrame();
  renderFloor();
  renderScenario();
  function dispose() {
    stopViews(); stopRoute();
    section.remove();
    if (mounted.get(root) === dispose) mounted.delete(root);
  }
  dispose.pause = () => { stopViews(); stopRoute(); };
  dispose.getFrame = () => frameIndex;
  dispose.setFrame = index => { stopViews(); setFrame(index); };
  mounted.set(root, dispose);
  return dispose;
}
