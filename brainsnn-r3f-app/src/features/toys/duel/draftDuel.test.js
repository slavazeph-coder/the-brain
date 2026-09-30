import { describe, expect, it } from '../../../test/tinyVitest.js';
import { barValue, DUEL_ROUNDS, DUEL_SAMPLES, duel, validateDrafts } from './draftDuel.js';

describe('draft duel', () => {
  it('duel: five rounds, and identical drafts can only draw', () => {
    expect(DUEL_ROUNDS).toHaveLength(5);
    const result = duel(DUEL_SAMPLES.a, DUEL_SAMPLES.a);
    expect(result.valid).toBe(true);
    expect(result.draws).toBe(5);
    expect(result.winner).toBe('draw');
    expect(result.headline).toContain('Dead heat');
  });

  it('duel: is deterministic — the same pair always fights the same fight', () => {
    expect(duel(DUEL_SAMPLES.a, DUEL_SAMPLES.b)).toEqual(duel(DUEL_SAMPLES.a, DUEL_SAMPLES.b));
  });

  it('duel: the pressure-heavy sample loses calm and clean play to the evidence-led one', () => {
    const result = duel(DUEL_SAMPLES.a, DUEL_SAMPLES.b);
    const byId = Object.fromEntries(result.rounds.map((round) => [round.id, round]));
    expect(byId.calm.winner).toBe('B');
    expect(byId.clean.winner).toBe('B');
    expect(result.techniquesA.length).toBeGreaterThan(result.techniquesB.length);
    expect(result.winner).toBe('B');
    expect(result.headline).toMatch(/^Draft B wins \d–\d$/);
  });

  it('duel: swapping sides swaps the winner', () => {
    const forward = duel(DUEL_SAMPLES.a, DUEL_SAMPLES.b);
    const swapped = duel(DUEL_SAMPLES.b, DUEL_SAMPLES.a);
    expect(swapped.winsA).toBe(forward.winsB);
    expect(swapped.winsB).toBe(forward.winsA);
  });

  it('duel: bars are oriented so longer is always better', () => {
    expect(barValue('calm', 10)).toBeGreaterThan(barValue('calm', 60));
    expect(barValue('clean', 0)).toBe(100);
    expect(barValue('clean', 9)).toBe(0);
    expect(barValue('trust', 70)).toBe(70);
  });

  it('duel: refuses an empty side or an essay', () => {
    expect(validateDrafts('', 'b')).toContain('both');
    expect(duel('x'.repeat(4001), 'fine').valid).toBe(false);
  });
});
