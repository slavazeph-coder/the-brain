/**
 * Shared Type Definitions for BrainSNN.com Affective Intelligence
 */

export interface BrainMetrics {
  fear: number;          // 0-100
  anger: number;         // 0-100
  urgency: number;       // 0-100
  trust: number;         // 0-100
  excitement: number;    // 0-100
  empathy: number;       // 0-100
  firingRate: number;    // Hz (overall spiking neural network rate)
  plasticity: number;    // % (adaptability or neuromodulation level)
}

export interface AttentionDatapoint {
  second: number;
  level: number;
}

export interface CrumbModelStats {
  wavesDamping: number;      // alpha parameter
  wavesFrequency: number;    // omega parameter
  attentionComplexity: string; // O(N log N) wave-equation complexity info
   perplexityDelta: number;   // % comparison to standard transformer
}

export type MultimodalSourceType = 'text' | 'video' | 'audio' | 'image' | 'mixed';
export type NeuralModality = 'vision' | 'audio' | 'language';

export interface ComputeDevice {
  id?: string;
  type: 'cpu' | 'cuda' | 'remote';
  name: string;
  memoryMb?: number;
  capabilities?: string[];
}

export interface MultimodalObservation {
  timestampMs: number;
  speechPresent?: boolean;
  [feature: string]: number | boolean | undefined;
}

export interface MultimodalInput {
  schemaVersion: 'brainsnn.multimodal.v1';
  id: string;
  source: {
    type: MultimodalSourceType;
    filename?: string;
    url?: string;
    durationMs?: number;
    mimeType?: string;
  };
  text?: {
    transcript?: string;
    language?: string;
  };
  temporal?: {
    startMs: number;
    endMs: number;
    segments?: TemporalSegment[];
  };
  observations?: {
    vision?: MultimodalObservation[];
    audio?: MultimodalObservation[];
  };
  signals?: {
    vision?: MultimodalObservation[];
    audio?: MultimodalObservation[];
  };
  provenance: {
    userProvided: boolean;
    extractorVersions: Record<string, string>;
  };
}

export interface TemporalSegment {
  id?: string;
  index: number;
  startMs: number;
  endMs: number;
  text?: string;
  features?: {
    sceneChange?: number;
    audioEnergy?: number;
    speechPresent?: boolean;
    visualChange?: number;
  };
}

export interface NeuralTimelineFrame {
  startMs: number;
  endMs: number;
  activations: number[];
  confidence: number;
  modalityContribution?: Partial<Record<NeuralModality, number>>;
}

export interface NeuralPrediction {
  schemaVersion: 'brainsnn.neural-prediction.v1';
  model: {
    id: string;
    version: string;
    device: string | ComputeDevice;
    status?: string;
  };
  modelStatus?: string;
  referenceSpace: {
    type: 'abstract' | 'parcel' | 'fsaverage' | 'mni152';
    atlas?: string;
    parcelCount?: number;
  };
  timeline: NeuralTimelineFrame[];
  summary: {
    meanActivation: number;
    peakActivation: number;
    peakTimestampMs: number;
    temporalVariance: number;
  };
  evidence: {
    method: string;
    validatedAgainstNeuralData: boolean;
    benchmarkId?: string;
    confidenceMethod: string;
  };
  provenance: {
    disclaimer: string;
    commercialUse: boolean;
    researchOnly: boolean;
    [metadata: string]: unknown;
  };
  compatibilityViews?: {
    broadRegions7?: {
      mappingId: string;
      sourceSpace: string;
      derived: boolean;
      regions: Record<string, number>;
      provenance: Record<string, unknown>;
      disclaimer: string;
    };
    [view: string]: unknown;
  };
  disclaimer: string;
}

export interface NeuralTemporalEvent {
  timestampMs: number;
  type: string;
  confidence: number;
  description: string;
}

export interface ModalityStatus {
  status: 'available' | 'unavailable' | 'failed' | 'not_configured' | 'not_reported' | string;
  reason?: string;
  implementation?: string;
  extractor?: string | Record<string, unknown>;
  [metadata: string]: unknown;
}

export interface ComputeTraceEntry {
  engine: string;
  status: string;
  [metadata: string]: unknown;
}

export interface StimulusSummary {
  id: string;
  source: MultimodalInput['source'];
  temporal: {
    startMs: number;
    endMs: number;
    segmentCount: number;
    segments: TemporalSegment[];
  };
}

export interface EvidenceGapResult {
  schemaVersion: 'brainsnn.evidence-gaps.v1';
  context: string;
  claims: Array<Record<string, unknown>>;
  evidenceInventory: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  recommendations: Array<Record<string, unknown>>;
  topRecommendation: Record<string, unknown> | null;
  summary: string;
  limitations: string;
}

export interface AnalysisResult {
  id: string;
  timestamp: string;
  title: string;
  url?: string;
  rawContent: string;
  contentType: 'text' | 'url' | 'webpage' | 'video' | 'audio' | 'image' | 'mixed' | 'neural';
  metrics: BrainMetrics;
  attentionCurve: AttentionDatapoint[];
  riskRating: 'Low' | 'Medium' | 'High' | 'Critical';
  riskDescription: string;
  viralScore: number;         // 0-100
  gaugeGapScore: number;      // -50 to +50 or 0-100 (sentiment deviation/manipulatory intent)
  summary: string;
  insights: Array<string | { label?: string; text?: string; timestampMs?: number }>;
  recommendations: Array<string | {
    id?: string;
    goal?: string;
    title?: string;
    rewriteHint?: string;
    rationale?: string;
    text?: string;
    recommendedEdit?: string;
    mostValuableProof?: string[];
    timestampMs?: number;
  }>;
  payloadType: string;        // e.g. "Sensory Burst", "Sensory Salience", "Fear Cascade", "Organic Baseline"
  confidence: number;         // 0-100
  crumbModelStats: CrumbModelStats;
  isFallback?: boolean;
  neural?: NeuralPrediction | null;
  neuralStatus?: string | ({ status: string; reason?: string } & Record<string, unknown>);
  modalityStatus?: Partial<Record<NeuralModality, ModalityStatus | string>>;
  neuralEvents?: NeuralTemporalEvent[];
  scanTrace?: Array<string | { stage?: string; event?: string; status?: string }>;
  computeTrace?: ComputeTraceEntry[];
  sourceLabels?: { neural?: string; creativeSignals?: string };
  stimulus?: StimulusSummary;
  multimodalInput?: MultimodalInput;
  multimodal?: Record<string, unknown>;
  creativeSignals?: Record<string, unknown>;
  evidenceGaps?: EvidenceGapResult;
  telemetry?: Record<string, unknown>;
  layersUsed?: Array<{ id: number; name: string; group: string; blurb: string }>;
  engineTrace?: Array<{ stage: string; status: string; provider?: string; note: string }>;
  firewallSignals?: {
    emotionalActivation: number;
    cognitiveSuppression: number;
    manipulationPressure: number;
    trustErosion: number;
    density?: number;
    evidence?: Array<{ label: string; match: string }>;
    templates?: Array<{ id: string; label: string; risk: string }>;
    source?: string;
    grade?: string;
    tier?: string;
    wordCount?: number;
    categories?: Array<{ id: string; label: string; hits: number; score: number; matches: string[] }>;
    heatmap?: Array<{ id: string; text: string; pressure: number; top: string }>;
    tactics?: Array<{ id: string; label: string; confidence: number; risk: string }>;
  };
  affectProfile?: {
    dominantAffect: string;
    valence: number;
    arousal: number;
    clusters: Array<{ id: string; label: string; value: number }>;
    taxonomy?: Array<{ id: string; label: string; x: number; y: number; score: number }>;
    dominantEmotion?: string;
    circumplex?: { x: number; y: number };
    trajectory?: Array<{ id: string; text: string; valence: number; arousal: number }>;
  };
  contextTriggers?: {
    genre: string;
    entityCandidates: string[];
    recurringSignals: string[];
    memoryPrompt: string;
  };
  tribeProjection?: {
    source: string;
    status: string;
    scenario: string;
    regions: Record<string, number>;
    note: string;
  };
  solitonField?: {
    layer: number;
    label: string;
    band: string;
    baseFrequencyHz: number;
    contextualBaseHz: number;
    effectiveFrequencyHz: number;
    detuneHz: number;
    gammaCoherence: number;          // 0-1 Kuramoto order parameter
    synchrony: 'bound' | 'partial' | 'desynchronized';
    confinement: number;             // 0-1
    bindingScore: number;            // 0-100
    protofilaments: number;
    solitons: Array<{ id: string; position: number; amplitude: number; velocity: number; width: number; track: number[] }>;
    leapfrogEvents: number;
    collisions: Array<{ tMs: number; pair: [number, number]; phaseShift: number }>;
    solitonEnergy: number;
    energyConserved: boolean;
    ionicDrive: number;              // 0-1
    oscillationBands: { delta: number; theta: number; alpha: number; beta: number; gamma: number };
    thetaGammaPAC: number;           // 0-1 phase-amplitude coupling
    coherenceTrace: number[];
    frequencyTraceHz: number[];
    sampleTimesMs: number[];
    spectralPeaks: Array<{ freqHz: number; power: number }>;
    note: string;
    disclaimer: string;
  };
  receipt?: {
    schemaVersion?: string;
    id: string;
    inputHash?: string;
    contentHash?: string;
    resultHash?: string;
    solitonHash?: string;
    featureHash?: string;
    neuralPredictionHash?: string;
    deterministicFingerprint?: string;
    combinedReceiptId?: string;
    legacyReceiptId?: string | null;
    creativeReceiptId?: string | null;
    modelVersion?: string;
    model?: { id: string; version: string };
    extractorVersions?: Record<string, string>;
    device?: string | ComputeDevice;
    pipelineVersion?: string;
    randomSeed?: string | number;
    generatedAt: string;
    disclaimer: string;
  };
  researchNotes?: string[];
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  popular: boolean;
}
