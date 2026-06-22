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
