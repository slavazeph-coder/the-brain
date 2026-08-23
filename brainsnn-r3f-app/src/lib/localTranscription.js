const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
export const LOCAL_TRANSCRIPT_SCHEMA = 'brainsnn.local-transcript.v0.3';
export const DEFAULT_WHISPER_MODEL = 'onnx-community/whisper-tiny.en';
export const WHISPER_SAMPLE_RATE = 16000;

let transcriberPromise = null;
let transcriberKey = '';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function localSpeechCapabilities(runtime = globalThis) {
  const navigatorRef = runtime?.navigator;
  return {
    browser: Boolean(runtime?.window || runtime?.document || navigatorRef),
    webgpu: Boolean(navigatorRef?.gpu),
    audioContext: Boolean(runtime?.AudioContext || runtime?.webkitAudioContext),
    model: DEFAULT_WHISPER_MODEL,
    sampleRate: WHISPER_SAMPLE_RATE,
    rawAudioUploaded: false,
  };
}

export function resampleAudio(samples, inputSampleRate, outputSampleRate = WHISPER_SAMPLE_RATE) {
  if (!(samples instanceof Float32Array) || !samples.length) return new Float32Array();
  const inputRate = finiteOr(inputSampleRate, outputSampleRate);
  const outputRate = finiteOr(outputSampleRate, WHISPER_SAMPLE_RATE);
  if (inputRate <= 0 || outputRate <= 0) return new Float32Array(samples);
  if (Math.abs(inputRate - outputRate) < 1) return new Float32Array(samples);

  const outputLength = Math.max(1, Math.round(samples.length * (outputRate / inputRate)));
  const output = new Float32Array(outputLength);
  const scale = inputRate / outputRate;
  for (let i = 0; i < outputLength; i += 1) {
    const sourcePosition = i * scale;
    const left = Math.floor(sourcePosition);
    const right = Math.min(samples.length - 1, left + 1);
    const mix = sourcePosition - left;
    output[i] = (samples[left] * (1 - mix)) + (samples[right] * mix);
  }
  return output;
}

export function normalizeWordChunks(chunks = [], duration = 0) {
  const maxDuration = Math.max(0, finiteOr(duration, 0));
  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk, index) => {
      const text = cleanText(chunk?.text);
      if (!text) return null;
      const timestamp = Array.isArray(chunk?.timestamp) ? chunk.timestamp : [];
      let start = Math.max(0, finiteOr(timestamp[0], 0));
      let end = finiteOr(timestamp[1], start + 0.45);
      if (maxDuration > 0) {
        start = Math.min(start, maxDuration);
        end = Math.min(end, maxDuration);
      }
      end = Math.max(start + 0.02, end);
      return { id: `word-${index + 1}`, text, start, end };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function shouldCloseSegment(segmentWords, nextWord, maxWords, maxSeconds) {
  if (!segmentWords.length) return false;
  const first = segmentWords[0];
  const last = segmentWords[segmentWords.length - 1];
  const sentenceEnded = /[.!?…][\"')\]]?$/.test(last.text);
  const tooManyWords = segmentWords.length >= maxWords;
  const tooLong = (last.end - first.start) >= maxSeconds;
  const nextGap = nextWord ? nextWord.start - last.end : 0;
  return sentenceEnded || tooManyWords || tooLong || nextGap >= 1.15;
}

export function groupWordsIntoSegments(words = [], { maxWords = 16, maxSeconds = 8 } = {}) {
  const source = Array.isArray(words) ? words.filter(Boolean) : [];
  if (!source.length) return [];
  const segments = [];
  let bucket = [];

  for (let index = 0; index < source.length; index += 1) {
    bucket.push(source[index]);
    const nextWord = source[index + 1] || null;
    if (!nextWord || shouldCloseSegment(bucket, nextWord, maxWords, maxSeconds)) {
      const start = bucket[0].start;
      const end = bucket[bucket.length - 1].end;
      segments.push({
        id: `asr-segment-${segments.length + 1}`,
        start,
        end,
        text: cleanText(bucket.map((word) => word.text).join(' ')),
        wordCount: bucket.length,
      });
      bucket = [];
    }
  }
  return segments;
}

export function formatTranscriptTimestamp(seconds = 0) {
  const safe = Math.max(0, finiteOr(seconds, 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const secondsText = secs.toFixed(1).padStart(4, '0');
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secondsText}`
    : `${String(minutes).padStart(2, '0')}:${secondsText}`;
}

export function transcriptSegmentsToBracketedText(segments = []) {
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => cleanText(segment?.text))
    .map((segment) => `[${formatTranscriptTimestamp(segment.start)}] ${cleanText(segment.text)}`)
    .join('\n');
}

export function normalizeTranscriptionOutput(output = {}, { duration = 0, model = DEFAULT_WHISPER_MODEL, device = 'wasm' } = {}) {
  const words = normalizeWordChunks(output?.chunks, duration);
  const segments = groupWordsIntoSegments(words);
  const fallbackText = cleanText(output?.text);
  const timedText = segments.length
    ? transcriptSegmentsToBracketedText(segments)
    : (fallbackText ? `[00:00.0] ${fallbackText}` : '');
  const text = fallbackText || cleanText(words.map((word) => word.text).join(' '));

  return {
    schemaVersion: LOCAL_TRANSCRIPT_SCHEMA,
    status: text ? 'ready' : 'empty',
    text,
    timedText,
    words,
    segments,
    timing: words.length ? 'model-word-timestamps' : 'model-segment-start',
    timingIsMeasured: false,
    provider: 'transformers.js',
    model,
    device,
    rawAudioUploaded: false,
    disclaimer: 'Speech and timestamps are model-generated locally in the browser. They can contain transcription or timing errors and should be verified for critical claims.',
  };
}

async function defaultModuleLoader(url) {
  return import(/* @vite-ignore */ url);
}

function progressFraction(event) {
  const progress = finiteOr(event?.progress, NaN);
  if (Number.isFinite(progress)) return clamp(progress > 1 ? progress / 100 : progress, 0, 1);
  const loaded = finiteOr(event?.loaded, NaN);
  const total = finiteOr(event?.total, NaN);
  return Number.isFinite(loaded) && Number.isFinite(total) && total > 0 ? clamp(loaded / total, 0, 1) : null;
}

function emitProgress(callback, stage, detail = {}, fraction = null) {
  if (typeof callback !== 'function') return;
  callback({ stage, fraction, ...detail });
}

async function getTranscriber({ model, preferWebGPU, moduleLoader, onProgress, pipelineFactory, runtime = globalThis } = {}) {
  const selectedModel = model || DEFAULT_WHISPER_MODEL;
  const capabilities = localSpeechCapabilities(runtime);
  const requestedDevice = preferWebGPU !== false && capabilities.webgpu ? 'webgpu' : 'wasm';
  const key = `${selectedModel}:${requestedDevice}`;
  if (transcriberPromise && transcriberKey === key) return { transcriber: await transcriberPromise, device: requestedDevice };

  transcriberKey = key;
  transcriberPromise = (async () => {
    const module = pipelineFactory ? null : await (moduleLoader || defaultModuleLoader)(TRANSFORMERS_CDN);
    const pipeline = pipelineFactory || module?.pipeline;
    if (typeof pipeline !== 'function') throw new Error('Transformers.js speech pipeline could not be loaded.');
    if (module?.env) module.env.allowLocalModels = false;

    const progress_callback = (event) => {
      emitProgress(onProgress, 'model-download', {
        file: event?.file || event?.name || '',
        status: event?.status || '',
      }, progressFraction(event));
    };

    const options = { progress_callback };
    if (requestedDevice === 'webgpu') options.device = 'webgpu';
    emitProgress(onProgress, 'model-loading', { model: selectedModel, device: requestedDevice }, 0);
    return pipeline('automatic-speech-recognition', selectedModel, options);
  })();

  try {
    return { transcriber: await transcriberPromise, device: requestedDevice };
  } catch (error) {
    if (requestedDevice !== 'webgpu') {
      transcriberPromise = null;
      transcriberKey = '';
      throw error;
    }
    emitProgress(onProgress, 'webgpu-fallback', { reason: error?.message || 'WebGPU initialization failed.' }, null);
    transcriberPromise = null;
    transcriberKey = '';
    return getTranscriber({ model: selectedModel, preferWebGPU: false, moduleLoader, onProgress, pipelineFactory, runtime });
  }
}

async function runInference(transcriber, waveform) {
  return transcriber(waveform, {
    return_timestamps: 'word',
    chunk_length_s: 30,
    stride_length_s: 5,
  });
}

export async function transcribeAudioLocally({
  samples,
  sampleRate,
  duration = 0,
  model = DEFAULT_WHISPER_MODEL,
  preferWebGPU = true,
  onProgress,
  moduleLoader,
  pipelineFactory,
  runtime = globalThis,
} = {}) {
  if (!(samples instanceof Float32Array) || !samples.length) throw new Error('No decoded audio samples are available for transcription.');
  emitProgress(onProgress, 'resampling', { inputSampleRate: sampleRate, outputSampleRate: WHISPER_SAMPLE_RATE }, 0);
  const waveform = resampleAudio(samples, sampleRate, WHISPER_SAMPLE_RATE);
  let { transcriber, device } = await getTranscriber({ model, preferWebGPU, moduleLoader, onProgress, pipelineFactory, runtime });
  emitProgress(onProgress, 'transcribing', { model, device, seconds: duration || (waveform.length / WHISPER_SAMPLE_RATE) }, 0);

  let output;
  try {
    output = await runInference(transcriber, waveform);
  } catch (error) {
    if (device !== 'webgpu') throw error;
    emitProgress(onProgress, 'webgpu-inference-fallback', { reason: error?.message || 'WebGPU inference failed.' }, null);
    transcriberPromise = null;
    transcriberKey = '';
    const fallback = await getTranscriber({ model, preferWebGPU: false, moduleLoader, onProgress, pipelineFactory, runtime });
    transcriber = fallback.transcriber;
    device = fallback.device;
    emitProgress(onProgress, 'transcribing', { model, device, seconds: duration || (waveform.length / WHISPER_SAMPLE_RATE), retry: true }, 0);
    output = await runInference(transcriber, waveform);
  }

  const result = normalizeTranscriptionOutput(output, { duration, model, device });
  emitProgress(onProgress, 'complete', { wordCount: result.words.length, segmentCount: result.segments.length, device }, 1);
  return result;
}

export function __resetLocalTranscriberForTests() {
  transcriberPromise = null;
  transcriberKey = '';
}
