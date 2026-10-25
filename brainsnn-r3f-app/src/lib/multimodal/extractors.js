const LICENSE = Object.freeze({ id: 'brainsnn-proprietary-code', name: 'BrainSNN lightweight deterministic features', commercialUse: true });

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : 0;
}

function mean(items, key) {
  const values = items.map((item) => Number(item?.[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function elapsed(start, clock) {
  return Number(Math.max(0, clock() - start).toFixed(3));
}

function metadata(extractor, latencyMs) {
  return {
    id: extractor.id,
    version: extractor.version,
    modality: extractor.modality,
    implementation: extractor.implementation,
    model: extractor.model,
    license: extractor.license,
    device: 'cpu',
    latencyMs,
    embeddingDimension: extractor.dimension,
  };
}

function unavailable(extractor, reason, latencyMs = 0) {
  return { status: 'unavailable', reason, vector: new Array(extractor.dimension).fill(0), metadata: metadata(extractor, latencyMs) };
}

function lexicalFeatures(text) {
  const lower = String(text || '').toLowerCase();
  const words = lower.match(/[\p{L}\p{N}'-]+/gu) || [];
  const unique = new Set(words);
  const sentences = lower.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const count = (pattern) => (lower.match(pattern) || []).length;
  return [
    clamp(words.length / 80),
    clamp(lower.length / 600),
    clamp(unique.size / Math.max(1, words.length)),
    clamp(sentences.length / 12),
    clamp(count(/\d+(?:[.,]\d+)?%?|\$\s?\d+/g) / 5),
    clamp(count(/\b(proof|because|data|tested|customer|result|source|example|measured|pilot)\b/g) / 6),
    clamp(count(/\b(now|urgent|limited|last chance|immediately|deadline)\b/g) / 5),
    clamp(count(/\b(you|your|we|our|together|customer)\b/g) / 8),
    clamp(count(/\?/g) / 4),
    clamp(count(/!/g) / 4),
    clamp(count(/\b(not|never|without|cannot|can't|don't)\b/g) / 6),
    clamp(words.reduce((sum, word) => sum + word.length, 0) / Math.max(1, words.length) / 12),
  ].map((value) => Number(value.toFixed(6)));
}

export function createVisionCpuExtractor({ clock = () => Date.now() } = {}) {
  const extractor = {
    id: 'brainsnn-vision-cpu-signals',
    version: '1.0.0',
    modality: 'vision',
    implementation: 'deterministic-statistical',
    model: 'no-learned-model',
    license: LICENSE,
    dimension: 8,
    capabilities: () => ({ modalities: ['video', 'image', 'mixed'], device: 'cpu', requiresModelDownload: false }),
    async extract({ input, segment }) {
      const start = clock();
      const observations = segment?.observations?.vision || [];
      const features = segment?.features || {};
      const applicable = ['video', 'image', 'mixed'].includes(input?.source?.type);
      const hasSignal = observations.length > 0 || ['sceneChange', 'visualChange', 'motion', 'luminance'].some((key) => Number.isFinite(Number(features[key])));
      if (!applicable || !hasSignal) return unavailable(extractor, applicable ? 'no_visual_observations' : 'source_has_no_visual_modality', elapsed(start, clock));
      const vector = [
        mean(observations, 'luminance') ?? clamp(features.luminance),
        mean(observations, 'motion') ?? clamp(features.motion ?? features.visualChange),
        mean(observations, 'red') ?? clamp(features.red),
        mean(observations, 'green') ?? clamp(features.green),
        mean(observations, 'blue') ?? clamp(features.blue),
        clamp(features.sceneChange),
        clamp(features.visualChange),
        clamp((segment.endMs - segment.startMs) / 10_000),
      ].map((value) => Number(clamp(value).toFixed(6)));
      return { status: 'available', vector, metadata: metadata(extractor, elapsed(start, clock)) };
    },
  };
  return extractor;
}

export function createAudioCpuExtractor({ clock = () => Date.now() } = {}) {
  const extractor = {
    id: 'brainsnn-audio-cpu-signals',
    version: '1.0.0',
    modality: 'audio',
    implementation: 'deterministic-statistical',
    model: 'no-learned-model',
    license: LICENSE,
    dimension: 8,
    capabilities: () => ({ modalities: ['video', 'audio', 'mixed'], device: 'cpu', requiresModelDownload: false }),
    async extract({ input, segment }) {
      const start = clock();
      const observations = segment?.observations?.audio || [];
      const features = segment?.features || {};
      const applicable = ['video', 'audio', 'mixed'].includes(input?.source?.type);
      const hasSignal = observations.length > 0 || ['audioEnergy', 'spectralCentroid', 'zeroCrossingRate', 'speechPresent'].some((key) => features[key] !== undefined);
      if (!applicable || !hasSignal) return unavailable(extractor, applicable ? 'no_audio_observations' : 'source_has_no_audio_modality', elapsed(start, clock));
      const energyValues = observations.map((item) => clamp(item.audioEnergy));
      const energy = energyValues.length ? energyValues.reduce((sum, item) => sum + item, 0) / energyValues.length : clamp(features.audioEnergy);
      const variance = energyValues.length
        ? energyValues.reduce((sum, item) => sum + ((item - energy) ** 2), 0) / energyValues.length
        : 0;
      const speechFraction = observations.length
        ? observations.filter((item) => item.speechPresent).length / observations.length
        : Number(Boolean(features.speechPresent));
      const vector = [
        energy,
        clamp(Math.sqrt(variance)),
        mean(observations, 'spectralCentroid') ?? clamp(features.spectralCentroid),
        mean(observations, 'zeroCrossingRate') ?? clamp(features.zeroCrossingRate),
        clamp(speechFraction),
        clamp(observations.length / 20),
        clamp((segment.endMs - segment.startMs) / 10_000),
        clamp(energy * (0.5 + speechFraction * 0.5)),
      ].map((value) => Number(clamp(value).toFixed(6)));
      return { status: 'available', vector, metadata: metadata(extractor, elapsed(start, clock)) };
    },
  };
  return extractor;
}

export function createLanguageCpuExtractor({ clock = () => Date.now() } = {}) {
  const extractor = {
    id: 'brainsnn-language-cpu-lexical',
    version: '1.0.0',
    modality: 'language',
    implementation: 'deterministic-lexical-statistics',
    model: 'no-learned-model',
    license: LICENSE,
    dimension: 12,
    capabilities: () => ({ modalities: ['text', 'video', 'audio', 'image', 'mixed'], device: 'cpu', requiresModelDownload: false }),
    async extract({ segment }) {
      const start = clock();
      const text = String(segment?.text || '').trim();
      if (!text) return unavailable(extractor, 'transcript_unavailable', elapsed(start, clock));
      return { status: 'available', vector: lexicalFeatures(text), metadata: metadata(extractor, elapsed(start, clock)) };
    },
  };
  return extractor;
}

export function createDefaultCpuExtractors(options = {}) {
  return [createVisionCpuExtractor(options), createAudioCpuExtractor(options), createLanguageCpuExtractor(options)];
}

export function extractorCapabilities(extractors = createDefaultCpuExtractors()) {
  return extractors.map((extractor) => ({
    id: extractor.id,
    version: extractor.version,
    modality: extractor.modality,
    dimension: extractor.dimension,
    ...extractor.capabilities(),
  }));
}
