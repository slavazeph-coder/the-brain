import React, { useEffect, useRef, useState } from 'react';
import { Film, LoaderCircle, Upload, X } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { deriveAudioEnvelope, unavailableAudioTimeline } from '../../lib/audioFeatures.js';
import { frameSignalFromPixels, sampleCountForDuration } from '../../lib/mediaFusion.js';

const ANALYSIS_WIDTH = 64;
const ANALYSIS_HEIGHT = 36;
const MAX_VIDEO_BYTES = 180 * 1024 * 1024;
const MAX_AUDIO_DECODE_BYTES = 80 * 1024 * 1024;
const MAX_AUDIO_DECODE_SECONDS = 180;

function once(target, eventName, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);
    function cleanup() {
      window.clearTimeout(timer);
      target.removeEventListener(eventName, handle);
      target.removeEventListener('error', fail);
    }
    function handle(event) {
      cleanup();
      resolve(event);
    }
    function fail() {
      cleanup();
      reject(new Error('The browser could not decode this video file.'));
    }
    target.addEventListener(eventName, handle, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

async function seek(video, time, duration) {
  let target = time;
  if (video.readyState < 2 && target < 0.02) target = Math.min(0.02, Math.max(0, duration - 0.04));
  if (Math.abs(video.currentTime - target) < 0.03 && video.readyState >= 2) return;
  const pending = once(video, 'seeked');
  video.currentTime = target;
  await pending;
}

async function sampleVideo(file) {
  if (!file?.type?.startsWith('video/')) throw new Error('Choose a video or screen-recording file.');
  if (file.size > MAX_VIDEO_BYTES) throw new Error('For browser sampling, keep the video under 180 MB.');

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  const metadataReady = once(video, 'loadedmetadata');
  video.src = objectUrl;

  try {
    await metadataReady;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration || duration <= 0) throw new Error('Could not read the video duration.');
    const sampleCount = sampleCountForDuration(duration);

    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = ANALYSIS_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas analysis is unavailable in this browser.');

    const signals = [];
    let previous = null;
    for (let index = 0; index < sampleCount; index += 1) {
      const fraction = sampleCount === 1 ? 0.5 : index / (sampleCount - 1);
      const timestamp = Math.min(Math.max(0, duration * fraction), Math.max(0, duration - 0.04));
      await seek(video, timestamp, duration);
      context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const pixels = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data;
      signals.push(frameSignalFromPixels(pixels, previous, timestamp));
      previous = new Uint8ClampedArray(pixels);
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      duration,
      signals,
      sampledAt: new Date().toISOString(),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function analyzeAudioLocally(file, duration) {
  if (!file || file.size > MAX_AUDIO_DECODE_BYTES) {
    return unavailableAudioTimeline('Audio envelope skipped for files over 80 MB to protect browser memory.');
  }
  if (Number(duration) > MAX_AUDIO_DECODE_SECONDS) {
    return unavailableAudioTimeline('Audio envelope skipped for clips over 180 seconds in the client-side V0.2 path.');
  }

  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) return unavailableAudioTimeline('Web Audio decoding is unavailable in this browser.');

  let context = null;
  try {
    context = new AudioContextImpl();
    const bytes = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes);
    if (!buffer?.numberOfChannels || !buffer.length) return unavailableAudioTimeline('The file decoded without a usable audio channel.');

    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
    }

    return deriveAudioEnvelope(mono, buffer.sampleRate, Number(duration) || buffer.duration, 2);
  } catch (error) {
    return unavailableAudioTimeline(`Audio envelope unavailable: ${error?.message || 'browser codec decode failed'}.`);
  } finally {
    try { await context?.close?.(); } catch { /* no-op */ }
  }
}

export function MediaInputPanel({ media, onMedia, disabled = false }) {
  const inputRef = useRef(null);
  const previewUrlRef = useRef('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  function revokePreview() {
    if (!previewUrlRef.current) return;
    URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
  }

  useEffect(() => () => revokePreview(), []);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setStatus('Sampling visual + audio signals locally…');
    try {
      const sampled = await sampleVideo(file);
      const audio = await analyzeAudioLocally(file, sampled.duration);
      revokePreview();
      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;
      onMedia({ ...sampled, audio, previewUrl });
      const audioStatus = audio.status === 'ready'
        ? `${audio.points.length} local audio points ready`
        : 'audio envelope unavailable';
      setStatus(`Ready: ${sampled.signals.length} visual frames across ${sampled.duration.toFixed(1)}s · ${audioStatus}. Raw media stays in this browser session.`);
    } catch (sampleError) {
      revokePreview();
      onMedia(null);
      setStatus('');
      setError(sampleError?.message || 'Could not sample this video.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeMedia() {
    revokePreview();
    onMedia(null);
    setStatus('');
    setError('');
  }

  return (
    <section className="media-input-panel" aria-label="Video and screen recording input">
      <div className="media-input-copy">
        <span className="bsn-eyebrow"><Film size={14} aria-hidden="true" /> Multimodal video layer</span>
        <strong>Upload a video or screen recording</strong>
        <p>BrainSNN adaptively samples visual change and, when the browser codec allows it, a lightweight audio energy/dynamics envelope. Both are computed locally, then fused with the transcript/captions below. Raw video and audio are not uploaded by this layer.</p>
      </div>
      <input ref={inputRef} className="bsn-visually-hidden" type="file" accept="video/*" onChange={handleFile} disabled={disabled} />
      <div className="media-input-actions">
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
          {status.startsWith('Sampling') ? <LoaderCircle className="media-spinner" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {media ? 'Replace video' : 'Choose video'}
        </Button>
        {media ? (
          <Button variant="ghost" onClick={removeMedia} disabled={disabled}>
            <X size={16} aria-hidden="true" /> Remove
          </Button>
        ) : null}
      </div>
      {media ? (
        <div className="media-ready-card">
          <strong>{media.fileName}</strong>
          <span>
            {media.duration.toFixed(1)}s · {media.signals.length} sampled visual frames · {media.audio?.status === 'ready' ? `${media.audio.points.length} audio envelope points` : 'audio envelope unavailable'} · raw file stays local
          </span>
        </div>
      ) : null}
      {status ? <p className="bsn-note" role="status">{status}</p> : null}
      {error ? <p className="bsn-validation" role="alert">{error}</p> : null}
      <p className="bsn-note">Audio V0.2 measures local energy/dynamics only. It does not transcribe speech, identify speakers, infer emotion, or measure audience response.</p>
    </section>
  );
}
