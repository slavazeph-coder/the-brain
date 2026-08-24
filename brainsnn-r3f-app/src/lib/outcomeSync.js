import {
  appendOutcomeRecord,
  deleteOutcomeRecord,
  loadOutcomeRecords,
  saveOutcomeRecords,
} from './outcomeLearning.js';

const API_BASE = '/api/v1/brand-brain';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Brand Brain request failed (${response.status})`);
  }
  return payload;
}

export async function getBrandBrainStorageStatus() {
  try {
    return await request('/status');
  } catch {
    return { ok: false, storage: 'browser-local', persistence: 'local-only' };
  }
}

export async function loadSyncedOutcomeRecords() {
  const local = loadOutcomeRecords();
  try {
    const payload = await request('/outcomes');
    const remote = Array.isArray(payload.records) ? payload.records : [];
    const mergedById = new Map();
    for (const item of [...remote, ...local]) {
      if (!item?.id) continue;
      const existing = mergedById.get(item.id);
      if (!existing || String(item.savedAt || '') > String(existing.savedAt || '')) mergedById.set(item.id, item);
    }
    const merged = [...mergedById.values()].sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    saveOutcomeRecords(merged);

    // Best-effort migration of browser-local pilot records into server persistence.
    const remoteIds = new Set(remote.map((item) => item?.id).filter(Boolean));
    for (const item of local) {
      if (!remoteIds.has(item.id)) {
        try {
          await request('/outcomes', { method: 'POST', body: JSON.stringify({ record: item }) });
        } catch {
          // Keep local copy; migration can retry on a later session.
        }
      }
    }
    return { records: merged, storage: payload.storage || 'postgres', synced: true };
  } catch {
    return { records: local, storage: 'browser-local', synced: false };
  }
}

export async function appendSyncedOutcomeRecord(record) {
  const local = appendOutcomeRecord(record);
  try {
    const payload = await request('/outcomes', { method: 'POST', body: JSON.stringify({ record }) });
    return { records: local, storage: payload.storage || 'postgres', synced: true };
  } catch {
    return { records: local, storage: 'browser-local', synced: false };
  }
}

export async function deleteSyncedOutcomeRecord(id) {
  const local = deleteOutcomeRecord(id);
  try {
    const payload = await request(`/outcomes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { records: local, storage: payload.storage || 'postgres', synced: true };
  } catch {
    return { records: local, storage: 'browser-local', synced: false };
  }
}
