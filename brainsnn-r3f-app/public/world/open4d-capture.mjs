// Camera clips stay in this tab. The exported setup contains timing and file identifiers.
const RATES = ['24', '25', '30', '50', '60', '24000/1001', '30000/1001', '60000/1001'];
const EDGE_BYTES = 65536;
const VISIBLE_CAMERAS = 4;

function hz(rate) {
  const [n, d = 1] = rate.split('/').map(Number);
  return n / d;
}

async function identifyFile(file) {
  const first = file.slice(0, EDGE_BYTES);
  const last = file.slice(Math.max(first.size, file.size - EDGE_BYTES));
  const data = await new Blob([first, last]).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
}

export function mountOpen4DCapture(root) {
  root.innerHTML = `<details class="open4d-capture"><summary>Line up my camera clips</summary>
    <p>Choose videos of the same movement filmed from different spots. Find one moment you can see in every clip, like the instant a ball touches the floor.</p>
    <label>Add camera videos <input data-open4dc-clips type="file" accept="video/*,.mov,.mp4,.webm,.m4v" multiple></label>
    <div data-open4dc-pages class="layer-toolbar" hidden>
      <button type="button" data-open4dc-prev>Previous cameras</button>
      <output data-open4dc-page></output>
      <button type="button" data-open4dc-next>Next cameras</button>
    </div>
    <div data-open4dc-cameras class="open4d-camera-list"></div>
    <div data-open4dc-options hidden>
      <label>Frames per second <select data-open4dc-rate></select></label>
      <label>Seconds to keep after the shared moment <input data-open4dc-seconds type="number" min="0.1" max="600" step="any" value="5"></label>
    </div>
    <div data-open4dc-review hidden>
      <label>See the same moment in all views <input data-open4dc-time type="range" min="0" value="0" step="1"></label>
      <output data-open4dc-elapsed></output>
      <button type="button" data-open4dc-save>Save camera setup</button>
    </div>
    <button type="button" data-open4dc-clear hidden>Clear camera clips</button>
    <p data-open4dc-message class="layer-note" role="status"></p>
    <details><summary>Make a moving scene from these clips</summary>
      <p>Save the setup and keep your original videos. The frame extractor uses the marks to line up the images. To build the 3D motion, follow the camera calibration and training steps on a computer with an NVIDIA GPU. Then open the exported scene here.</p>
      <a href="https://github.com/slavazeph-coder/the-brain/tree/main/scripts/world-open4dgs" target="_blank" rel="noopener">Open the capture and training guide</a>
    </details>
  </details>`;
  const el = name => root.querySelector('[data-open4dc-' + name + ']');
  const rate = el('rate'), seconds = el('seconds'), time = el('time'), message = el('message');
  for (const value of RATES) rate.add(new Option(String(Number(hz(value).toFixed(3))), value));
  rate.value = '30';
  let cameras = [], generation = 0, revision = 0, frames = 0, page = 0;

  function showPage(requested) {
    const last = Math.max(0, Math.ceil(cameras.length / VISIBLE_CAMERAS) - 1);
    page = Math.min(last, Math.max(0, requested));
    el('pages').hidden = last === 0;
    el('prev').disabled = page === 0;
    el('next').disabled = page === last;
    el('page').textContent = 'Group ' + (page + 1) + ' of ' + (last + 1);
    for (const [index, cam] of cameras.entries()) {
      cam.card.hidden = Math.floor(index / VISIBLE_CAMERAS) !== page;
      if (!cam.card.hidden && !cam.video.hasAttribute('src')) {
        cam.video.src = cam.url;
      } else if (cam.card.hidden && cam.video.hasAttribute('src')) {
        cam.lastPosition = cam.video.currentTime;
        cam.video.pause();
        cam.video.removeAttribute('src');
        cam.video.load();
      }
    }
  }
  el('prev').onclick = () => showPage(page - 1);
  el('next').onclick = () => showPage(page + 1);

  function reviewFrame() {
    const frame = Number(time.value);
    const offset = frame / hz(rate.value);
    for (const cam of cameras) {
      if (cam.card.hidden || cam.video.readyState < 1) continue;
      cam.video.pause();
      cam.video.currentTime = cam.mark + offset;
    }
    el('elapsed').textContent = 'Frame ' + (frame + 1) + ' of ' + frames + ' · ' + offset.toFixed(3) + ' s after your mark';
  }

  function update() {
    ++revision;
    const waiting = cameras.filter(c => c.mark === null).length;
    const duration = Number(seconds.value);
    const available = Math.min(...cameras.map(c => c.duration - c.mark), duration);
    frames = waiting || cameras.length < 2 || !Number.isFinite(available) || duration < 0.1 || duration > 600
      ? 0 : Math.max(0, Math.floor(available * hz(rate.value) + 1e-8));
    el('review').hidden = frames < 2;
    if (cameras.length === 1) {
      message.textContent = 'Add a second camera view of the same movement.';
    } else if (waiting) {
      message.textContent = 'Mark the same moment in ' + waiting + (waiting === 1 ? ' more clip.' : ' clips.');
    } else if (frames >= 2) {
      time.max = String(frames - 1);
      time.value = '0';
      reviewFrame();
      message.textContent = 'Move the slider to check that the views line up. Your videos stay on this device.';
    } else if (cameras.length) {
      message.textContent = 'Choose 0.1 to 600 seconds and a moment with at least two frames left in every clip.';
    }
  }

  function release(cam) {
    cam.video.pause();
    cam.video.removeAttribute('src');
    cam.video.load();
    URL.revokeObjectURL(cam.url);
  }

  function clear() {
    ++generation;
    ++revision;
    el('clips').value = '';
    cameras.forEach(release);
    cameras = [];
    frames = 0;
    page = 0;
    el('cameras').replaceChildren();
    for (const name of ['review','options','clear','pages']) el(name).hidden = true;
    el('save').disabled = false;
    message.textContent = '';
  }

  el('clips').addEventListener('change', () => {
    const files = Array.from(el('clips').files);
    el('clips').value = '';
    if (!files.length) return;
    if (files.length + cameras.length > 99) {
      message.textContent = 'Choose up to 99 videos, one from each camera.';
      return;
    }
    const selected = generation;
    const firstAdded = cameras.length;
    for (const file of files) {
      let number = 1;
      while (cameras.some(cam => Number(cam.id) === number)) number++;
      const id = String(number).padStart(4, '0');
      const card = document.createElement('div');
      card.className = 'open4d-camera';
      card.innerHTML = '<strong></strong><video controls playsinline muted preload="metadata"></video><button type="button" disabled>Mark this moment</button><output></output><button data-open4dc-remove type="button">Remove clip</button>';
      const video = card.querySelector('video'), mark = card.querySelector('button'), output = card.querySelector('output');
      const name = 'Camera ' + number + ' · ' + file.name;
      card.querySelector('strong').textContent = name;
      video.setAttribute('aria-label', name);
      mark.setAttribute('aria-label', 'Mark this moment for camera ' + number);
      const cam = {id, file, video, card, mark:null, duration:0, lastPosition:0, url:URL.createObjectURL(file)};
      cameras.push(cam);
      video.addEventListener('loadedmetadata', () => {
        if (!video.hasAttribute('src') || generation !== selected) return;
        cam.duration = video.duration;
        mark.disabled = !Number.isFinite(cam.duration) || cam.duration <= 0;
        if (!mark.disabled) video.currentTime = frames >= 2 ? cam.mark + Number(time.value) / hz(rate.value) : cam.lastPosition;
      });
      video.addEventListener('emptied', () => { mark.disabled = video.readyState < 1; });
      video.addEventListener('error', () => {
        if (generation !== selected || !cameras.includes(cam) || !video.hasAttribute('src')) return;
        cam.mark = null;
        mark.disabled = true;
        output.textContent = 'This browser could not read this clip. Choose a playable video.';
        update();
      });
      mark.addEventListener('click', () => {
        video.pause();
        cam.mark = video.currentTime;
        output.textContent = 'Marked at ' + cam.mark.toFixed(3) + ' s';
        update();
      });
      const remove = card.querySelector('[data-open4dc-remove]');
      remove.setAttribute('aria-label', 'Remove camera ' + number);
      remove.addEventListener('click', () => {
        cameras = cameras.filter(item => item !== cam);
        release(cam);
        card.remove();
        if (cameras.length) { showPage(page); update(); }
        else clear();
        el('clips').focus();
      });
      el('cameras').append(card);
    }
    showPage(Math.floor(firstAdded / VISIBLE_CAMERAS));
    el('options').hidden = false;
    el('clear').hidden = false;
    update();
  });

  time.addEventListener('input', reviewFrame);
  rate.addEventListener('change', update);
  seconds.addEventListener('input', update);
  el('clear').addEventListener('click', () => {
    clear();
    el('clips').focus();
  });
  root.addEventListener('toggle', event => {
    if (event.target === root.firstElementChild && !event.target.open) cameras.forEach(cam => cam.video.pause());
  }, true);
  el('save').addEventListener('click', async () => {
    if (frames < 2) return;
    const selected = generation;
    const version = revision;
    const current = cameras.map(cam => ({...cam}));
    const setup = {schema:'brainsnn.open4dgs.capture.v1', alignment:'manual-shared-event', fps:rate.value, frame_count:frames};
    el('save').disabled = true;
    try {
      setup.cameras = await Promise.all(current.map(async cam => ({
        id:cam.id, file:cam.file.name, bytes:cam.file.size, edge_sha256:await identifyFile(cam.file), start_seconds:cam.mark,
      })));
      if (selected !== generation || version !== revision) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(setup,null,2)+'\n'], {type:'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'camera-setup.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      message.textContent = 'Camera setup saved. Keep it with the original videos for frame extraction.';
    } catch {
      if (selected === generation) message.textContent = 'The camera setup could not be saved. Choose the original clips again.';
    } finally {
      if (selected === generation) el('save').disabled = false;
    }
  });
  return {pause:() => cameras.forEach(cam => cam.video.pause()), clear, dispose:clear};
}
