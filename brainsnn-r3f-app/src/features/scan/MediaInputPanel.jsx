import React, { useRef, useState } from 'react';
import { Film, LoaderCircle, Upload, X } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { frameSignalFromPixels } from '../../lib/mediaFusion.js';

const TARGET_SAMPLE_INTERVAL_SECONDS = 1.5;
const MAX_SAMPLE_COUNT = 240;
const ANALYSIS_WIDTH = 48;
const ANALYSIS_HEIGHT = 27;
const MAX_VIDEO_BYTES = 180 * 1024 * 1024;
const MAX_VIDEO_DURATION_SECONDS = 10 * 60;
const MAX_BROWSER_AUDIO_BYTES = 64 * 1024 * 1024;
const AUDIO_WINDOW_SECONDS = 0.5;
const AUDIO_DECODE_TIMEOUT_MS = 8000;
const ALLOWED_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

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

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

function audioEnergyAt(buffer, timestamp) {
  const center = Math.max(0, Math.min(buffer.length - 1, Math.round(timestamp * buffer.sampleRate)));
  const radius = Math.max(1, Math.round((AUDIO_WINDOW_SECONDS * buffer.sampleRate) / 2));
  const start = Math.max(0, center - radius);
  const end = Math.min(buffer.length, center + radius);
  const step = Math.max(1, Math.ceil((end - start) / 2048));
  let squareSum = 0;
  let samples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = start; index < end; index += step) {
      const value = data[index] || 0;
      squareSum += value * value;
      samples += 1;
    }
  }
  return samples ? Number(Math.sqrt(squareSum / samples).toFixed(5)) : 0;
}

async function sampleAudioEnergy(file, timestamps) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return {
      status: 'unavailable',
      reason: 'web_audio_unsupported',
      label: 'Audio energy unavailable in this browser.',
      signals: [],
    };
  }
  if (file.size > MAX_BROWSER_AUDIO_BYTES) {
    return {
      status: 'unavailable',
      reason: 'browser_audio_size_limit',
      label: 'Audio energy skipped locally for this large file.',
      signals: [],
    };
  }

  let context = null;
  try {
    context = new AudioContext();
    const bytes = await file.arrayBuffer();
    const decoded = await withTimeout(
      context.decodeAudioData(bytes),
      AUDIO_DECODE_TIMEOUT_MS,
      'Audio decoding timed out.',
    );
    if (!decoded?.numberOfChannels || !decoded.length) throw new Error('No decodable audio track.');
    const signals = timestamps.map((timestamp) => ({
      timestamp: Number(timestamp.toFixed(3)),
      energy: audioEnergyAt(decoded, timestamp),
    }));
    return {
      status: 'available',
      reason: 'browser_audio_energy',
      label: `${signals.length} audio energy windows sampled locally.`,
      signals,
    };
  } catch {
    return {
      status: 'unavailable',
      reason: 'audio_track_or_codec_unavailable',
      label: 'No browser-decodable audio track was available; visual analysis can continue.',
      signals: [],
    };
  } finally {
    try {
      await context?.close();
    } catch {
      // Closing Web Audio is best-effort and must never fail video sampling.
    }
  }
}

export function representativeSampleTimestamps(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.max(1, Math.min(MAX_SAMPLE_COUNT, Math.ceil(duration / TARGET_SAMPLE_INTERVAL_SECONDS)));
  return Array.from({ length: count }, (_, index) => {
    const midpoint = ((index + 0.5) / count) * duration;
    return Number(Math.min(Math.max(0, midpoint), Math.max(0, duration - 0.04)).toFixed(3));
  });
}

async function sampleVideo(file) {
  if (!file || !ALLOWED_VIDEO_MIME_TYPES.has(file.type)) throw new Error('Choose an MP4, WebM, MOV, or M4V video file.');
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
    if (duration > MAX_VIDEO_DURATION_SECONDS) throw new Error('For this CPU-first pipeline, keep the video at or under 10 minutes.');

    const canvas = document.createElement('canvas');
    canvas.width = ANALYSIS_WIDTH;
    canvas.height = ANALYSIS_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas analysis is unavailable in this browser.');

    const timestamps = representativeSampleTimestamps(duration);
    const audioPromise = sampleAudioEnergy(file, timestamps);
    const signals = [];
    let previous = null;
    for (const timestamp of timestamps) {
      await seek(video, timestamp, duration);
      context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const pixels = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data;
      signals.push(frameSignalFromPixels(pixels, previous, timestamp));
      previous = new Uint8ClampedArray(pixels);
    }
    const audio = await audioPromise;

    return {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      duration,
      signals,
      audioSignals: audio.signals,
      audioStatus: {
        status: audio.status,
        reason: audio.reason,
        label: audio.label,
      },
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
    setStatus('Sampling visual changes and checking for browser-decodable audio…');
    try {
      const sampled = await sampleVideo(file);
      onMedia(sampled);
      setStatus(`Ready: ${sampled.signals.length} visual samples across ${sampled.duration.toFixed(1)}s. ${sampled.audioStatus.label}`);
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
        <p>BrainSNN samples low-resolution visual-change signals in your browser, then fuses them with the transcript or notes below. The raw video is not uploaded by this V0 layer.</p>
      </div>
      <input
        ref={inputRef}
        className="bsn-visually-hidden"
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
        onChange={handleFile}
        disabled={disabled}
      />
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
          <span>
            {media.duration.toFixed(1)}s · {media.signals.length} visual samples · audio {media.audioStatus?.status || 'unavailable'} · raw file stays local
          </span>
        </div>
      ) : null}
      {status ? <p className="bsn-note" role="status">{status}</p> : null}
      {error ? <p className="bsn-validation" role="alert">{error}</p> : null}
    </section>
  );
}
