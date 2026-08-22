import React, { useRef, useState } from 'react';
import { Film, LoaderCircle, Upload, X } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { frameSignalFromPixels, sampleCountForDuration } from '../../lib/mediaFusion.js';

const ANALYSIS_WIDTH = 64;
const ANALYSIS_HEIGHT = 36;
const MAX_VIDEO_BYTES = 180 * 1024 * 1024;

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

export function MediaInputPanel({ media, onMedia, disabled = false }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setStatus('Sampling visual changes locally…');
    try {
      const sampled = await sampleVideo(file);
      onMedia(sampled);
      setStatus(`Ready: ${sampled.signals.length} frames sampled across ${sampled.duration.toFixed(1)}s.`);
    } catch (sampleError) {
      onMedia(null);
      setStatus('');
      setError(sampleError?.message || 'Could not sample this video.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="media-input-panel" aria-label="Video and screen recording input">
      <div className="media-input-copy">
        <span className="bsn-eyebrow"><Film size={14} aria-hidden="true" /> Multimodal video layer</span>
        <strong>Upload a video or screen recording</strong>
        <p>BrainSNN adaptively samples visual-change signals in your browser, then fuses them with the transcript or notes below. Short workflows get denser sampling; the raw video is not uploaded.</p>
      </div>
      <input ref={inputRef} className="bsn-visually-hidden" type="file" accept="video/*" onChange={handleFile} disabled={disabled} />
      <div className="media-input-actions">
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
          {status.startsWith('Sampling') ? <LoaderCircle className="media-spinner" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {media ? 'Replace video' : 'Choose video'}
        </Button>
        {media ? (
          <Button variant="ghost" onClick={() => { onMedia(null); setStatus(''); }} disabled={disabled}>
            <X size={16} aria-hidden="true" /> Remove
          </Button>
        ) : null}
      </div>
      {media ? (
        <div className="media-ready-card">
          <strong>{media.fileName}</strong>
          <span>{media.duration.toFixed(1)}s · {media.signals.length} sampled frames · raw file stays local</span>
        </div>
      ) : null}
      {status ? <p className="bsn-note" role="status">{status}</p> : null}
      {error ? <p className="bsn-validation" role="alert">{error}</p> : null}
    </section>
  );
}
