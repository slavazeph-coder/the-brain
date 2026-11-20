// Simulated iPhone Safari MediaRecorder answers. These check the capture client's
// codec choice and camera request; they are not a run on a physical iPhone.
// Ported from the GB10 branch's capture tests, with claims limited to what is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureClient } from '../../brainsnn-r3f-app/public/world/capture-client.mjs';

function safari(advertised) {
  const made = [], requests = [], files = [];
  class Recorder {
    static isTypeSupported(type) { return advertised.includes(type); }
    constructor(_stream, config) { this.mimeType = config.mimeType; this.state = 'inactive'; made.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['simulated safari frame']) }); this.onstop?.(); });
    }
  }
  const client = createCaptureClient({
    Recorder,
    mediaDevices: { getUserMedia: async constraints => { requests.push(constraints); return { getTracks: () => [Object.assign(new EventTarget(), { stop() {} })] }; } },
    onFile: file => files.push(file),
    maxBytes: 1000, durationMs: 60_000,
  });
  return { client, made, requests, files };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('simulated iPhone Safari: H.264 Constrained Baseline is chosen when offered beside HEVC and AV1', async () => {
  const s = safari(['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=hvc1', 'video/mp4;codecs=av01', 'video/mp4']);
  assert.equal(s.client.supported, true);
  assert.equal(await s.client.start(), true);
  assert.equal(s.made[0].mimeType, 'video/mp4;codecs=avc1.42E01E');
  s.client.stop(); await settle();
  assert.equal(s.files.length, 1);
  assert.match(s.files[0].type.toLowerCase(), /^video\/mp4;codecs=avc1\.42e01e/);
});

test('simulated iPhone Safari: without H.264 Baseline, records generic MP4 and lets Safari pick the codec', async () => {
  const s = safari(['video/mp4;codecs=hvc1', 'video/mp4']);
  assert.equal(await s.client.start(), true);
  assert.equal(s.made[0].mimeType, 'video/mp4', 'HEVC is never requested explicitly');
  s.client.stop(); await settle();
  assert.equal(s.files.length, 1);
  assert.match(s.files[0].type, /^video\/mp4/);
});

test('simulated iPhone Safari: rear camera at 1280x720, no audio, and a walkthrough MP4 file name', async () => {
  const s = safari(['video/mp4']);
  await s.client.start();
  const [request] = s.requests;
  assert.equal(request.video.facingMode.ideal, 'environment');
  assert.equal(request.video.width.ideal, 1280);
  assert.equal(request.video.height.ideal, 720);
  assert.equal(request.audio, false);
  s.client.stop(); await settle();
  assert.match(s.files[0].name, /^walkthrough-\d+\.mp4$/);
});

test('simulated iPhone Safari: only HEVC or AV1 without generic MP4 is unsupported and asks for no camera', async () => {
  const s = safari(['video/mp4;codecs=hvc1', 'video/mp4;codecs=av01']);
  assert.equal(s.client.supported, false);
  assert.equal(await s.client.start(), false);
  assert.equal(s.requests.length, 0);
});
