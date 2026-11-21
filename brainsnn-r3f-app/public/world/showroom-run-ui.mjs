import {buildShowroomEpisodeScene} from './showroom-episode-physics.mjs';
import {makeShowroomEpisodeUSD} from './showroom-episode-usd.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

function defaultWorker() {
  return new Worker(new URL('./showroom-episode-worker.mjs', import.meta.url),
    {type:'module', name:'showroom-cart-simulation'});
}

function mapShape(parent, name, attrs) {
  const shape = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
  parent.append(shape);
  return shape;
}

function placeMarker(marker, coord, project) {
  const [x,y] = project(...coord);
  marker.setAttribute('cx', x);
  marker.setAttribute('cy', y);
}

function mapPoints(points, project) {
  return points.map(point => project(...point).map(n => n.toFixed(2)).join(',')).join(' ');
}

function drawMap(map, scene, project) {
  map.replaceChildren();
  const [xmin, zmin, xmax, zmax] = scene.bounds;
  mapShape(map, 'polygon', {class:'run-floor', points:mapPoints([
    [xmin,zmin], [xmin,zmax], [xmax,zmax], [xmax,zmin],
  ], project)});
  for (const obstacle of scene.obstacles) {
    mapShape(map, 'polygon', {class:obstacle.kind === 'unknown' ? 'run-unknown' : 'run-obstacle',
      points:mapPoints(obstacle.polygon, project)});
  }
  mapShape(map, 'polyline', {class:'run-plan', points:mapPoints(scene.route, project)});
  const trace = mapShape(map, 'polyline', {class:'run-trail'});
  const [x,y] = project(...scene.route.at(-1));
  mapShape(map, 'rect', {class:'run-goal', x:x-5, y:y-5, width:10, height:10});
  const cart = mapShape(map, 'circle', {class:'run-cart', r:5});
  placeMarker(cart, scene.route[0], project);
  return {cart, trace};
}

export function mountShowroomRun(host, room, {project, initialObject, initialScene, createRunWorker = defaultWorker}) {
  host.innerHTML = `<summary>Record a robot run</summary>
    <p data-run-lead>Can a delivery cart reach the square? Try the trip with an object in place, then try it with the object removed.</p>
    <div class="run-setup">
      <label>Object to try<select data-run-object></select></label>
      <label>Room to test<select data-run-variant><option value="before">Original room</option><option value="after">Object removed</option></select></label>
      <label>Driver<select data-run-driver><option value="waypoint">Follow the route</option><option value="imitation">Learned driver</option></select></label>
      <button type="button" data-run-start disabled>Record run</button>
    </div>
    <figure>
      <svg data-run-map viewBox="0 0 500 290" role="img" aria-label="Map of the delivery cart's trip"></svg>
      <figcaption>The dashed line is the planned path. The dot is the cart and the square is its goal.</figcaption>
    </figure>
    <p data-run-status role="status"></p>
    <div data-run-result hidden>
      <div class="run-replay">
        <button type="button" data-run-play>Play recording</button>
        <label>Recording time<input data-run-step type="range" min="0" value="0" step="1"></label>
        <span data-run-clock aria-hidden="true"></span>
      </div>
      <details class="run-evidence"><summary>What did we record?</summary>
        <p data-run-evidence></p><p data-run-contact></p><p data-run-sample></p>
      </details>
      <div class="run-files"><a data-run-json download="showroom-run.json">Save recording (.json)</a>
        <a data-run-xml download="showroom-room.xml">Save MuJoCo scene (.xml)</a>
        <a data-run-usd download="showroom-replay.usda">Save 3D replay (.usda)</a></div>
    </div>`;
  const field = key => host.querySelector('[data-run-' + key + ']');
  const chooser = field('object'), variant = field('variant'), start = field('start');
  const driver = field('driver');
  const slider = field('step'), play = field('play'), map = field('map'), result = field('result'), status = field('status');
  if (initialScene) {
    chooser.parentElement.hidden = variant.parentElement.hidden = true;
    field('lead').textContent = 'Can a delivery cart follow the path on your map? Choose a driver, then record the trip.';
  }
  const pairs = initialScene ? [] : [room.routes, ...(room.comparisons || [])].filter(Boolean);
  for (const pair of pairs) {
    const label = room.objects.find(object => object.id === pair.objectId)?.label || pair.objectId;
    chooser.add(new Option(label, pair.objectId));
  }
  if (pairs.some(pair => pair.objectId === initialObject)) chooser.value = initialObject;
  let scene, drawing, episode, worker, timeout, timer, request = 0, disposed = false;
  let downloadUrls = [];
  const unavailable = typeof Worker !== 'function' || (location.protocol === 'file:' && createRunWorker === defaultWorker);

  function stopPlayback() {
    if (timer !== undefined) cancelAnimationFrame(timer);
    timer = undefined;
    play.textContent = 'Play recording';
  }

  function stopRun() {
    clearTimeout(timeout);
    worker?.terminate();
    worker = undefined;
    start.textContent = 'Record run';
  }

  function pause() {
    stopPlayback();
    if (worker) {
      stopRun();
      status.textContent = 'Recording stopped. You can start it again.';
    }
  }

  function clearResult() {
    stopPlayback();
    episode = undefined;
    result.hidden = true;
    for (const key of ['json','xml','usd']) field(key).removeAttribute('href');
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    downloadUrls = [];
  }

  function refreshScene() {
    stopRun();
    clearResult();
    scene = undefined;
    drawing = undefined;
    map.replaceChildren();
    start.disabled = true;
    try {
      scene = initialScene || buildShowroomEpisodeScene(room, {objectId:chooser.value, variant:variant.value});
      drawing = drawMap(map, scene, project);
      if (unavailable) {
        status.textContent = 'This copy can show your route. Open the World Builder website to record a run.';
        return;
      }
      start.disabled = false;
      status.textContent = 'Ready to record a simulated trip on this device.';
    } catch (error) {
      status.textContent = error.message || 'This room needs a usable floor map and route.';
    }
  }

  function showFrame(index) {
    const frame = episode.frames[index];
    const seconds = frame.time.toFixed(1) + ' s';
    slider.value = String(index);
    slider.setAttribute('aria-valuetext', seconds + ' of ' + episode.frames.at(-1).time.toFixed(1) + ' seconds');
    field('clock').textContent = seconds;
    placeMarker(drawing.cart, frame.position, project);
    const speed = Math.hypot(...frame.velocity).toFixed(2);
    const speedCommand = frame.action ? 'The controller requested ' + Math.hypot(...frame.action).toFixed(2) + ' m/s.' : 'End of recording.';
    field('sample').textContent = 'At ' + seconds + ' the cart was moving at ' + speed + ' m/s. ' + speedCommand;
  }

  function addFile(key, bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], {type}));
    field(key).href = url;
    downloadUrls.push(url);
  }

  function finishRun(data) {
    episode = data;
    const {frames, score} = episode;
    drawing.trace.setAttribute('points', mapPoints(frames.map(f => f.position), project));
    slider.max = String(frames.length - 1);
    slider.disabled = play.disabled = frames.length < 2;
    const reason = {
      'goal-reached':'The cart reached its goal.',
      'contact':'The cart touched an obstacle and stopped.',
      'timeout':'The cart ran out of time.',
    };
    status.textContent = (reason[score.reason] || 'The run ended.') + ' It traveled ' + score.distanceMeters.toFixed(2) +
      ' m in ' + frames.at(-1).time.toFixed(1) + ' seconds.';
    const driverNote = episode.provenance.controllerKind === 'imitation'
      ? 'The driver learned how to follow a path from example runs. ' : 'A fixed controller followed the saved path. ';
    field('evidence').textContent = driverNote + frames.length + ' simulated samples include position, speed, commands and contact with obstacles. ' +
      'MuJoCo ' + episode.engine.version + ' used solid shapes from the floor map and blocked unknown areas. ' +
      'The solid line shows the recorded motion.';
    const names = score.contactNames.map(name => {
      const obstacle = scene.obstacles.find(item => item.name === name);
      return obstacle?.label || (obstacle?.kind === 'unknown' ? 'an unknown area' : name.replaceAll('_', ' '));
    });
    field('contact').textContent = (names.length ? 'Contact with ' + names.join(', ') + '. ' : 'The cart touched no obstacles. ') +
      'The cart finished ' + score.finalErrorMeters.toFixed(2) + ' m from the goal.';
    addFile('json', JSON.stringify(episode) + '\n', 'application/json');
    addFile('xml', episode.modelXML, 'application/xml');
    addFile('usd', makeShowroomEpisodeUSD(episode), 'text/plain');
    result.hidden = false;
    showFrame(0);
  }

  function record() {
    if (worker) { pause(); return; }
    if (!scene || disposed || unavailable) return;
    clearResult();
    drawing = drawMap(map, scene, project);
    const id = ++request;
    try {
      const active = createRunWorker();
      worker = active;
      function failed(message) {
        if (worker !== active || disposed) return;
        stopRun();
        status.textContent = message || 'The simulation could not run. Try again.';
      }
      active.onmessage = ({data}) => {
        if (disposed || worker !== active || data?.id !== id) return;
        if (data.type === 'error') { failed(data.message); return; }
        if (data.type !== 'result') return;
        stopRun();
        finishRun(data.episode);
      };
      active.onerror = () => failed('The physics engine could not start. Reopen the playground and try again.');
      active.onmessageerror = () => failed('The simulation result could not be read. Try again.');
      timeout = setTimeout(() => failed('The simulation took too long. Try a shorter route.'), 90000);
      start.textContent = 'Stop recording';
      status.textContent = 'Loading the physics engine and recording the trip…';
      active.postMessage({type:'run', id, scene, controller:driver.value});
    } catch (error) {
      stopRun();
      status.textContent = error.message || 'The simulation could not start.';
    }
  }

  function replay() {
    if (timer !== undefined) { stopPlayback(); return; }
    if (!episode || disposed) return;
    const frames = episode.frames;
    let index = Number(slider.value);
    if (index >= frames.length - 1) index = 0;
    showFrame(index);
    const startTime = performance.now() - frames[index].time * 1000;
    play.textContent = 'Pause recording';
    function tick(now) {
      const elapsed = (now - startTime) / 1000;
      let next = index;
      while (next + 1 < frames.length && frames[next + 1].time <= elapsed) next++;
      if (next !== index) { index = next; showFrame(index); }
      if (index === frames.length - 1) stopPlayback();
      else timer = requestAnimationFrame(tick);
    }
    timer = requestAnimationFrame(tick);
  }

  start.onclick = record;
  play.onclick = replay;
  slider.oninput = () => { stopPlayback(); if (episode) showFrame(Number(slider.value)); };
  chooser.onchange = variant.onchange = driver.onchange = refreshScene;
  host.ontoggle = () => { if (!host.open) pause(); else if (!drawing && !disposed) refreshScene(); };

  if (host.open) refreshScene();
  return {pause, dispose() { disposed = true; stopRun(); clearResult(); host.ontoggle = null; }};
}
