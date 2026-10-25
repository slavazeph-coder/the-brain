// Sound for Defend the Brain, synthesised rather than sampled.
//
// Every tone here is generated from oscillators and gain envelopes at runtime,
// so this ships no audio files, adds no dependency and costs nothing in the
// bundle. It is also the only way to stay honest about page weight while adding
// the thing that most changes how a game feels.
//
// Three rules it follows:
//   1. Muted by default. Sound that starts without being asked for is hostile,
//      and browsers block it anyway until a gesture.
//   2. The AudioContext is created lazily on the first deliberate unmute, not
//      at import — constructing one on load is what triggers autoplay warnings.
//   3. Silent under prefers-reduced-motion unless explicitly overridden. Some
//      people set that flag for vestibular reasons and still want audio, so it
//      is a default rather than a lock.
//
// Everything is guarded: no AudioContext, a suspended context, or a throwing
// constructor all degrade to silence rather than breaking the game.

const VOICES = Object.freeze({
  // Short, bright, low-cost. Fired often, so kept quiet.
  spike: { type: 'triangle', freq: 880, sweep: -180, duration: 0.06, gain: 0.05 },
  // A packet stopped: a satisfying downward click.
  block: { type: 'square', freq: 520, sweep: -260, duration: 0.09, gain: 0.09 },
  // A packet landed: dissonant and lower, so a leak is audible without looking.
  leak: { type: 'sawtooth', freq: 180, sweep: -70, duration: 0.22, gain: 0.11 },
  // Budget spent.
  intervene: { type: 'sine', freq: 320, sweep: 260, duration: 0.14, gain: 0.1 },
  // Sustained breach.
  alarm: { type: 'sawtooth', freq: 220, sweep: 60, duration: 0.4, gain: 0.08 },
  win: { type: 'sine', freq: 440, sweep: 480, duration: 0.5, gain: 0.12 },
  lose: { type: 'sine', freq: 300, sweep: -190, duration: 0.7, gain: 0.12 },
});

export const VOICE_NAMES = Object.freeze(Object.keys(VOICES));

// A tone every 120 ms tick would be a drill; this is the floor between plays of
// the same voice.
export const MIN_INTERVAL_MS = 55;

export function createGameAudio({
  ContextClass = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null,
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
} = {}) {
  let context = null;
  let master = null;
  let enabled = false;
  let volume = 0.6;
  const lastPlayed = new Map();

  function ensureContext() {
    if (context || !ContextClass) return context;
    try {
      context = new ContextClass();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
    } catch {
      // Audio is a nicety; a browser that refuses one is not an error state.
      context = null;
      master = null;
    }
    return context;
  }

  function play(name, { intensity = 1 } = {}) {
    const voice = VOICES[name];
    if (!enabled || !voice) return false;

    const stamp = now();
    // `??`, not `||`: a timestamp of exactly 0 is a real time, and treating it
    // as absent lets the very first repeat through unthrottled.
    if (stamp - (lastPlayed.get(name) ?? -Infinity) < MIN_INTERVAL_MS) return false;

    const ctx = ensureContext();
    if (!ctx) return false;
    // A context can be suspended by the browser between gestures.
    if (ctx.state === 'suspended') ctx.resume?.();

    lastPlayed.set(name, stamp);

    try {
      const start = ctx.currentTime;
      const end = start + voice.duration;
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();

      oscillator.type = voice.type;
      oscillator.frequency.setValueAtTime(voice.freq, start);
      oscillator.frequency.linearRampToValueAtTime(Math.max(40, voice.freq + voice.sweep), end);

      const peak = Math.max(0, Math.min(1, voice.gain * intensity));
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
      return true;
    } catch {
      return false;
    }
  }

  return {
    play,
    get enabled() { return enabled; },
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = Boolean(next);
      // Creating the context here rather than at import keeps it tied to the
      // click that enabled sound, which is what browsers require.
      if (enabled) ensureContext();
      return enabled;
    },
    setVolume(next) {
      volume = Math.max(0, Math.min(1, Number(next) || 0));
      if (master) master.gain.value = volume;
      return volume;
    },
    getVolume: () => volume,
    // Exposed for teardown and for tests; safe to call when nothing was created.
    close() {
      try {
        context?.close?.();
      } catch {
        // closing an already-closed context is not worth surfacing
      }
      context = null;
      master = null;
      enabled = false;
      lastPlayed.clear();
    },
  };
}
