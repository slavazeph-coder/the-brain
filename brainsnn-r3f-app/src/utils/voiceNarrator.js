/**
 * Voice Narrator — Web Speech API
 *
 * Speaks neural narrative output aloud. Manages utterance queue,
 * voice selection, rate/pitch controls, and pause/resume.
 */

let synth = null;
let currentUtterance = null;
let voiceCache = [];
let enabled = false;

function getSynth() {
  if (!synth && typeof window !== 'undefined' && window.speechSynthesis) {
    synth = window.speechSynthesis;
  }
  return synth;
}

export function isVoiceSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function getVoices() {
  const s = getSynth();
  if (!s) return [];
  if (voiceCache.length) return voiceCache;
  voiceCache = s.getVoices();
  return voiceCache;
}

// Some browsers load voices async
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    voiceCache = window.speechSynthesis.getVoices();
  };
}

export function getPreferredVoice() {
  const voices = getVoices();
  // Prefer English, natural-sounding voices
  const preferred = voices.find((v) => v.name.includes('Samantha')) ||
    voices.find((v) => v.name.includes('Google') && v.lang.startsWith('en')) ||
    voices.find((v) => v.lang.startsWith('en') && v.localService) ||
    voices.find((v) => v.lang.startsWith('en')) ||
    voices[0];
  return preferred || null;
}

export function setEnabled(val) {
  enabled = val;
  if (!val) stop();
}

export function isEnabled() {
  return enabled;
}

export function speak(text, { rate = 1.0, pitch = 1.0, voice = null } = {}) {
  const s = getSynth();
  if (!s || !enabled || !text) return;

  // Cancel previous if still speaking
  if (s.speaking) s.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.voice = voice || getPreferredVoice();
  currentUtterance = utterance;
  s.speak(utterance);
}

export function speakNarrative(sentences, options = {}) {
  if (!sentences?.length) return;
  // Join into one utterance for smoother playback
  const text = sentences.join(' ');
  speak(text, options);
}

export function pause() {
  getSynth()?.pause();
}

export function resume() {
  getSynth()?.resume();
}

export function stop() {
  const s = getSynth();
  if (s?.speaking) s.cancel();
  currentUtterance = null;
}

export function isSpeaking() {
  return getSynth()?.speaking || false;
}
