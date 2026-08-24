import {
  BRAND_BRAIN_IMPORT_KEY,
  BRAND_BRAIN_WORKSPACE_KEY,
} from './brandBrainContract.js';
import { loadOutcomeRecords } from './outcomeLearning.js';

const API_ROOT = '/api/brand-brain';
const REQUEST_TIMEOUT_MS = 9000;

function storageAvailable() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

export function loadBrandBrainCredential() {
  if (!storageAvailable()) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BRAND_BRAIN_WORKSPACE_KEY) || 'null');
    if (!parsed?.workspaceId || !parsed?.token) return null;
    return { workspaceId: String(parsed.workspaceId), token: String(parsed.token) };
  } catch {
    return null;
  }
}

export function saveBrandBrainCredential(credential) {
  if (!storageAvailable()) return;
  if (!credential?.workspaceId || !credential?.token) throw new Error('Invalid Brand Brain workspace credential.');
  window.localStorage.setItem(BRAND_BRAIN_WORKSPACE_KEY, JSON.stringify({
    workspaceId: String(credential.workspaceId),
    token: String(credential.token),
  }));
}

function importedKey(workspaceId) {
  return `${BRAND_BRAIN_IMPORT_KEY}:${workspaceId}`;
}

function wasLegacyImported(workspaceId) {
  if (!storageAvailable()) return true;
  return window.localStorage.getItem(importedKey(workspaceId)) === '1';
}

function markLegacyImported(workspaceId) {
  if (storageAvailable()) window.localStorage.setItem(importedKey(workspaceId), '1');
}

async function request(path, { credential, method = 'GET', body } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (credential?.token) {
    headers.Authorization = `Bearer ${credential.token}`;
    headers['X-BrainSNN-Workspace'] = credential.workspaceId;
  }

  try {
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error || `Brand Brain request failed (${response.status}).`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Brand Brain sync timed out.');
      timeout.code = 'TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getBrandBrainStatus() {
  return request('/status');
}

export async function createBrandBrainWorkspace(name = 'Pilot workspace') {
  const payload = await request('/workspaces', { method: 'POST', body: { name } });
  const credential = { workspaceId: payload.workspaceId, token: payload.token };
  saveBrandBrainCredential(credential);
  return credential;
}

export async function ensureBrandBrainWorkspace() {
  return loadBrandBrainCredential() || createBrandBrainWorkspace();
}

export async function listBrandBrainHistory(credential, { brandName = '', metricId = '' } = {}) {
  const params = new URLSearchParams();
  if (brandName) params.set('brandName', brandName);
  if (metricId) params.set('metricId', metricId);
  const suffix = params.size ? `?${params.toString()}` : '';
  const payload = await request(`/history${suffix}`, { credential });
  return Array.isArray(payload.records) ? payload.records : [];
}

export async function listBrandBrainBrands(credential) {
  const payload = await request('/brands', { credential });
  return Array.isArray(payload.brands) ? payload.brands : [];
}

export async function saveBrandBrainOutcome(credential, record) {
  const payload = await request('/outcomes', { credential, method: 'POST', body: record });
  return payload.record;
}

export async function deleteBrandBrainOutcome(credential, id) {
  const safeId = encodeURIComponent(String(id || ''));
  if (!safeId) throw new Error('Outcome id is required.');
  return request(`/outcomes/${safeId}`, { credential, method: 'DELETE' });
}

export async function importLegacyBrandBrainHistory(credential) {
  if (!credential?.workspaceId || wasLegacyImported(credential.workspaceId)) {
    return { attempted: false, imported: 0 };
  }
  const legacy = loadOutcomeRecords();
  if (!legacy.length) {
    markLegacyImported(credential.workspaceId);
    return { attempted: false, imported: 0 };
  }
  const payload = await request('/import-local', {
    credential,
    method: 'POST',
    body: { records: legacy.slice(0, 250) },
  });
  markLegacyImported(credential.workspaceId);
  return { attempted: true, imported: Number(payload.imported) || 0 };
}
