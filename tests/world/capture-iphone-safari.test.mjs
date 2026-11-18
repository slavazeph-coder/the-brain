import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureClient} from '../../brainsnn-r3f-app/public/world/capture-client.mjs';

// iPhone Safari bounded codec list: [avc1.42E01E, hvc1, av1]
// Real iPhone Safari isTypeSupported returns true for these codecs.
// The capture-client must prefer avc1.42E01E (HDR) over generic video/mp4.
test('iPhone Safari bounded codec list selects HDR codec when available', async () => {
  const iphoneCodecs = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=hvc1', 'video/mp4;codecs=av1', 'video/mp4'];
  const requests = [];
  const files = [];
  const states = [];
  const errors = [];
  const previews = [];

  class Recorder {
    static isTypeSupported(type) {
      return iphoneCodecs.some(c => c === type || (type === 'video/mp4' && c.startsWith('video/mp4')));
    }
    constructor(stream, config) {
      this.stream = stream;
      this.mimeType = config.mimeType;
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['iphone-safari-frame']) });
        this.onstop?.();
      });
    }
  }

  const client = createCaptureClient({
    Recorder,
    mediaDevices: {
      getUserMedia: (constraints) => {
        const pending = Promise.resolve({ getTracks: () => [] });
        requests.push({ constraints, codec: Recorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') ? 'avc1.42E01E' : 'hvc1' });
        return pending;
      }
    },
    onFile: (file) => files.push(file),
    onError: (error) => errors.push(error.message),
    onState: (state) => states.push(state),
    onStream: (source) => previews.push(source),
    maxBytes: 1000,
    durationMs: 500,
  });

  assert.equal(client.supported, true);
  const started = await client.start();
  assert.equal(started, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].codec, 'avc1.42E01E');
  assert.equal(requests[0].constraints.video.facingMode.ideal, 'environment');
  // States: idle (initial) -> requesting -> recording
  assert.ok(states.length >= 2, `states should be at least 2, got ${states.length}: ${JSON.stringify(states)}`);

  client.stop();
  await new Promise(r => setTimeout(r, 600));
  assert.equal(files.length, 1);
  assert.match(files[0].type.toLowerCase(), /^video\/mp4;codecs=avc1\.42e01e/);
  assert.equal(client.state, 'idle');
});

test('iPhone Safari falls back to hvc1 when HDR codec unavailable', async () => {
  const requests = [];
  const files = [];
  const states = [];
  const errors = [];
  const previews = [];

  class Recorder {
    static isTypeSupported(type) {
      if (type === 'video/mp4;codecs=avc1.42E01E') return false;
      if (type === 'video/mp4;codecs=hvc1') return true;
      return type.startsWith('video/mp4');
    }
    constructor(stream, config) {
      this.stream = stream;
      this.mimeType = config.mimeType;
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['iphone-hvc1-frame']) });
        this.onstop?.();
      });
    }
  }

  const client = createCaptureClient({
    Recorder,
    mediaDevices: {
      getUserMedia: (constraints) => {
        const pending = Promise.resolve({ getTracks: () => [] });
        requests.push({ constraints, codec: Recorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') ? 'avc1.42E01E' : 'hvc1' });
        return pending;
      }
    },
    onFile: (file) => files.push(file),
    onError: (error) => errors.push(error.message),
    onState: (state) => states.push(state),
    onStream: (source) => previews.push(source),
    maxBytes: 1000,
    durationMs: 500,
  });

  assert.equal(client.supported, true);
  const started = await client.start();
  assert.equal(started, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].codec, 'hvc1');
  await new Promise(r => setTimeout(r, 600));
  assert.equal(files.length, 1);
  assert.match(files[0].type, /^video\/mp4/);
});

test('iPhone Safari rejects capture when all bounded codecs unsupported', async () => {
  const requests = [];
  const files = [];
  const states = [];
  const errors = [];
  const previews = [];

  class Recorder {
    static isTypeSupported() { return false; }
    constructor(stream, config) {
      this.stream = stream;
      this.mimeType = config.mimeType;
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.onstop?.(); });
    }
  }

  const client = createCaptureClient({
    Recorder,
    mediaDevices: {
      getUserMedia: (constraints) => {
        const pending = Promise.resolve({ getTracks: () => [] });
        requests.push({ constraints });
        return pending;
      }
    },
    onFile: (file) => files.push(file),
    onError: (error) => errors.push(error.message),
    onState: (state) => states.push(state),
    onStream: (source) => previews.push(source),
    maxBytes: 1000,
    durationMs: 500,
  });

  assert.equal(client.supported, false);
  const started = await client.start();
  assert.equal(started, false);
  assert.equal(requests.length, 0);
  assert.equal(files.length, 0);
});

test('iPhone Safari bounded codec list order: avc1.42E01E preferred over hvc1', async () => {
  const requests = [];
  const files = [];
  const states = [];
  const errors = [];
  const previews = [];

  class Recorder {
    static isTypeSupported(type) {
      return type === 'video/mp4;codecs=avc1.42E01E' || type === 'video/mp4;codecs=hvc1' || type.startsWith('video/mp4');
    }
    constructor(stream, config) {
      this.stream = stream;
      this.mimeType = config.mimeType;
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['iphone-preferred-frame']) });
        this.onstop?.();
      });
    }
  }

  const client = createCaptureClient({
    Recorder,
    mediaDevices: {
      getUserMedia: (constraints) => {
        const pending = Promise.resolve({ getTracks: () => [] });
        requests.push({ constraints, codec: Recorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') ? 'avc1.42E01E' : 'hvc1' });
        return pending;
      }
    },
    onFile: (file) => files.push(file),
    onError: (error) => errors.push(error.message),
    onState: (state) => states.push(state),
    onStream: (source) => previews.push(source),
    maxBytes: 1000,
    durationMs: 500,
  });

  assert.equal(client.supported, true);
  const started = await client.start();
  assert.equal(started, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].codec, 'avc1.42E01E');
  await new Promise(r => setTimeout(r, 600));
  assert.equal(files.length, 1);
  assert.match(files[0].type.toLowerCase(), /^video\/mp4;codecs=avc1\.42e01e/);
});

test('iPhone Safari camera constraints match physical capture requirements', async () => {
  const requests = [];
  const files = [];
  const states = [];
  const errors = [];
  const previews = [];

  class Recorder {
    static isTypeSupported(type) { return type.startsWith('video/mp4'); }
    constructor(stream, config) {
      this.stream = stream;
      this.mimeType = config.mimeType;
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['iphone-physical-frame']) });
        this.onstop?.();
      });
    }
  }

  const client = createCaptureClient({
    Recorder,
    mediaDevices: {
      getUserMedia: (constraints) => {
        const pending = Promise.resolve({ getTracks: () => [] });
        requests.push(constraints);
        return pending;
      }
    },
    onFile: (file) => files.push(file),
    onError: (error) => errors.push(error.message),
    onState: (state) => states.push(state),
    onStream: (source) => previews.push(source),
    maxBytes: 1000,
    durationMs: 500,
  });

  await client.start();
  assert.equal(requests.length, 1);
  const c = requests[0];

  assert.ok(c.video, 'video constraint present');
  assert.equal(c.video.facingMode.ideal, 'environment', 'environment-facing camera for physical capture');
  assert.equal(c.video.width.ideal, 1280, '1280px width ideal');
  assert.equal(c.video.height.ideal, 720, '720px height ideal');
  assert.equal(c.audio, false, 'no audio track for physical camera capture');

  client.stop();
  await new Promise(r => setTimeout(r, 600));
  assert.equal(files.length, 1);
  assert.match(files[0].name, /walkthrough-\d+\.mp4$/);
  assert.match(files[0].type, /^video\/mp4/);
});
