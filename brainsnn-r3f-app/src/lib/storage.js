import { deriveExecutiveVerdict, getBusinessMetrics } from './scoreMapping.js';
import { excerpt } from './formatters.js';

export const MEMORY_KEY = 'brainsnn.memory.v1';
export const QUEUE_KEY = 'brainsnn.queue.v1';
export const STORAGE_VERSION = 1;

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeMemoryRecord(record) {
  if (!record || !record.result || !record.result.id) return null;
  const verdict = deriveExecutiveVerdict(record.result);
  const scores = Object.fromEntries(getBusinessMetrics(record.result).map((metric) => [metric.id, metric.value]));
  return {
    id: record.id || record.result.id,
    version: STORAGE_VERSION,
    savedAt: record.savedAt || new Date().toISOString(),
    updatedAt: record.updatedAt || record.savedAt || new Date().toISOString(),
    inputType: record.inputType || record.result.contentType || 'text',
    title: record.title || record.result.title || 'Untitled scan',
    excerpt: record.excerpt || excerpt(record.result.rawContent),
    verdict: record.verdict || verdict.headline,
    status: record.status || 'Draft',
    keyScores: record.keyScores || scores,
    versions: Array.isArray(record.versions) ? record.versions : [
      { id: `${record.result.id}-v1`, label: 'Original', content: record.result.rawContent, result: record.result },
    ],
    result: record.result,
  };
}

export function loadMemory() {
  const raw = readJson(MEMORY_KEY, null);
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return items.map(normalizeMemoryRecord).filter(Boolean);
}

export function saveMemory(items) {
  const normalized = Array.isArray(items) ? items.map(normalizeMemoryRecord).filter(Boolean) : [];
  writeJson(MEMORY_KEY, { version: STORAGE_VERSION, items: normalized });
  return normalized;
}

export function makeMemoryRecord(result, overrides = {}) {
  return normalizeMemoryRecord({
    id: result.id,
    result,
    ...overrides,
  });
}

export function loadQueue() {
  const raw = readJson(QUEUE_KEY, null);
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return items
    .filter((item) => item && item.id)
    .map((item) => ({
      status: 'Draft',
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
      versions: [],
      ...item,
    }));
}

export function saveQueue(items) {
  const normalized = Array.isArray(items) ? items.filter((item) => item && item.id) : [];
  writeJson(QUEUE_KEY, { version: STORAGE_VERSION, items: normalized });
  return normalized;
}
