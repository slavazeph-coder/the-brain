import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  deriveBountyLifecycle,
  isMissionSubmissionOpen,
  normalizeBountyState,
  normalizeBountyTerms,
  pickVerifiedWinner,
} from './missionBounty.js';

describe('mission bounty terms', () => {
  it('normalizes public reward terms without claiming escrow', () => {
    const terms = normalizeBountyTerms({
      creatorLabel: '  XIO   Lab  ',
      amountCents: 250000,
      currency: 'cad',
      deadline: '2026-09-30T16:00:00.000Z',
      rules: 'Best verified success wins.',
    });

    expect(terms.creatorLabel).toBe('XIO Lab');
    expect(terms.amountCents).toBe(250000);
    expect(terms.currency).toBe('CAD');
    expect(terms.fundingStatus).toBe('NOT_ESCROWED');
    expect(terms.paymentRail).toBe('NOT_CONNECTED');
  });

  it('expires an open mission at its declared deadline', () => {
    const terms = normalizeBountyTerms({ deadline: '2026-09-01T00:00:00.000Z' });
    const state = normalizeBountyState({ status: 'OPEN' });
    expect(deriveBountyLifecycle(terms, state, Date.parse('2026-08-31T23:59:00.000Z'))).toBe('OPEN');
    expect(deriveBountyLifecycle(terms, state, Date.parse('2026-09-01T00:00:00.000Z'))).toBe('EXPIRED');
    expect(isMissionSubmissionOpen(terms, state, Date.parse('2026-09-02T00:00:00.000Z'))).toBe(false);
  });

  it('keeps explicit creator state above the clock', () => {
    const terms = normalizeBountyTerms({ deadline: '2026-09-01T00:00:00.000Z' });
    expect(deriveBountyLifecycle(terms, { status: 'CLOSED' }, Date.parse('2026-08-31T00:00:00.000Z'))).toBe('CLOSED');
    expect(deriveBountyLifecycle(terms, { status: 'AWARDED' }, Date.parse('2026-10-01T00:00:00.000Z'))).toBe('AWARDED');
  });

  it('selects only a verified mission success', () => {
    const winner = pickVerifiedWinner([
      { id: 's-1', status: 'OBJECTIVE MISS' },
      { id: 's-2', status: 'MISSION SUCCESS' },
      { id: 's-3', status: 'MISSION SUCCESS' },
    ]);
    expect(winner.id).toBe('s-2');
    expect(pickVerifiedWinner([{ id: 's-4', status: 'BOUNDARY FAILURE' }])).toBe(null);
  });
});
