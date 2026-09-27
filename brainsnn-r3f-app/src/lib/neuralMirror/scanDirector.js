import { analyzeContentLocally } from '../analysisEngine.js';
import { analyzeEvidenceGaps } from '../evidenceGapAnalyzer.js';
import { runLayerRouter } from '../layerRouter.js';
import {
  buildFeatureSequence,
  extractMultimodalFeatures,
  normalizeMultimodalInput,
  segmentMultimodalInput,
} from '../multimodal/index.js';
import { createComputeRouter } from './computeRouter.js';
import { createModelRegistry } from './modelRegistry.js';
import { createScanReceipt } from './receipts.js';
import { NEURAL_PREDICTION_DISCLAIMER } from './schema.js';
import { detectNeuralTemporalEvents } from './temporalEvents.js';

export const CREATIVE_SCAN_SCHEMA_VERSION = 'brainsnn.creative-scan.v1';

function elapsed(start, clock) {
  return Number(Math.max(0, clock() - start).toFixed(3));
}

function errorMessage(error) {
  return String(error?.message || 'unknown_error').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500);
}

function normalizeDirectorInput(value) {
  if (typeof value === 'string') {
    return { source: { type: 'text', mimeType: 'text/plain' }, text: { transcript: value } };
  }
  return value;
}

function contentForCreativeScan(input, segments) {
  const transcript = String(input.text?.transcript || '').trim();
  if (transcript) return transcript;
  const segmentText = segments.map((segment) => segment.text).filter(Boolean).join(' ').trim();
  if (segmentText) return segmentText;
  if (input.source.filename) return `Creative asset: ${input.source.filename}`;
  return `Untitled ${input.source.type} creative`;
}

function creativeContentType(input, requested) {
  if (requested) return String(requested);
  if (input.source.type === 'mixed') return 'video';
  return input.source.type;
}

function layerSignals(result) {
  return {
    metrics: result.metrics,
    viralScore: result.viralScore,
    gaugeGapScore: result.gaugeGapScore,
    riskRating: result.riskRating,
    confidence: result.confidence,
    firewallSignals: result.firewallSignals,
    affectProfile: result.affectProfile,
    solitonField: result.solitonField,
    recommendations: result.recommendations,
  };
}

function runCreativeAnalysis(content, contentType) {
  const baseResult = analyzeContentLocally({ content, contentType, forceFallback: true });
  return runLayerRouter({
    content,
    contentType,
    baseResult,
    providerTrace: [{ stage: 'Neural Mirror separation', status: 'independent', note: 'Commercial creative signals remain separate from model-predicted neural response.' }],
    engineStatus: { tribe: { configured: false, enabled: false, status: 'excluded_research_only', researchOnly: true, commercialUse: false } },
  });
}

function segmentCreativeTimeline(segments, contentType, maximum = 240) {
  return segments.slice(0, maximum).map((segment) => {
    if (!segment.text) {
      return {
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        status: 'unavailable',
        reason: 'segment_transcript_unavailable',
      };
    }
    try {
      const result = runCreativeAnalysis(segment.text, contentType);
      return {
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        status: 'available',
        signals: layerSignals(result),
      };
    } catch (error) {
      return {
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        status: 'failed',
        reason: errorMessage(error),
      };
    }
  });
}

function recommendationFromEvidence(item) {
  if (!item) return null;
  const proof = Array.isArray(item.mostValuableProof) ? item.mostValuableProof : [];
  return {
    id: item.id || 'evidence-gap-specific',
    title: item.title || 'Make the strongest claim checkable',
    goal: 'Strengthen evidence',
    rationale: item.rationale,
    rewriteHint: [item.recommendedEdit, proof.length ? `Most valuable proof: ${proof.join(' ')}` : ''].filter(Boolean).join(' '),
    recommendedEdit: item.recommendedEdit,
    mostValuableProof: proof,
    ...(Number.isFinite(item.timestampMs) ? { timestampMs: item.timestampMs } : {}),
  };
}

function insightFromEvidence(item) {
  if (!item) return null;
  return {
    label: 'Strongest evidence gap',
    text: [item.rationale, item.recommendedEdit].filter(Boolean).join(' '),
    ...(Number.isFinite(item.timestampMs) ? { timestampMs: item.timestampMs } : {}),
  };
}

function dedupeBy(items, identity) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item) return false;
    const key = identity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalCompatibilityProjection(neural) {
  if (!neural) return null;
  const view = neural.compatibilityViews.broadRegions7;
  return {
    source: 'Neural Mirror predicted parcel compatibility view',
    status: 'predicted_compatibility_only',
    scenario: 'Modelled Response',
    regions: view.regions,
    mappingId: view.mappingId,
    mappingProvenance: view.provenance,
    modelled: true,
    measured: false,
    note: 'Derived from the canonical predicted parcel timeline for legacy visualization only; it is not a measured brain scan.',
    disclaimer: NEURAL_PREDICTION_DISCLAIMER,
  };
}

function stageTelemetry(stage, latencyMs, extra = {}) {
  return { stage, latencyMs, ...extra };
}

export function createScanDirector(options = {}) {
  const env = options.env || (typeof process !== 'undefined' ? process.env : {});
  const clock = options.clock || (() => Date.now());
  const now = options.now || (() => new Date());
  const parcelCount = Math.max(1, Math.min(10_000, Number(options.parcelCount || env.NEURAL_PARCEL_COUNT) || 1000));
  const registry = options.registry || createModelRegistry({
    env,
    fetchImpl: options.fetchImpl,
    artifact: options.artifact,
    rawArtifactJson: options.rawArtifactJson,
    modelPath: options.modelPath,
    workerUrl: options.workerUrl,
    workerToken: options.workerToken,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    delay: options.delay,
    parcelCount,
    seed: options.seed,
  });
  const router = options.router || createComputeRouter({ registry, clock, parcelCount });

  return {
    registry,
    async run(value, runOptions = {}) {
      const totalStarted = clock();
      const telemetryStages = [];
      const errors = [];
      const fallbacks = [];
      const scanTrace = [];

      let started = clock();
      const input = normalizeMultimodalInput(normalizeDirectorInput(value), runOptions);
      telemetryStages.push(stageTelemetry('ingest', elapsed(started, clock), { device: 'cpu' }));
      scanTrace.push('ingest.complete');

      started = clock();
      const segments = segmentMultimodalInput(input, runOptions);
      telemetryStages.push(stageTelemetry('segmentation', elapsed(started, clock), { device: 'cpu', segmentsProcessed: segments.length }));
      scanTrace.push(`segments.${segments.length}`);

      started = clock();
      const extracted = await extractMultimodalFeatures(input, { ...runOptions, segments, extractors: runOptions.extractors || options.extractors });
      const features = buildFeatureSequence(extracted, runOptions);
      telemetryStages.push(stageTelemetry('feature_extraction', elapsed(started, clock), { device: 'cpu' }));
      for (const modality of ['vision', 'audio', 'language']) {
        const status = features.modalityStatus[modality]?.status || 'unavailable';
        scanTrace.push(`${modality}.${status === 'available' ? 'complete' : status}`);
        if (status === 'failed') errors.push({ stage: modality, message: features.modalityStatus[modality].reason });
      }

      started = clock();
      let neural = null;
      let computeTrace = [];
      let neuralStatus;
      try {
        const routed = await router.route(features, {
          ...runOptions,
          seed: runOptions.seed ?? options.seed,
        });
        neural = routed.prediction;
        computeTrace = routed.computeTrace;
        neuralStatus = {
          status: 'available',
          modelStatus: neural.modelStatus,
          model: neural.model,
          disclaimer: NEURAL_PREDICTION_DISCLAIMER,
        };
        scanTrace.push(`neural.${routed.adapter.id}.complete`);
        const failedBeforeSuccess = computeTrace.filter((item) => ['failed', 'unavailable', 'timeout'].includes(item.status));
        fallbacks.push(...failedBeforeSuccess.map((item) => ({ stage: 'neural', engine: item.engine, reason: item.reason || item.status })));
      } catch (error) {
        computeTrace = error.computeTrace || [];
        const message = errorMessage(error);
        neuralStatus = {
          status: 'unavailable',
          modelStatus: 'unavailable',
          reason: message,
          disclaimer: NEURAL_PREDICTION_DISCLAIMER,
          provenance: { commercialUse: true, researchOnly: false, generatedPrediction: false },
        };
        errors.push({ stage: 'neural_prediction', message });
        fallbacks.push({ stage: 'neural_prediction', reason: 'creative_analysis_continued_without_neural_prediction' });
        scanTrace.push('neural.unavailable');
      }
      telemetryStages.push(stageTelemetry('neural_prediction', elapsed(started, clock), {
        device: neural?.model?.device || 'unavailable',
        model: neural?.model?.id || 'unavailable',
        ...(neural ? {} : { error: neuralStatus.reason }),
      }));

      started = clock();
      const neuralEvents = neural ? detectNeuralTemporalEvents(neural, runOptions) : [];
      telemetryStages.push(stageTelemetry('temporal_events', elapsed(started, clock), { device: 'cpu' }));
      scanTrace.push(neural ? `events.${neuralEvents.length}` : 'events.unavailable');

      started = clock();
      const content = contentForCreativeScan(input, segments);
      const contentType = creativeContentType(input, runOptions.contentType || runOptions.context);
      const aggregateCreative = runCreativeAnalysis(content, contentType);
      const segmentTimeline = segmentCreativeTimeline(segments, contentType, runOptions.maximumCreativeSegments || 240);
      const creativeSignals = {
        schemaVersion: 'brainsnn.creative-signals.v1',
        source: 'BrainSNN deterministic layer stack',
        aggregate: aggregateCreative,
        timeline: segmentTimeline,
        segmentsAnalyzed: segmentTimeline.filter((item) => item.status === 'available').length,
        segmentsTotal: segments.length,
        truncated: segmentTimeline.length < segments.length,
      };
      telemetryStages.push(stageTelemetry('creative_analysis', elapsed(started, clock), { device: 'cpu', segmentsProcessed: segmentTimeline.length }));
      scanTrace.push('creative.complete');

      started = clock();
      const evidenceGaps = analyzeEvidenceGaps({ content, contentType, context: runOptions.context || contentType, segments });
      const specificRecommendation = recommendationFromEvidence(evidenceGaps.topRecommendation);
      const specificInsight = insightFromEvidence(evidenceGaps.topRecommendation);
      telemetryStages.push(stageTelemetry('evidence_gap_analysis', elapsed(started, clock), { device: 'cpu' }));
      scanTrace.push('evidence.complete');

      started = clock();
      const receiptPrediction = neural || {
        model: { id: 'unavailable', version: 'not-generated', device: 'unavailable' },
        status: 'unavailable',
        disclaimer: NEURAL_PREDICTION_DISCLAIMER,
      };
      const neuralReceipt = createScanReceipt({
        input,
        features,
        prediction: receiptPrediction,
        now,
        seed: Number(runOptions.seed ?? options.seed) || 2026,
      });
      const creativeReceipt = aggregateCreative.receipt || {};
      const receipt = {
        ...neuralReceipt,
        // The V1 primary ID is semantic/deterministic; retain every legacy field alongside it.
        id: neuralReceipt.id,
        combinedReceiptId: neuralReceipt.id,
        legacyReceiptId: creativeReceipt.id || null,
        creativeReceiptId: creativeReceipt.id || null,
        contentHash: creativeReceipt.contentHash,
        resultHash: creativeReceipt.resultHash,
        solitonHash: creativeReceipt.solitonHash,
        creativeGeneratedAt: creativeReceipt.generatedAt,
        creativeDisclaimer: creativeReceipt.disclaimer,
        disclaimer: NEURAL_PREDICTION_DISCLAIMER,
      };
      const legacyProjection = canonicalCompatibilityProjection(neural) || aggregateCreative.tribeProjection;
      const recommendations = dedupeBy(
        [specificRecommendation, ...(aggregateCreative.recommendations || [])],
        (item) => typeof item === 'string' ? `string:${item}` : `${item.id || ''}|${item.title || ''}`,
      );
      const insights = dedupeBy(
        [specificInsight, ...(aggregateCreative.insights || [])],
        (item) => typeof item === 'string' ? `string:${item}` : `${item.label || ''}|${item.text || ''}`,
      );
      scanTrace.push('report.complete');
      const reportLatency = elapsed(started, clock);
      telemetryStages.push(stageTelemetry('report_assembly', reportLatency, { device: 'cpu' }));
      const memoryMb = typeof process !== 'undefined' && process.memoryUsage
        ? Number((process.memoryUsage().rss / 1024 / 1024).toFixed(3))
        : null;

      return {
        ...aggregateCreative,
        schemaVersion: CREATIVE_SCAN_SCHEMA_VERSION,
        recommendations,
        insights,
        tribeProjection: legacyProjection,
        stimulus: {
          id: input.id,
          source: input.source,
          temporal: {
            startMs: input.temporal.startMs,
            endMs: input.temporal.endMs,
            segmentCount: segments.length,
            segments: segments.map((segment) => ({
              id: segment.id,
              index: segment.index,
              startMs: segment.startMs,
              endMs: segment.endMs,
              ...(segment.text ? { text: segment.text } : {}),
              features: segment.features,
            })),
          },
        },
        multimodalInput: input,
        neural,
        neuralStatus,
        modalityStatus: features.modalityStatus,
        neuralEvents,
        creativeSignals,
        evidenceGaps,
        sourceLabels: {
          neural: neural ? `${neural.model.id} v${neural.model.version}` : 'Neural Mirror unavailable; no prediction generated',
          creativeSignals: 'BrainSNN deterministic layer stack',
          evidence: 'EvidenceGapAnalyzer v1 deterministic',
        },
        scanTrace,
        computeTrace,
        telemetry: {
          schemaVersion: 'brainsnn.scan-telemetry.v1',
          totalLatencyMs: elapsed(totalStarted, clock),
          stages: telemetryStages,
          device: neural?.model?.device || 'cpu',
          model: neural?.model?.id || null,
          inputDurationMs: input.source.durationMs || input.temporal.endMs - input.temporal.startMs,
          segmentsProcessed: segments.length,
          memoryMb,
          errors,
          fallbacks,
          gpuSeconds: null,
          vramPeakMb: null,
          watts: null,
          cost: null,
          customerRevenue: null,
          revenuePerGpuHour: null,
        },
        receipt,
        disclaimer: NEURAL_PREDICTION_DISCLAIMER,
      };
    },
  };
}

export const ScanDirector = { create: createScanDirector };
