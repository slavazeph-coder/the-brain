import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Film, LoaderCircle, Mic2, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { deriveAudioEnvelope, unavailableAudioTimeline } from '../../lib/audioFeatures.js';
import { localSpeechCapabilities, transcribeAudioLocally } from '../../lib/localTranscription.js';
import { frameSignalFromPixels, sampleCountForDuration } from '../../lib/mediaFusion.js';

const ANALYSIS_WIDTH = 64;
const ANALYSIS_HEIGHT = 36;
const MAX_VIDEO_BYTES = 180 * 1024 * 1024;
const MAX_AUDIO_DECODE_BYTES = 80 * 1024 * 1024;
const MAX_AUDIO_DECODE_SECONDS = 180;
const LOCAL_STT_PREF = 'brainsnn_local_stt_v1';

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

async function decodeAudioLocally(file, duration) {
  if (!file || file.size > MAX_AUDIO_DECODE_BYTES) {
    return {
      audio: unavailableAudioTimeline('Audio analysis skipped for files over 80 MB to protect browser memory.'),
      samples: null,
      sampleRate: 0,
    };
  }
  if (Number(duration) > MAX_AUDIO_DECODE_SECONDS) {
    return {
      audio: unavailableAudioTimeline('Audio analysis skipped for clips over 180 seconds in the client-side V0.3 path.'),
      samples: null,
      sampleRate: 0,
    };
  }

  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) {
    return {
      audio: unavailableAudioTimeline('Web Audio decoding is unavailable in this browser.'),
      samples: null,
      sampleRate: 0,
    };
  }

  let context = null;
  try {
    context = new AudioContextImpl();
    const bytes = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes);
    if (!buffer?.numberOfChannels || !buffer.length) {
      return {
        audio: unavailableAudioTimeline('The file decoded without a usable audio channel.'),
        samples: null,
        sampleRate: 0,
      };
    }

    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
    }

    return {
      audio: deriveAudioEnvelope(mono, buffer.sampleRate, Number(duration) || buffer.duration, 2),
      samples: mono,
      sampleRate: buffer.sampleRate,
    };
  } catch (error) {
    return {
      audio: unavailableAudioTimeline(`Audio analysis unavailable: ${error?.message || 'browser codec decode failed'}.`),
      samples: null,
      sampleRate: 0,
    };
  } finally {
    try { await context?.close?.(); } catch { /* no-op */ }
  }
}

function compactTranscriptMeta(result) {
  if (!result?.schemaVersion) return null;
  return {
    schemaVersion: result.schemaVersion,
    status: result.status,
    provider: result.provider,
    model: result.model,
    device: result.device,
    timing: result.timing,
    timingIsMeasured: result.timingIsMeasured,
    rawAudioUploaded: result.rawAudioUploaded,
    wordCount: result.words?.length || 0,
    segmentCount: result.segments?.length || 0,
    disclaimer: result.disclaimer,
    generatedAt: new Date().toISOString(),
  };
}

function readAutoTranscriptPreference() {
  try {
    return window.localStorage.getItem(LOCAL_STT_PREF) !== 'false';
  } catch {
    return true;
  }
}

function progressMessage(event) {
  if (!event) return 'Preparing local speech model…';
  if (event.stage === 'model-loading') return `Loading local Whisper (${event.device || 'browser'})…`;
  if (event.stage === 'model-download') {
    const percent = event.fraction == null ? '' : ` ${Math.round(event.fraction * 100)}%`;
    return `Downloading speech model${percent}${event.file ? ` · ${event.file}` : ''}`;
  }
  if (event.stage === 'webgpu-fallback') return 'WebGPU unavailable for this model — switching to browser CPU/WASM…';
  if (event.stage === 'resampling') return 'Preparing audio for local speech-to-text…';
  if (event.stage === 'transcribing') return `Transcribing locally with Whisper (${event.device || 'browser'})…`;
  if (event.stage === 'complete') return `Local transcript ready · ${event.wordCount || 0} timed words`;
  return 'Preparing local speech-to-text…';
}

export function MediaInputPanel({ media, onMedia, transcript = '', onTranscript, disabled = false }) {
  const inputRef = useRef(null);
  const previewUrlRef = useRef('');
  const jobRef = useRef(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [autoTranscript, setAutoTranscript] = useState(readAutoTranscriptPreference);
  const speechCapabilities = localSpeechCapabilities(window);

  function revokePreview() {
    if (!previewUrlRef.current) return;
    URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
  }

  useEffect(() => () => {
    jobRef.current += 1;
    revokePreview();
  }, []);

  function saveAutoTranscriptPreference(value) {
    setAutoTranscript(value);
    try { window.localStorage.setItem(LOCAL_STT_PREF, String(value)); } catch { /* no-op */ }
  }

  async function runTranscription({ file, decoded, mediaSnapshot }) {
    if (!file) throw new Error('The source video is no longer available in this browser session.');
    let audioDecoded = decoded;
    if (!audioDecoded?.samples?.length) audioDecoded = await decodeAudioLocally(file, mediaSnapshot?.duration || media?.duration || 0);
    if (!audioDecoded?.samples?.length) throw new Error(audioDecoded?.audio?.reason || 'No decodable audio was available for local transcription.');

    const jobId = jobRef.current;
    setTranscriptionBusy(true);
    setError('');
    try {
      const result = await transcribeAudioLocally({
        samples: audioDecoded.samples,
        sampleRate: audioDecoded.sampleRate,
        duration: mediaSnapshot?.duration || media?.duration || 0,
        preferWebGPU: true,
        onProgress: (event) => {
          if (jobRef.current === jobId) setStatus(progressMessage(event));
        },
      });
      if (jobRef.current !== jobId) return null;
      if (!result.timedText) throw new Error('Whisper completed but did not detect usable speech.');
      onTranscript?.(result.timedText);
      const nextMedia = {
        ...(mediaSnapshot || media),
        localTranscript: compactTranscriptMeta(result),
      };
      onMedia(nextMedia);
      setStatus(`Local transcript ready · ${result.words.length} word timestamps · ${result.device.toUpperCase()} · raw audio never uploaded.`);
      return result;
    } finally {
      if (jobRef.current === jobId) setTranscriptionBusy(false);
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    jobRef.current += 1;
    const jobId = jobRef.current;
    setError('');
    setStatus('Sampling visual + audio signals locally…');
    try {
      const sampled = await sampleVideo(file);
      const decoded = await decodeAudioLocally(file, sampled.duration);
      if (jobRef.current !== jobId) return;
      revokePreview();
      const previewUrl = URL.createObjectURL(file);
      previewUrlRef.current = previewUrl;
      const nextMedia = {
        ...sampled,
        audio: decoded.audio,
        previewUrl,
        sourceFile: file,
        localTranscript: null,
      };
      onMedia(nextMedia);
      const audioStatus = decoded.audio.status === 'ready'
        ? `${decoded.audio.points.length} local audio points ready`
        : 'audio unavailable';
      setStatus(`Ready: ${sampled.signals.length} visual frames across ${sampled.duration.toFixed(1)}s · ${audioStatus}. Raw media stays in this browser session.`);

      if (autoTranscript && !String(transcript || '').trim() && decoded.samples?.length) {
        await runTranscription({ file, decoded, mediaSnapshot: nextMedia });
      }
    } catch (sampleError) {
      if (jobRef.current !== jobId) return;
      revokePreview();
      onMedia(null);
      setStatus('');
      setError(sampleError?.message || 'Could not analyze this video.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function transcribeCurrentMedia() {
    if (!media?.sourceFile) {
      setError('Re-select the video to generate a local transcript; the original file is not retained after a restored session.');
      return;
    }
    jobRef.current += 1;
    try {
      await runTranscription({ file: media.sourceFile, decoded: null, mediaSnapshot: media });
    } catch (transcriptionError) {
      setError(transcriptionError?.message || 'Local transcription could not complete.');
      setStatus('');
    }
  }

  function removeMedia() {
    jobRef.current += 1;
    revokePreview();
    onMedia(null);
    setStatus('');
    setError('');
    setTranscriptionBusy(false);
  }

  const busy = disabled || transcriptionBusy;
  const transcriptReady = Boolean(media?.localTranscript?.status === 'ready');
  const hasTranscript = Boolean(String(transcript || '').trim());

  return (
    <section className="media-input-panel" aria-label="Video, audio, and local speech-to-text input">
      <div className="media-input-copy">
        <span className="bsn-eyebrow"><Film size={14} aria-hidden="true" /> Multimodal video layer</span>
        <strong>Upload one video. BrainSNN builds the timeline locally.</strong>
        <p>Visual change, audio energy, and optional Whisper speech-to-text run in this browser. The first speech run downloads model weights; the video/audio itself is not sent to the speech model provider.</p>
      </div>

      <div className="local-stt-control">
        <label>
          <input
            type="checkbox"
            checked={autoTranscript}
            onChange={(event) => saveAutoTranscriptPreference(event.target.checked)}
            disabled={busy}
          />
          <span><Mic2 size={15} aria-hidden="true" /><strong>Auto-generate local captions</strong><small>Recommended for client demos</small></span>
        </label>
        <div className="local-stt-capabilities">
          <span>{speechCapabilities.webgpu ? 'WebGPU acceleration available' : 'CPU/WASM fallback'}</span>
          <span>Whisper tiny.en</span>
          <span>Word timestamps</span>
        </div>
      </div>

      <input ref={inputRef} className="bsn-visually-hidden" type="file" accept="video/*" onChange={handleFile} disabled={busy} />
      <div className="media-input-actions">
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {status.startsWith('Sampling') ? <LoaderCircle className="media-spinner" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {media ? 'Replace video' : 'Choose video'}
        </Button>
        {media ? (
          <Button variant="secondary" onClick={transcribeCurrentMedia} disabled={busy || !media.sourceFile}>
            {transcriptionBusy ? <LoaderCircle className="media-spinner" size={16} aria-hidden="true" /> : transcriptReady ? <CheckCircle2 size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
            {transcriptionBusy ? 'Transcribing…' : transcriptReady ? 'Regenerate local captions' : hasTranscript ? 'Replace with local captions' : 'Generate local captions'}
          </Button>
        ) : null}
        {media ? (
          <Button variant="ghost" onClick={removeMedia} disabled={busy}>
            <X size={16} aria-hidden="true" /> Remove
          </Button>
        ) : null}
      </div>

      {media ? (
        <div className="media-ready-card">
          <strong>{media.fileName}</strong>
          <span>
            {media.duration.toFixed(1)}s · {media.signals.length} visual samples · {media.audio?.status === 'ready' ? `${media.audio.points.length} audio points` : 'audio unavailable'}
            {transcriptReady ? ` · ${media.localTranscript.wordCount} local-ASR words` : ''} · raw file stays local
          </span>
        </div>
      ) : null}

      {media?.localTranscript ? (
        <div className="local-stt-ready" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <div><strong>Browser-local transcript ready</strong><small>{media.localTranscript.model} · {media.localTranscript.device} · timestamps are model-estimated, not measured.</small></div>
        </div>
      ) : null}
      {status ? <p className="bsn-note" role="status">{status}</p> : null}
      {error ? <p className="bsn-validation" role="alert">{error}</p> : null}
      <p className="bsn-note">Privacy boundary: raw frames, decoded PCM, and the video file stay in this browser session. Transformers.js and Whisper model files are downloaded to the browser. Generated speech text and compact media features are used by the BrainSNN scan. Verify critical wording/timestamps before presenting them as exact.</p>
    </section>
  );
}
