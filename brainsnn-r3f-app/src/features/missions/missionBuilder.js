import { clampInteger, createSeededRandom, roundMoney } from './missionRuntime.js';

const WORLD_TEMPLATES = [
  {
    id: 'decision-queue',
    label: 'Decision Queue',
    type: 'OPERATIONS',
    description: 'A finite queue of opportunities with value, risk and quality signals.',
    itemLabel: 'case',
    actionLabel: 'ACT',
    baselineThreshold: 0.78,
    riskPenalty: 0.42,
    qualityPenalty: 0.08,
  },
  {
    id: 'resource-portfolio',
    label: 'Resource Portfolio',
    type: 'ALLOCATION',
    description: 'A seeded portfolio of candidate investments competing for bounded attention.',
    itemLabel: 'project',
    actionLabel: 'FUND',
    baselineThreshold: 0.82,
    riskPenalty: 0.5,
    qualityPenalty: 0.06,
  },
  {
    id: 'service-routing',
    label: 'Service Routing',
    type: 'SERVICE',
    description: 'A bounded service queue where faster handling creates value but carries error risk.',
    itemLabel: 'request',
    actionLabel: 'FAST PATH',
    baselineThreshold: 0.8,
    riskPenalty: 0.46,
    qualityPenalty: 0.1,
  },
];

export const BUILDER_WORLD_TEMPLATES = Object.freeze(WORLD_TEMPLATES.map((template) => Object.freeze({ ...template })));

export const DEFAULT_MISSION_DRAFT = Object.freeze({
  title: 'Bounded Decision Mission',
  mind: 'Policy v1',
  worldTemplate: 'decision-queue',
  objective: 'Beat the conservative baseline by at least 20% on total useful value.',
  boundary: 'Never act on an item above the declared hard-risk limit.',
  judge: 'Deterministic value, quality and boundary ledger.',
  seed: 260829,
  cases: 180,
  maxRisk: 0.35,
  minimumImprovement: 0.2,
  minimumQuality: 0.9,
  aggressiveness: 0.55,
  boundaryDiscipline: 1,
});

function clampNumber(value, { min, max, fallback, precision = 4 }) {
  const parsed = Number(value);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  const bounded = Math.min(max, Math.max(min, resolved));
  const factor = 10 ** precision;
  return Math.round(bounded * factor) / factor;
}

function cleanText(value, fallback, maxLength = 240) {
  const resolved = typeof value === 'string' ? value.trim() : '';
  return (resolved || fallback).slice(0, maxLength);
}

export function getBuilderWorldTemplate(id) {
  return BUILDER_WORLD_TEMPLATES.find((template) => template.id === id) || BUILDER_WORLD_TEMPLATES[0];
}

export function normalizeMissionDraft(draft = {}) {
  const template = getBuilderWorldTemplate(draft.worldTemplate);
  return {
    title: cleanText(draft.title, DEFAULT_MISSION_DRAFT.title, 100),
    mind: cleanText(draft.mind, DEFAULT_MISSION_DRAFT.mind, 80),
    worldTemplate: template.id,
    objective: cleanText(draft.objective, DEFAULT_MISSION_DRAFT.objective),
    boundary: cleanText(draft.boundary, DEFAULT_MISSION_DRAFT.boundary),
    judge: cleanText(draft.judge, DEFAULT_MISSION_DRAFT.judge),
    seed: clampInteger(draft.seed, { min: 1, max: 2147483647, fallback: DEFAULT_MISSION_DRAFT.seed }),
    cases: clampInteger(draft.cases, { min: 25, max: 500, fallback: DEFAULT_MISSION_DRAFT.cases }),
    maxRisk: clampNumber(draft.maxRisk, { min: 0.05, max: 0.9, fallback: DEFAULT_MISSION_DRAFT.maxRisk }),
    minimumImprovement: clampNumber(draft.minimumImprovement, { min: 0, max: 2, fallback: DEFAULT_MISSION_DRAFT.minimumImprovement }),
    minimumQuality: clampNumber(draft.minimumQuality, { min: 0.5, max: 1, fallback: DEFAULT_MISSION_DRAFT.minimumQuality }),
    aggressiveness: clampNumber(draft.aggressiveness, { min: 0, max: 1, fallback: DEFAULT_MISSION_DRAFT.aggressiveness }),
    boundaryDiscipline: clampNumber(draft.boundaryDiscipline, { min: 0, max: 1, fallback: DEFAULT_MISSION_DRAFT.boundaryDiscipline }),
  };
}

export function buildMissionContract(draft = {}) {
  const config = normalizeMissionDraft(draft);
  const template = getBuilderWorldTemplate(config.worldTemplate);
  return {
    id: 'CUSTOM',
    type: template.type,
    title: config.title,
    mind: config.mind,
    world: `${template.label} · ${config.cases} seeded ${template.itemLabel}s`,
    mission: config.objective,
    boundary: config.boundary,
    judge: config.judge,
    proof: 'Seeded world · decision trace · deterministic ledger · Runtime v2 ProofPack',
    claimBoundary: 'This result applies only to the declared structured template, seed, configuration and tested conditions. It is finite simulation evidence, not a universal guarantee or real-world certification.',
  };
}

function makeItem(random, index, template) {
  const opportunity = 0.2 + random() * 0.8;
  const risk = random();
  const baseQuality = 0.88 + random() * 0.12;
  const scale = 70 + random() * 130;
  return {
    id: `${template.itemLabel}-${String(index + 1).padStart(3, '0')}`,
    opportunity: Math.round(opportunity * 10000) / 10000,
    risk: Math.round(risk * 10000) / 10000,
    baseQuality: Math.round(baseQuality * 10000) / 10000,
    scale: roundMoney(scale),
  };
}

function baselineActs(item, config, template) {
  return item.opportunity >= template.baselineThreshold && item.risk <= config.maxRisk * 0.55;
}

function policyActs(item, config, template) {
  const score = item.opportunity - item.risk * template.riskPenalty;
  const threshold = 0.84 - config.aggressiveness * 0.52;
  const riskGate = Math.min(1, config.maxRisk + (1 - config.boundaryDiscipline) * 0.5);
  return score >= threshold && item.risk <= riskGate;
}

function usefulValue(item, quality) {
  return item.scale * item.opportunity * quality;
}

export function runBuiltMission(draft = {}) {
  const configuration = normalizeMissionDraft(draft);
  const template = getBuilderWorldTemplate(configuration.worldTemplate);
  const mission = buildMissionContract(configuration);
  const random = createSeededRandom(configuration.seed, DEFAULT_MISSION_DRAFT.seed);
  const ledger = [];

  let totalValue = 0;
  let baselineValue = 0;
  let qualityTotal = 0;
  let acted = 0;
  let boundaryViolations = 0;

  for (let index = 0; index < configuration.cases; index += 1) {
    const item = makeItem(random, index, template);
    const baselineAction = baselineActs(item, configuration, template);
    const action = policyActs(item, configuration, template);
    const quality = Math.max(
      0,
      item.baseQuality - (action ? item.risk * template.qualityPenalty * configuration.aggressiveness : 0),
    );
    const boundaryViolation = action && item.risk > configuration.maxRisk;
    const value = action ? usefulValue(item, quality) : 0;
    const referenceValue = baselineAction ? usefulValue(item, item.baseQuality) : 0;

    if (action) {
      acted += 1;
      qualityTotal += quality;
      totalValue += value;
    }
    if (baselineAction) baselineValue += referenceValue;
    if (boundaryViolation) boundaryViolations += 1;

    ledger.push({
      itemId: item.id,
      opportunity: item.opportunity,
      risk: item.risk,
      quality: Math.round(quality * 10000) / 10000,
      action: action ? template.actionLabel : 'HOLD',
      baselineAction: baselineAction ? template.actionLabel : 'HOLD',
      boundaryViolation,
      value: roundMoney(value),
      baselineValue: roundMoney(referenceValue),
    });
  }

  const improvementRate = baselineValue > 0 ? (totalValue - baselineValue) / baselineValue : totalValue > 0 ? 1 : 0;
  const qualityRate = acted > 0 ? qualityTotal / acted : 1;
  const objectiveMet = improvementRate >= configuration.minimumImprovement;
  const qualityMet = qualityRate >= configuration.minimumQuality;
  const status = boundaryViolations > 0
    ? 'BOUNDARY FAILURE'
    : objectiveMet && qualityMet
      ? 'MISSION SUCCESS'
      : 'OBJECTIVE MISS';

  return {
    mission,
    configuration,
    metrics: {
      totalValue: roundMoney(totalValue),
      baselineValue: roundMoney(baselineValue),
      improvementRate: Math.round(improvementRate * 10000) / 10000,
      qualityRate: Math.round(qualityRate * 10000) / 10000,
      acted,
      boundaryViolations,
      objectiveMet,
      qualityMet,
    },
    status,
    ledger,
  };
}

export function compareBuiltMissionRuns(baseline, fork) {
  const baselineById = new Map((baseline?.ledger || []).map((entry) => [entry.itemId, entry]));
  let changedActions = 0;
  let newViolations = 0;
  for (const entry of fork?.ledger || []) {
    const prior = baselineById.get(entry.itemId);
    if (!prior) continue;
    if (prior.action !== entry.action) changedActions += 1;
    if (!prior.boundaryViolation && entry.boundaryViolation) newViolations += 1;
  }
  return {
    changedActions,
    newViolations,
    improvementDelta: Math.round(((fork?.metrics?.improvementRate || 0) - (baseline?.metrics?.improvementRate || 0)) * 10000) / 10000,
    qualityDelta: Math.round(((fork?.metrics?.qualityRate || 0) - (baseline?.metrics?.qualityRate || 0)) * 10000) / 10000,
    fromStatus: baseline?.status || null,
    toStatus: fork?.status || null,
  };
}

export function forkMissionDraft(draft = {}) {
  const config = normalizeMissionDraft(draft);
  return {
    ...config,
    aggressiveness: config.aggressiveness >= 0.75 ? 0.45 : Math.min(1, Math.round((config.aggressiveness + 0.25) * 100) / 100),
  };
}
