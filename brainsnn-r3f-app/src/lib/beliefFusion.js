import { attachBeliefReport } from './beliefReport.js';
import { buildClientMultimodalFusion } from './multimodalClientFusion.js';

function formatTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function formatRange(start, end) {
  return `${formatTime(start)}–${formatTime(end)}`;
}

function beliefMoments(report = {}) {
  const windows = report.windows || [];
  if (!windows.length) return [];

  const ranked = windows
    .map((item) => ({
      item,
      priority: (item.surprise || 0)
        + (1 - (item.agreement?.score ?? 0.5))
        + (item.stateChanged ? 0.12 : 0),
    }))
    .sort((a, b) => b.priority - a.priority);

  const moments = [];
  const seen = new Set();

  for (const { item } of ranked) {
    if (moments.length >= 4) break;
    const key = `${item.start}-${item.end}`;
    if (seen.has(key)) continue;

    if (item.agreement?.label === 'review') {
      seen.add(key);
      moments.push({
        id: `belief-disagreement-${key}`,
        start: item.start,
        end: item.end,
        kind: 'disagreement',
        label: 'Cross-model disagreement',
        detail: `Pattern state S${String(item.stateId).padStart(2, '0')} and deterministic BrainSNN signals do not fully agree in this window.`,
        whyItMatters: 'A disagreement is more useful as a manual-review flag than as another score to average away.',
        action: `Review ${formatRange(item.start, item.end)} directly and inspect which visual, audio, or semantic feature explains the mismatch.`,
        confidence: `${Math.round((item.agreement.score || 0) * 100)}% agreement`,
        source: 'pattern + rules',
        audioEnergy: item.features?.audioEnergy ?? null,
      });
      continue;
    }

    if ((item.surprise || 0) >= 0.42) {
      seen.add(key);
      moments.push({
        id: `belief-surprise-${key}`,
        start: item.start,
        end: item.end,
        kind: 'pattern',
        label: 'High pattern surprise',
        detail: `State S${String(item.stateId).padStart(2, '0')} is ${Math.round((item.surprise || 0) * 100)}% unusual relative to this scan's multimodal baseline.`,
        whyItMatters: 'This is where the combined visual, audio, and semantic feature mix differs most from the rest of the creative.',
        action: `Inspect ${formatRange(item.start, item.end)} for the exact pacing, sound, claim, proof, or CTA change that created the pattern shift.`,
        confidence: 'within-scan pattern proxy',
        source: 'pattern layer',
        audioEnergy: item.features?.audioEnergy ?? null,
      });
    }
  }

  return moments;
}

function beliefPacket(report = {}) {
  const summary = report.summary || {};
  if (!report.windows?.length) return '';
  const lines = [
    '',
    '[BrainSNN belief report v0.1]',
    `Model status: ${report.model?.status || 'unknown'}; trained weights: ${Boolean(report.model?.learnedWeights)}`,
    `Dominant state: ${summary.dominantState == null ? 'none' : `S${String(summary.dominantState).padStart(2, '0')}`}`,
    `Unique states: ${summary.uniqueStates || 0}; transitions: ${summary.stateTransitions || 0}`,
    `Mean surprise: ${Math.round((summary.meanSurprise || 0) * 100)}%`,
    `Cross-model agreement: ${Math.round((summary.agreementScore || 0) * 100)}%`,
  ];
  if (summary.highestSurprise) {
    lines.push(`Highest surprise: ${formatRange(summary.highestSurprise.start, summary.highestSurprise.end)} at ${Math.round((summary.highestSurprise.value || 0) * 100)}%.`);
  }
  if (summary.highestDisagreement) {
    lines.push(`Highest disagreement: ${formatRange(summary.highestDisagreement.start, summary.highestDisagreement.end)} at ${Math.round((summary.highestDisagreement.agreementScore || 0) * 100)}% agreement.`);
  }
  lines.push('Boundary: current V0.1 uses a deterministic S-DBN-ready proxy, not trained S-DBN weights or measured neural/audience response.');
  return lines.join('\n');
}

export function buildBeliefMultimodalFusion(input = {}) {
  const base = buildClientMultimodalFusion(input);
  const enriched = attachBeliefReport(base.result);
  const extraMoments = beliefMoments(enriched.beliefReport);
  const clientMoments = [
    ...(enriched.clientMoments || []),
    ...extraMoments,
  ]
    .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0) || (Number(a.end) || 0) - (Number(b.end) || 0))
    .slice(0, 28);

  const result = {
    ...enriched,
    timelineTracks: enriched.temporalReadout?.tracks || enriched.timelineTracks || [],
    clientMoments,
    provenance: {
      ...(enriched.provenance || {}),
      belief: 'brainsnn-sdbn-proxy-v0 over bounded multimodal features; no trained weights in V0.1',
    },
  };

  return {
    packet: `${base.packet}${beliefPacket(result.beliefReport)}`,
    result,
  };
}
