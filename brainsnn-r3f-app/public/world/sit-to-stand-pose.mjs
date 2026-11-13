const SIZE = 192, SAMPLE_HZ = 5, THRESHOLD = .3;
const MODEL = Object.freeze({name:'MoveNet SinglePose Lightning', version:4,
  source:'https://www.kaggle.com/models/google/movenet/tfJs/singlepose-lightning/4',
  license:'Apache-2.0', runtime:'TensorFlow.js 4.22.0 WASM',
  weightsArchiveSha256:'28b9a96dde847d2c5dd0d44ddd131d6dfd388b8a014a4535dc31b4059ce61765'});
const assets = new URL('./vendor/movenet-v4/', import.meta.url).href;

export function poseImageRect(width, height) {
  if (!(width > 0 && height > 0)) throw new Error('The video frame size is unavailable.');
  const scale = SIZE / Math.max(width, height);
  const w = Math.max(1,Math.round(width * scale)), h = Math.max(1,Math.round(height * scale));
  return {x:Math.floor((SIZE - w) / 2), y:Math.floor((SIZE - h) / 2), w, h};
}

// Use the previous detected torso and limb extent to spend the next 192x192
// inference on the person. The transform is always expressed against the full
// video, so coordinates from zoomed and letterboxed frames share one space.
export function nextPoseImageRect(values, rect, width, height) {
  const full = poseImageRect(width,height);
  const point = i => ({
    x:(values[3*i+1] * SIZE - rect.x) / rect.w * width,
    y:(values[3*i] * SIZE - rect.y) / rect.h * height,
    score:values[3*i+2]
  });
  const hips = [point(11),point(12)].filter(p=>p.score >= .2);
  const shoulders = [point(5),point(6)].filter(p=>p.score >= .2);
  if (!hips.length || !shoulders.length) return full;
  const cx = hips.reduce((sum,p)=>sum+p.x,0)/hips.length;
  const cy = hips.reduce((sum,p)=>sum+p.y,0)/hips.length;
  const extent = p => Math.max(Math.abs(p.x-cx),Math.abs(p.y-cy));
  const torso = Math.max(...shoulders.map(extent));
  let reach = torso;
  for (let i=0;i<17;i++) { const p=point(i); if (p.score >= .2) reach=Math.max(reach,extent(p)); }
  // Torso margin keeps room for legs even immediately after an occluded ankle.
  const size = Math.max(torso*4, reach*2.6, Math.max(width,height)*.16);
  if (!Number.isFinite(size) || size >= Math.max(width,height)) return full;
  const scale = SIZE/size;
  return {x:SIZE/2-cx*scale, y:SIZE/2-cy*scale, w:width*scale, h:height*scale};
}

export function readPoseSide(values, side, rect) {
  if (side !== 'left' && side !== 'right') throw new Error('Select the visible left or right side.');
  if (values?.length !== 51) throw new Error('Unexpected MoveNet output shape.');
  const indices = side === 'left' ? [11,13,15] : [12,14,16];
  const landmarks = indices.map(i => ({
    x:(values[i*3+1] * SIZE - rect.x) / rect.w,
    y:(values[i*3] * SIZE - rect.y) / rect.h,
    score:values[i*3+2],
  }));
  const min = Math.min(...landmarks.map(p=>p.score));
  const valid = landmarks.every(p => [p.x,p.y,p.score].every(v=>Number.isFinite(v) && v >= 0 && v <= 1));
  return {landmarks: valid && min >= THRESHOLD ? landmarks : null, confidence:Number.isFinite(min) && min >= 0 && min <= 1 ? min : null};
}

export function poseSampleTimes(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 60) {
    throw new Error('Choose a positive video interval of up to 60 seconds.');
  }
  // Sample the half-open interval. Seeking exactly to duration is unreliable on several decoders.
  return Array.from({length:Math.ceil((end - start) * SAMPLE_HZ)}, (_,i) => start + i / SAMPLE_HZ).filter(t => t < end);
}

function waitVideo(video, event, ready, signal) {
  signal?.throwIfAborted();
  if (ready()) return Promise.resolve();
  return new Promise((resolve,reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      video.removeEventListener(event, check);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const check = () => { if (ready()) finish(); };
    const failed = () => finish(new Error('Video decoding failed at ' + video.currentTime.toFixed(2) +
      ' s (media error ' + (video.error?.code ?? 'unknown') + '). Try exporting a compatible MP4 or WebM copy.'));
    const aborted = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error('Timed out decoding a video frame. Try an MP4 or a shorter clip.')), 20000);
    video.addEventListener(event, check);
    video.addEventListener('error', failed, {once:true});
    signal?.addEventListener('abort', aborted, {once:true});
    if (video.error) failed();
  });
}

export async function trackSitToStand(videoUrl, {side, startSeconds, endSeconds, signal, onProgress} = {}) {
  signal?.throwIfAborted();
  if (typeof videoUrl !== 'string' || !videoUrl.startsWith('blob:')) throw new Error('Open a local video before tracking.');
  if (side !== 'left' && side !== 'right') throw new Error('Select the visible left or right side.');
  const times = poseSampleTimes(startSeconds,endSeconds);
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';
  let detector;
  try {
    video.src = videoUrl;
    video.load();
    await waitVideo(video,'loadeddata',() => video.readyState >= 2,signal);
    if (!Number.isFinite(video.duration) || endSeconds > video.duration + .000001) throw new Error('The tracking interval exceeds the clip duration.');
    let rect = poseImageRect(video.videoWidth,video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    if (!ctx) throw new Error('A 2D canvas is required for local tracking.');
    const {openPoseDetector} = await import('./vendor/movenet-v4/detector.mjs');
    signal?.throwIfAborted();
    detector = await openPoseDetector(assets,signal);
    const frames = [];
    onProgress?.({completed:0,total:times.length});
    for (const target of times) {
      signal?.throwIfAborted();
      if (video.currentTime !== target || video.seeking) {
        video.currentTime = target;
        await waitVideo(video,'seeked',() => !video.seeking && video.readyState >= 2,signal);
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0,0,SIZE,SIZE);
      ctx.drawImage(video,rect.x,rect.y,rect.w,rect.h);
      const values = await detector.detect(canvas);
      signal?.throwIfAborted();
      frames.push({timeSeconds:target, ...readPoseSide(values,side,rect)});
      rect = nextPoseImageRect(values,rect,video.videoWidth,video.videoHeight);
      onProgress?.({completed:frames.length,total:times.length});
      // Yield between frames so the progress UI and cancellation stay responsive.
      await new Promise(resolve => setTimeout(resolve,0));
    }
    return {model:{...MODEL},side,threshold:THRESHOLD,sampleHz:SAMPLE_HZ,frames};
  } finally {
    detector?.close();
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
