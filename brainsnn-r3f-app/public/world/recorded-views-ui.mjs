import {anotherObjectView, nearestRecordedView} from './recorded-views.mjs';

const NS = 'http://www.w3.org/2000/svg';

export function mountRecordedViews(host, {frames, objects, current, selected, open}) {
  const posed = frames.filter(frame => frame.camera);
  if (!posed.length) { host.hidden = true; return () => {}; }
  host.innerHTML = `<summary>Find a saved camera view</summary>
    <div class="recorded-views-controls">
      <button type="button" data-angle>See this object from another spot</button>
      <span data-angle-note></span>
    </div>
    <p>Choose a spot near the camera trail to see a saved picture. Use the arrow keys to move the spot.</p>
    <svg data-trail viewBox="0 0 360 190" tabindex="0" role="group" aria-label="Pick a camera spot with the arrow keys or tap the trail"></svg>
    <div class="recorded-views-controls">
      <label><input type="checkbox" data-object> Only views of this object</label>
      <label data-heading-label><input type="checkbox" data-heading> Match the current camera direction</label>
      <button type="button" data-go>Open saved view</button>
    </div>
    <p data-result role="status"></p>`;
  const el = key => host.querySelector('[data-' + key + ']');
  const trail = el('trail'), go = el('go'), angle = el('angle');
  const min = [0,1].map(axis => Math.min(...posed.map(f => f.camera[axis])) - 1.55);
  const max = [0,1].map(axis => Math.max(...posed.map(f => f.camera[axis])) + 1.55);
  const scale = Math.min(336 / (max[0] - min[0]), 166 / (max[1] - min[1]));
  const mid = [(max[0]+min[0])/2,(max[1]+min[1])/2];
  const project = ([x,z]) => [180 + (x-mid[0])*scale, 95 - (z-mid[1])*scale];
  function add(tag,attrs) {
    const node = document.createElementNS(NS,tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    trail.append(node);
    return node;
  }
  let segment = [];
  function drawSegment() {
    if (segment.length > 1) add('polyline',{points:segment.join(' '),class:'recorded-trail-line'});
    segment = [];
  }
  for (const f of frames) {
    if (f.camera) segment.push(project(f.camera).join(','));
    else drawSegment();
  }
  drawSegment();
  for (const f of posed) {
    const [cx,cy] = project(f.camera);
    add('circle',{cx,cy,r:3,class:'recorded-stop'});
  }
  const pin = add('circle',{r:6,class:'recorded-query'});
  let spot = [...(frames[current()]?.camera || posed[0].camera)];
  let match, alternative;
  function refresh() {
    const f = frames[current()], object = objects.find(o => o.id === selected());
    const headingKnown = Number.isFinite(f?.heading);
    el('heading-label').hidden = !headingKnown;
    const heading = headingKnown && el('heading').checked ? f.heading : null;
    match = nearestRecordedView(frames,{camera:spot,heading,objectId:el('object').checked ? object?.id : null});
    alternative = anotherObjectView(frames,current(),object);
    go.disabled = !match;
    angle.disabled = !alternative;
    el('angle-note').textContent = alternative ? (object?.label || 'Object') + ' · view ' + (alternative.index + 1) + ' of ' + frames.length
      : 'No other saved position shows this object.';
    const [cx,cy] = project(spot);
    pin.setAttribute('cx',cx); pin.setAttribute('cy',cy);
    const result = match ? 'View ' + (match.index + 1) + ' is ' + match.distance.toFixed(2) + ' m from this spot.' : 'No matching picture within 1.5 m of this spot.';
    if (el('result').textContent !== result) el('result').textContent = result;
  }
  function updateSpot(x,z) {
    spot = [Math.max(min[0], Math.min(max[0], x)), Math.max(min[1], Math.min(max[1], z))];
    refresh();
  }
  trail.addEventListener('click', e => {
    const transform = trail.getScreenCTM();
    if (!transform) return;
    const p = new DOMPoint(e.clientX,e.clientY).matrixTransform(transform.inverse());
    updateSpot(mid[0]+(p.x-180)/scale,mid[1]-(p.y-95)/scale);
  });
  trail.addEventListener('keydown', e => {
    const delta = {ArrowLeft:[-.25,0],ArrowRight:[.25,0],ArrowUp:[0,.25],ArrowDown:[0,-.25]}[e.key];
    if (!delta) return;
    e.preventDefault();
    updateSpot(spot[0]+delta[0],spot[1]+delta[1]);
  });
  el('object').onchange = refresh;
  el('heading').onchange = refresh;
  go.onclick = () => { if (match) open(match.index); };
  angle.onclick = () => {
    if (!alternative) return;
    const index = alternative.index;
    spot = [...frames[index].camera];
    open(index);
    refresh();
  };
  host.addEventListener('toggle', () => { if (host.open) refresh(); });
  return () => { if (host.open) refresh(); };
}
