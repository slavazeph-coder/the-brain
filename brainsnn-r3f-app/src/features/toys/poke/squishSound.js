// Squish sound for Poke the Brain — a tiny Web Audio synth with zero assets.
//
// The watermelon-jelly appeal is half audio: the squish sells the squash.
// Everything here is synthesized at poke time:
//   - poke:    a pitch-dropping "bloop" plus a short squelch of filtered noise
//   - stretch: looped noise through a bandpass whose gain follows drag speed
//   - release: a soft low wobble tail, like the surface settling
//
// No audio files, no dependencies, no three.js import (this module must stay
// out of scripts/check-three-imports.mjs's allowlist).
//
// Import-safe in Node and in the unit runner: with no window, or with a
// window that has no AudioContext (the test shim), createSquishSound returns
// a no-op stub, so the parameter maths below stay testable in bare Node.

export const SQUISH = Object.freeze({
  storageKey: 'poke-sound-muted',
  masterGain: 0.5,
  // The bloop: a sine falling from `freqStart` to `freqEnd` while its gain
  // blooms and dies. Harder pokes start higher and last a touch longer.
  bloopBase: 240,
  bloopSpan: 160,
  bloopEnd: 68,
  bloopDur: 0.11,
  bloopDurSpan: 0.07,
  // The squelch: a burst of noise through a lowpass, the wet part of the poke.
  squelchCutoff: 900,
  squelchDur: 0.07,
  // The stretch: bandpassed noise that tracks drag speed.
  stretchFreq: 420,
  stretchQ: 1.1,
  stretchMaxGain: 0.16,
  // The release wobble: a low sine with a dying pitch wobble on top.
  wobbleFreq: 118,
  wobbleLfo: 7,
  wobbleDur: 0.55,
  wobbleGain: 0.1,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** Pure: bloop parameters for a poke of the given strength (0..1). */
export function bloopParams(strength = 0.5) {
  const s = clamp01(strength);
  return {
    freqStart: SQUISH.bloopBase + SQUISH.bloopSpan * s,
    freqEnd: SQUISH.bloopEnd,
    duration: SQUISH.bloopDur + SQUISH.bloopDurSpan * s,
    gain: 0.22 + 0.3 * s,
    squelchGain: 0.1 + 0.22 * s,
  };
}

/** Pure: stretch-loop gain for a drag speed normalised to 0..1. */
export function stretchParams(speed01 = 0) {
  return { gain: SQUISH.stretchMaxGain * clamp01(speed01) };
}

/** Pure: release-wobble parameters for a release of the given strength. */
export function wobbleParams(strength = 0.5) {
  const s = clamp01(strength);
  return {
    freq: SQUISH.wobbleFreq * (1 + 0.25 * s),
    lfoHz: SQUISH.wobbleLfo,
    duration: SQUISH.wobbleDur,
    gain: SQUISH.wobbleGain * (0.4 + 0.6 * s),
  };
}

function readMuted() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SQUISH.storageKey) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SQUISH.storageKey, muted ? '1' : '0');
  } catch {
    // Private mode etc. — the toggle still works for the session.
  }
}

function noop() {}

function createStub(muted) {
  let m = muted;
  return {
    supported: false,
    get muted() { return m; },
    unlock: noop,
    poke: noop,
    stretchStart: noop,
    stretchMove: noop,
    stretchEnd: noop,
    release: noop,
    toggle() { m = !m; writeMuted(m); return m; },
  };
}

/**
 * Create the squish synth. The AudioContext is only built inside unlock(),
 * which the scene calls from a real pointerdown — browsers refuse audio
 * before a user gesture, and building it earlier would only throw.
 */
export function createSquishSound() {
  const AudioCtor = typeof window !== 'undefined'
    && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtor) return createStub(readMuted());

  let ctx = null;
  let master = null;
  let muted = readMuted();
  let stretchNodes = null;

  function context() {
    if (!ctx) {
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : SQUISH.masterGain;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playBloop(strength) {
    const { freqStart, freqEnd, duration, gain, squelchGain } = bloopParams(strength);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(SQUISH.squelchDur + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = SQUISH.squelchCutoff;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(squelchGain, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + SQUISH.squelchDur);
    noise.connect(filter).connect(ng).connect(master);
    noise.start(t);
    noise.stop(t + SQUISH.squelchDur + 0.02);
  }

  function playWobble(strength) {
    const { freq, lfoHz, duration, gain } = wobbleParams(strength);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(freq * 0.35, t);
    lfoGain.gain.exponentialRampToValueAtTime(1, t + duration);
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + duration + 0.02);
    lfo.stop(t + duration + 0.02);
  }

  return {
    supported: true,
    get muted() { return muted; },
    unlock() {
      try { context(); } catch { /* audio stays off, the toy still works */ }
    },
    poke(strength = 0.5) {
      if (muted) return;
      try { playBloop(strength); } catch { /* no-op */ }
    },
    stretchStart() {
      if (muted || stretchNodes) return;
      try {
        const source = ctx.createBufferSource();
        source.buffer = noiseBuffer(1.2);
        source.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = SQUISH.stretchFreq;
        filter.Q.value = SQUISH.stretchQ;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        source.connect(filter).connect(g).connect(master);
        source.start();
        stretchNodes = { source, gain: g };
      } catch { /* no-op */ }
    },
    stretchMove(speed01 = 0) {
      if (!stretchNodes) return;
      try {
        stretchNodes.gain.gain.setTargetAtTime(
          muted ? 0.0001 : stretchParams(speed01).gain,
          ctx.currentTime,
          0.05,
        );
      } catch { /* no-op */ }
    },
    stretchEnd() {
      if (!stretchNodes) return;
      try {
        const { source, gain } = stretchNodes;
        stretchNodes = null;
        gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
        window.setTimeout(() => { try { source.stop(); } catch { /* no-op */ } }, 400);
      } catch { /* no-op */ }
    },
    release(strength = 0.5) {
      this.stretchEnd();
      if (muted) return;
      try { playWobble(strength); } catch { /* no-op */ }
    },
    toggle() {
      muted = !muted;
      writeMuted(muted);
      try {
        if (master) master.gain.setTargetAtTime(muted ? 0 : SQUISH.masterGain, ctx.currentTime, 0.02);
      } catch { /* no-op */ }
      if (muted) this.stretchEnd();
      return muted;
    },
  };
}
