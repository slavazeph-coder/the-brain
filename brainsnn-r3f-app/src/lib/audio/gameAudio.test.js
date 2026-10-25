import { describe, expect, it } from '../../test/tinyVitest.js';
import { createGameAudio, MIN_INTERVAL_MS, VOICE_NAMES } from './gameAudio.js';

// A stand-in for the Web Audio API, recording what would have been played.
function fakeAudio() {
  const created = { oscillators: 0, gains: 0, started: [], closed: false };
  class FakeParam {
    setValueAtTime() { return this; }
    linearRampToValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; }
  }
  class FakeContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {};
      created.context = this;
    }
    createGain() {
      created.gains += 1;
      return { gain: new FakeParam(), connect() {}, value: 0 };
    }
    createOscillator() {
      created.oscillators += 1;
      const node = {
        type: '',
        frequency: new FakeParam(),
        connect() {},
        start(at) { created.started.push(at); },
        stop() {},
      };
      return node;
    }
    resume() { this.state = 'running'; }
    close() { created.closed = true; }
  }
  return { FakeContext, created };
}

function makeAudio(overrides = {}) {
  const { FakeContext, created } = fakeAudio();
  let clock = 0;
  const audio = createGameAudio({
    ContextClass: FakeContext,
    now: () => clock,
    ...overrides,
  });
  return { audio, created, tick: (ms) => { clock += ms; } };
}

describe('createGameAudio', () => {
  it('starts muted', () => {
    const { audio } = makeAudio();
    expect(audio.isEnabled()).toBe(false);
    expect(audio.play('spike')).toBe(false);
  });

  // Constructing an AudioContext at import is what triggers autoplay warnings.
  it('creates no AudioContext until sound is deliberately enabled', () => {
    const { audio, created } = makeAudio();
    audio.play('spike');
    expect(created.context).toBe(undefined);
    audio.setEnabled(true);
    expect(Boolean(created.context)).toBe(true);
  });

  it('plays once enabled', () => {
    const { audio, created } = makeAudio();
    audio.setEnabled(true);
    expect(audio.play('block')).toBe(true);
    expect(created.oscillators).toBe(1);
  });

  it('knows every voice it advertises', () => {
    const { audio } = makeAudio();
    audio.setEnabled(true);
    for (const name of VOICE_NAMES) expect(audio.play(name, { intensity: 1 })).toBe(true);
  });

  it('ignores an unknown voice instead of throwing', () => {
    const { audio } = makeAudio();
    audio.setEnabled(true);
    expect(audio.play('not-a-voice')).toBe(false);
  });

  // The simulation ticks every 120 ms and several packets can resolve at once;
  // without a floor the same voice would machine-gun.
  it('rate-limits repeats of the same voice', () => {
    const { audio, tick } = makeAudio();
    audio.setEnabled(true);
    expect(audio.play('spike')).toBe(true);
    expect(audio.play('spike')).toBe(false);
    tick(MIN_INTERVAL_MS + 1);
    expect(audio.play('spike')).toBe(true);
  });

  it('rate-limits each voice independently', () => {
    const { audio } = makeAudio();
    audio.setEnabled(true);
    expect(audio.play('spike')).toBe(true);
    expect(audio.play('leak')).toBe(true);
  });

  it('resumes a context the browser suspended', () => {
    const { audio, created, tick } = makeAudio();
    audio.setEnabled(true);
    audio.play('spike');
    created.context.state = 'suspended';
    tick(MIN_INTERVAL_MS + 1);
    expect(audio.play('spike')).toBe(true);
    expect(created.context.state).toBe('running');
  });

  it('clamps volume into range', () => {
    const { audio } = makeAudio();
    expect(audio.setVolume(5)).toBe(1);
    expect(audio.setVolume(-2)).toBe(0);
    expect(audio.setVolume(0.4)).toBe(0.4);
  });

  it('goes quiet again when disabled', () => {
    const { audio, tick } = makeAudio();
    audio.setEnabled(true);
    tick(MIN_INTERVAL_MS + 1);
    audio.setEnabled(false);
    expect(audio.play('spike')).toBe(false);
  });

  it('closes cleanly', () => {
    const { audio, created } = makeAudio();
    audio.setEnabled(true);
    audio.play('spike');
    audio.close();
    expect(created.closed).toBe(true);
    expect(audio.isEnabled()).toBe(false);
  });
});

// A browser without Web Audio, or one whose constructor throws, must degrade to
// silence rather than taking the game down with it.
describe('degrading without Web Audio', () => {
  it('is silent when no AudioContext exists', () => {
    const audio = createGameAudio({ ContextClass: null });
    audio.setEnabled(true);
    expect(audio.play('spike')).toBe(false);
    expect(() => audio.close()).not.toThrow?.();
  });

  it('is silent when constructing a context throws', () => {
    class Hostile {
      constructor() { throw new Error('blocked'); }
    }
    const audio = createGameAudio({ ContextClass: Hostile });
    audio.setEnabled(true);
    expect(audio.play('spike')).toBe(false);
  });
});
