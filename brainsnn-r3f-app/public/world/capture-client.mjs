// Camera permission is not abortable. Every callback belongs to one session so
// late permission/results cannot revive a cleared page or stop a newer stream.
export function createCaptureClient({
  mediaDevices = globalThis.navigator?.mediaDevices,
  Recorder = globalThis.MediaRecorder,
  onStream = async () => {}, onFile = () => {}, onState = () => {}, onError = () => {},
  maxBytes = 200 * 1024 ** 2, durationMs = 90000,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let active = null;
  const mime = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'].find(type => Recorder?.isTypeSupported?.(type));
  function release(session) {
    clearTimer(session.timer);
    for (const track of session.stream?.getTracks() || []) {
      track.removeEventListener('ended', session.ended);
      track.stop();
    }
  }
  function idle(session) {
    if (active !== session) return;
    active = null;
    onState('idle');
  }
  function discard(session, error) {
    if (active !== session) return;
    session.discarded = true;
    idle(session);
    try { if (session.recorder?.state !== 'inactive') session.recorder?.stop(); } catch {}
    release(session);
    session.chunks.length = 0;
    if (error) onError(error);
  }
  function stop({discard: drop = false} = {}) {
    const session = active;
    if (!session) return;
    if (drop || !session.recorder) { discard(session); return; }
    if (session.state === 'stopping') return;
    session.state = 'stopping'; onState('stopping');
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
      release(session);
    } catch (error) { discard(session, error); }
  }
  async function start() {
    if (active) return false;
    if (!mime || !mediaDevices?.getUserMedia) return false;
    const session = {state:'requesting', chunks:[], bytes:0};
    active = session; onState('requesting');
    try {
      const stream = await mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false});
      session.stream = stream;
      if (active !== session) { release(session); return false; }
      const recorder = new Recorder(stream, {mimeType:mime, videoBitsPerSecond:2500000});
      session.recorder = recorder;
      recorder.ondataavailable = ({data}) => {
        if (active !== session || session.discarded || !data?.size) return;
        session.bytes += data.size;
        if (session.bytes > maxBytes) { discard(session, new Error('Recording exceeded the file limit. Record a shorter walkthrough.')); return; }
        session.chunks.push(data);
      };
      recorder.onerror = () => discard(session, new Error('Recording was interrupted. Use the native camera upload or record again.'));
      recorder.onstop = () => {
        release(session);
        if (active !== session || session.discarded) return;
        idle(session);
        if (!session.bytes) { onError(new Error('The recording is empty. Record again or use the native camera upload.')); return; }
        const file = new File(session.chunks, `walkthrough-${Date.now()}.mp4`, {type:recorder.mimeType || mime});
        session.chunks.length = 0;
        onFile(file);
      };
      session.ended = () => stop();
      for (const track of stream.getTracks()) track.addEventListener('ended', session.ended);
      recorder.start(1000);
      session.state = 'recording'; onState('recording');
      session.timer = setTimer(() => { if (active === session) stop(); }, durationMs);
      await onStream(stream);
      return active === session;
    } catch (error) {
      discard(session, error);
      return false;
    }
  }
  return {start, stop, get supported() { return !!mime && !!mediaDevices?.getUserMedia; }, get state() { return active?.state || 'idle'; }};
}
