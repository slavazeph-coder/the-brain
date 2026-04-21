/**
 * Layer 59 — Audio Firewall (Web Speech API wrapper)
 *
 * Thin, dependency-free wrapper around SpeechRecognition (Chrome/Edge/
 * Safari prefix). Emits interim + final transcripts; exposes start()
 * and stop() so the panel can wire a single toggle button.
 *
 * Graceful: returns { supported: false } on browsers without the API.
 */

function getRecognition() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function isSpeechSupported() {
  if (typeof window === 'undefined') return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Create a session object. Methods:
 *  - start(onEvent)
 *  - stop()
 *  - setLang(lang)
 * onEvent receives { interim, final, error, state }.
 */
export function createSpeechSession({ lang = 'en-US', continuous = true } = {}) {
  const rec = getRecognition();
  if (!rec) {
    return {
      supported: false,
      start: () => {},
      stop: () => {},
      setLang: () => {},
    };
  }
  rec.lang = lang;
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let listener = null;
  let finals = '';

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finals += (finals ? ' ' : '') + t.trim();
      else interim += t;
    }
    listener?.({ interim, final: finals });
  };
  rec.onerror = (e) => {
    listener?.({ error: e.error || 'unknown' });
  };
  rec.onstart = () => listener?.({ state: 'listening' });
  rec.onend = () => listener?.({ state: 'stopped', final: finals });

  return {
    supported: true,
    setLang: (l) => { rec.lang = l; },
    start(cb) {
      listener = cb;
      finals = '';
      try { rec.start(); } catch (err) { cb?.({ error: err.message || 'start failed' }); }
    },
    stop() {
      try { rec.stop(); } catch { /* noop */ }
    },
  };
}
