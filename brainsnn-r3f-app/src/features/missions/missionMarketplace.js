import { normalizeMissionDraft } from './missionBuilder.js';

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, Math.round(resolved * 10000) / 10000));
}

function cleanText(value, fallback, maxLength = 80) {
  const resolved = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return (resolved || fallback).slice(0, maxLength);
}

export function normalizeSubmissionPolicy(policy = {}, publishedConfiguration = {}) {
  const base = normalizeMissionDraft(publishedConfiguration);
  return {
    mind: cleanText(policy.mind, base.mind),
    aggressiveness: clampNumber(policy.aggressiveness, 0, 1, base.aggressiveness),
    boundaryDiscipline: clampNumber(policy.boundaryDiscipline, 0, 1, base.boundaryDiscipline),
  };
}

export function buildSubmissionConfiguration(publishedConfiguration = {}, policy = {}) {
  const base = normalizeMissionDraft(publishedConfiguration);
  const normalizedPolicy = normalizeSubmissionPolicy(policy, base);
  return normalizeMissionDraft({
    ...base,
    mind: normalizedPolicy.mind,
    aggressiveness: normalizedPolicy.aggressiveness,
    boundaryDiscipline: normalizedPolicy.boundaryDiscipline,
  });
}

export function rankMissionSubmissions(entries = []) {
  const statusRank = (status) => {
    if (status === 'MISSION SUCCESS') return 0;
    if (status === 'OBJECTIVE MISS') return 1;
    return 2;
  };
  return [...entries].sort((a, b) => {
    const statusDelta = statusRank(a?.status) - statusRank(b?.status);
    if (statusDelta) return statusDelta;
    const violationsDelta = Number(a?.metrics?.boundaryViolations || 0) - Number(b?.metrics?.boundaryViolations || 0);
    if (violationsDelta) return violationsDelta;
    const improvementDelta = Number(b?.metrics?.improvementRate || 0) - Number(a?.metrics?.improvementRate || 0);
    if (improvementDelta) return improvementDelta;
    const qualityDelta = Number(b?.metrics?.qualityRate || 0) - Number(a?.metrics?.qualityRate || 0);
    if (qualityDelta) return qualityDelta;
    return String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
  }).map((entry, index) => ({ ...entry, rank: index + 1 }));
}
