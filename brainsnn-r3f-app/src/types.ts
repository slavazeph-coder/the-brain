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

export interface AnalysisResult {
  id: string;
  timestamp: string;
  title: string;
  url?: string;
  rawContent: string;
  contentType: 'text' | 'url' | 'video';
  metrics: BrainMetrics;
  attentionCurve: AttentionDatapoint[];
  riskRating: 'Low' | 'Medium' | 'High' | 'Critical';
  riskDescription: string;
  viralScore: number;         // 0-100
  gaugeGapScore: number;      // -50 to +50 or 0-100 (sentiment deviation/manipulatory intent)
  summary: string;
  insights: string[];
  recommendations: string[];
  payloadType: string;        // e.g. "Sensory Burst", "Sensory Salience", "Fear Cascade", "Organic Baseline"
  confidence: number;         // 0-100
  crumbModelStats: CrumbModelStats;
  isFallback?: boolean;
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
  };
  affectProfile?: {
    dominantAffect: string;
    valence: number;
    arousal: number;
    clusters: Array<{ id: string; label: string; value: number }>;
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
    id: string;
    contentHash: string;
    resultHash: string;
    solitonHash?: string;
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
