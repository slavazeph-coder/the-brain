import {createShowroomExample, parseShowroomBundle, MAX_SHOWROOM_BYTES} from './showroom-model.mjs';
import {mountShowroom} from './showroom-view.mjs';
import {hashSourceFile} from './projects-client.mjs';

/** Link only retained, timed evidence to the original recording. A tie selects the earlier view. */
export function closestTimedFrame(frames, seconds) {
  if (!Number.isFinite(seconds)) return -1;
  let best = -1;
  let distance = Infinity;
  for (const [index, frame] of frames.entries()) {
    if (!Number.isFinite(frame.timeSeconds)) continue;
    const delta = Math.abs(frame.timeSeconds - seconds);
    if (delta < distance) {
      best = index;
      distance = delta;
    }
  }
  return best;
}

/** The optional clip is provided by the local presentation, never by an imported room file. */
export function mountShowroomPage(root, {initialBundle, clip, example = createShowroomExample} = {}) {
  const find = selector => root.querySelector(selector);
  const roomInput = find('[data-room-file]');
  const videoInput = find('[data-original-file]');
  const status = find('[data-room-status]');
  const videoStatus = find('[data-original-status]');
  const video = find('[data-original]');
  const pickFromVideo = find('[data-video-pick]');
  const viewRoot = find('[data-room-view]');
  const sourceSection = find('[data-source-section]');
  const reset = find('[data-demo-room]');
  let sourceRange = [], outsideRange = false;
  let room, view, cameraStill, hashing, roomChange = 0, videoChange = 0, objectURL, offset = 0;

  function clearVideo() {
    videoChange++;
    hashing?.abort();
    hashing = undefined;
    pickFromVideo.hidden = true;
    pickFromVideo.disabled = false;
    outsideRange = false;
    if (cameraStill) cameraStill.hidden = false;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    offset = 0;
    videoInput.value = '';
    videoStatus.textContent = '';
  }

  function show(value, isExample) {
    const next = parseShowroomBundle(value);
    view?.();
    clearVideo();
    room = next;
    view = mountShowroom(viewRoot, room);
    cameraStill = viewRoot.querySelector('[data-el="source"]');
    cameraStill.after(sourceSection);
    const times = room.frames.map(frame => frame.timeSeconds).filter(Number.isFinite);
    sourceRange = [times[0], times.at(-1)];
    sourceSection.hidden = !room.sourceVideo || times.length === 0;
    reset.hidden = isExample;
    status.textContent = '';
  }

  const playbackHelp = 'The map follows the nearest saved view as the video plays. Choose a saved view to pause the video there.';
  function useVideo(url, startSeconds) {
    offset = startSeconds;
    video.src = url;
    video.hidden = false;
    pickFromVideo.hidden = false;
    cameraStill.hidden = true;
    videoStatus.textContent = playbackHelp;
  }

  roomInput.addEventListener('change', async () => {
    const file = roomInput.files[0];
    if (!file) return;
    const id = ++roomChange;
    try {
      if (file.size > MAX_SHOWROOM_BYTES) throw new Error('Choose a room file smaller than 32 MiB.');
      status.textContent = 'Reading the room on this device…';
      const text = await file.text();
      if (id !== roomChange) return;
      show(JSON.parse(text), false);
      status.textContent = 'Room file opened on this device.';
    } catch (error) {
      if (id === roomChange) status.textContent = error instanceof SyntaxError
        ? 'This file could not be read as a showroom JSON file.' : 'Could not open the room. ' + error.message;
    } finally {
      if (id === roomChange) roomInput.value = '';
    }
  });

  reset.addEventListener('click', () => {
    roomChange++;
    roomInput.value = '';
    show(example(), true);
  });

  videoInput.addEventListener('change', async () => {
    const file = videoInput.files[0];
    if (!file) return;
    const id = ++videoChange;
    const expected = room.sourceVideo?.sha256;
    hashing?.abort();
    hashing = new AbortController();
    try {
      if (!expected) throw new Error('This room has no linked recording.');
      videoStatus.textContent = 'Checking the video against the room file on this device…';
      const hex = await hashSourceFile(file, {signal: hashing.signal});
      if (id !== videoChange) return;
      if (hex !== expected) throw new Error('This video does not match the recording used for the map.');
      clearVideo();
      objectURL = URL.createObjectURL(file);
      useVideo(objectURL, 0);
    } catch (error) {
      if (id === videoChange) videoStatus.textContent = error.message;
    } finally {
      if (id === videoChange) videoInput.value = '';
    }
  });

  function seekToView(index) {
    const time = room.frames[index]?.timeSeconds;
    if (video.hidden || !Number.isFinite(time) || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(video.duration, Math.max(0, time - offset));
  }

  pickFromVideo.addEventListener('click', () => {
    video.pause();
    const nearest = closestTimedFrame(room.frames, video.currentTime + offset);
    if (nearest >= 0) view.setFrame(nearest);
    seekToView(view.getFrame());
    viewRoot.querySelector('[data-tab="boxes"]').click();
    const boxes = viewRoot.querySelector('[data-panel="boxes"]');
    boxes.scrollIntoView({block: 'nearest'});
    (boxes.querySelector('button') || viewRoot.querySelector('[data-el="picker"]')).focus({preventScroll: true});
  });
  viewRoot.addEventListener('showroom-frame-change', event => {
    if (video.hidden) return;
    video.pause();
    seekToView(event.detail.index);
  });
  video.addEventListener('loadedmetadata', () => seekToView(view.getFrame()));
  video.addEventListener('timeupdate', () => {
    if (video.hidden || !room || !view) return;
    const seconds = video.currentTime + offset;
    const outside = seconds < sourceRange[0] - .001 || seconds > sourceRange[1] + .001;
    if (outside !== outsideRange) {
      outsideRange = outside;
      pickFromVideo.disabled = outside;
      videoStatus.textContent = outside
        ? 'This part of the video has no mapped views. Choose a saved view to return to the mapped part.'
        : playbackHelp;
    }
    if (outside) return;
    const index = closestTimedFrame(room.frames, seconds);
    if (index >= 0 && index !== view.getFrame()) view.setFrame(index);
  });
  video.addEventListener('error', () => {
    if (!video.hasAttribute('src')) return;
    cameraStill.hidden = false;
    video.hidden = true;
    pickFromVideo.hidden = true;
    videoStatus.textContent = 'This browser could not play the video. You can still step through the saved views.';
  });

  show(initialBundle || example(), !initialBundle);
  if (clip && room.sourceVideo && Number.isFinite(clip.startSeconds)) useVideo(clip.url, clip.startSeconds);
  return {pause() { video.pause(); view.pause(); }};
}
