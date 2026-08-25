import { beforeEach, describe, expect, it } from '../test/tinyVitest.js';
import {
  appendSyncedOutcomeRecord,
  deleteSyncedOutcomeRecord,
  loadSyncedOutcomeRecords,
} from './outcomeSync.js';
import {
  createOutcomeRecord,
  loadOutcomeRecords,
  saveOutcomeRecords,
} from './outcomeLearning.js';

function makeResult(id = 'current') {
  return {
    id,
    title: `Creative ${id}`,
    metrics: { trust: 70 },
    firewallSignals: { manipulationPressure: 0.2 },
    multimodal: {
      temporalReadout: {
        points: [
          { timestamp: 0, responseChange: 20, attentionProxy: 40, loadProxy: 30, visualTone: 50, luminance: 60, stability: 80 },
          { timestamp: 1, responseChange: 50, attentionProxy: 60, loadProxy: 45, visualTone: 55, luminance: 58, stability: 50 },
        ],
      },
      beliefReport: {
        model: { id: 'fixture-belief', version: '0.1.0', learnedWeights: false },
        windows: [
          { stateId: 1, spikeRateProxy: 0.3, sparsityProxy: 0.6, deterministicFlags: ['claim_present'] },
          { stateId: 2, spikeRateProxy: 0.5, sparsityProxy: 0.5, deterministicFlags: ['proof_present'] },
        ],
        summary: { meanSurprise: 0.3, surpriseVariance: 0.02, agreementScore: 0.8, stateTransitions: 1, reviewWindows: 0, uniqueStates: 2 },
      },
    },
  };
}

function makeRecord(id, savedAt = '2026-08-24T12:00:00.000Z') {
  return createOutcomeRecord({
    id,
    savedAt,
    result: makeResult(id),
    brandName: 'Acme',
    creativeLabel: id,
    metricId: 'roas',
    value: 2.5,
  });
}

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() { return payload; },
  };
}

describe('Brand Brain outcome sync', () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = undefined;
  });

  it('loads server records, merges newer local history, and migrates missing local records', async () => {
    const local = makeRecord('local', '2026-08-24T13:00:00.000Z');
    const remote = makeRecord('remote', '2026-08-24T12:00:00.000Z');
    saveOutcomeRecords([local]);
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).endsWith('/outcomes') && (!options.method || options.method === 'GET')) {
        return response({ ok: true, storage: 'postgres', records: [remote] });
      }
      if (String(url).endsWith('/outcomes') && options.method === 'POST') {
        return response({ ok: true, storage: 'postgres', record: JSON.parse(options.body).record });
      }
      return response({ ok: false, error: 'unexpected' }, false, 500);
    };

    const state = await loadSyncedOutcomeRecords();
    expect(state.synced).toBe(true);
    expect(state.storage).toBe('postgres');
    expect(state.records).toHaveLength(2);
    expect(loadOutcomeRecords()).toHaveLength(2);
    expect(calls.some((call) => call.options?.method === 'POST')).toBe(true);
  });

  it('falls back to browser-local history when the server is unavailable', async () => {
    const local = makeRecord('local');
    saveOutcomeRecords([local]);
    global.fetch = async () => { throw new Error('offline'); };
    const state = await loadSyncedOutcomeRecords();
    expect(state.synced).toBe(false);
    expect(state.storage).toBe('browser-local');
    expect(state.records).toHaveLength(1);
  });

  it('writes local first and reports server synchronization on append', async () => {
    const record = makeRecord('new');
    global.fetch = async (url, options = {}) => response({ ok: true, storage: 'postgres', record: JSON.parse(options.body).record });
    const state = await appendSyncedOutcomeRecord(record);
    expect(state.synced).toBe(true);
    expect(state.storage).toBe('postgres');
    expect(loadOutcomeRecords()[0].id).toBe('new');
  });

  it('keeps the local deletion even when the remote deletion fails', async () => {
    const record = makeRecord('delete-me');
    saveOutcomeRecords([record]);
    global.fetch = async () => { throw new Error('offline'); };
    const state = await deleteSyncedOutcomeRecord('delete-me');
    expect(state.synced).toBe(false);
    expect(state.records).toHaveLength(0);
    expect(loadOutcomeRecords()).toHaveLength(0);
  });
});
