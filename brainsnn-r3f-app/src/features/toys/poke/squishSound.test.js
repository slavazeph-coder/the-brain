import { describe, expect, it } from '../../../test/tinyVitest.js';
import {
  bloopParams,
  createSquishSound,
  SQUISH,
  stretchParams,
  wobbleParams,
} from './squishSound.js';

describe('squish sound parameters', () => {
  it('squish: a harder poke starts higher, lasts longer and hits louder', () => {
    const soft = bloopParams(0);
    const hard = bloopParams(1);
    expect(soft.freqStart).toBe(SQUISH.bloopBase);
    expect(hard.freqStart).toBe(SQUISH.bloopBase + SQUISH.bloopSpan);
    expect(hard.duration).toBeGreaterThan(soft.duration);
    expect(hard.gain).toBeGreaterThan(soft.gain);
    expect(hard.squelchGain).toBeGreaterThan(soft.squelchGain);
    // The bloop always falls: start above end.
    expect(soft.freqStart).toBeGreaterThan(soft.freqEnd);
    expect(hard.freqStart).toBeGreaterThan(hard.freqEnd);
  });

  it('squish: strengths clamp to 0..1 so a wild drag cannot blow out the gain', () => {
    expect(bloopParams(5)).toEqual(bloopParams(1));
    expect(bloopParams(-2)).toEqual(bloopParams(0));
    expect(stretchParams(9).gain).toBe(SQUISH.stretchMaxGain);
    expect(stretchParams(-1).gain).toBe(0);
    expect(wobbleParams(3)).toEqual(wobbleParams(1));
  });

  it('squish: stretch gain follows drag speed up to its cap', () => {
    expect(stretchParams(0).gain).toBe(0);
    expect(stretchParams(0.5).gain).toBeCloseTo(SQUISH.stretchMaxGain * 0.5, 6);
    expect(stretchParams(1).gain).toBe(SQUISH.stretchMaxGain);
  });

  it('squish: the release wobble is quieter than the poke and scales gently', () => {
    const soft = wobbleParams(0);
    const hard = wobbleParams(1);
    expect(hard.gain).toBeGreaterThan(soft.gain);
    expect(hard.gain).toBeLessThan(bloopParams(1).gain);
    expect(hard.freq).toBeGreaterThan(soft.freq);
    expect(hard.duration).toBe(SQUISH.wobbleDur);
  });
});

describe('squish sound stub', () => {
  it('squish: without an AudioContext every call is a safe no-op', () => {
    // The unit runner shims window with localStorage but no AudioContext.
    const sound = createSquishSound();
    expect(sound.supported).toBe(false);
    // Each call must simply not throw.
    sound.unlock();
    sound.poke(0.8);
    sound.stretchStart();
    sound.stretchMove(0.5);
    sound.stretchEnd();
    sound.release(0.8);
  });

  it('squish: the mute toggle works and persists even with no audio', () => {
    const first = createSquishSound();
    const start = first.muted;
    expect(first.toggle()).toBe(!start);
    // A fresh instance reads the persisted choice back.
    expect(createSquishSound().muted).toBe(!start);
    expect(createSquishSound().toggle()).toBe(start);
  });
});
