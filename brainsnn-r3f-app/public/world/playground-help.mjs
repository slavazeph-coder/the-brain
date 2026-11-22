const READING_SIZE_KEY = 'brainsnn-world-reading-size';
const CONTRAST_KEY = 'brainsnn-world-contrast';
const HELP_TOOLS = new Set(['world', 'test', 'capture']);

/** Add optional reading aids without changing the playground or its scene. */
export function mountPlaygroundHelp({ onTool } = {}) {
  const openButton = document.getElementById('playground-help-open');
  const dialog = document.getElementById('playground-help');
  const closeButton = document.getElementById('playground-help-close');
  const textSizeButton = document.getElementById('playground-text-size');
  const speakButton = document.getElementById('playground-help-speak');
  const helpCopy = document.getElementById('playground-help-copy');
  const contrastButton = document.getElementById('playground-contrast');

  function setReadingSize(large) {
    if (large) document.documentElement.dataset.readingSize = 'large';
    else delete document.documentElement.dataset.readingSize;
    if (textSizeButton) {
      textSizeButton.querySelector('.reading-label').textContent = large ? 'Standard text' : 'Larger text';
      textSizeButton.setAttribute('aria-pressed', String(large));
    }
  }

  let savedLarge = document.documentElement.dataset.readingSize === 'large';
  try {
    savedLarge = localStorage.getItem(READING_SIZE_KEY) === 'large';
  } catch {
    // Reading controls still work when browser storage is unavailable.
  }
  setReadingSize(savedLarge);

  function toggleReadingSize() {
    const large = document.documentElement.dataset.readingSize !== 'large';
    setReadingSize(large);
    try {
      if (large) localStorage.setItem(READING_SIZE_KEY, 'large');
      else localStorage.removeItem(READING_SIZE_KEY);
    } catch {
      // A temporary preference is useful even without persistence.
    }
  }

  // More contrast: brighter text and lines, solid panels and a thicker focus ring. It follows the device's
  // "increase contrast" setting until the person chooses here; only that reading preference is stored.
  function setContrast(more) {
    if (more) document.documentElement.dataset.contrast = 'more';
    else delete document.documentElement.dataset.contrast;
    if (contrastButton) {
      contrastButton.querySelector('.reading-label').textContent = more ? 'Standard contrast' : 'More contrast';
      contrastButton.setAttribute('aria-pressed', String(more));
    }
  }

  let savedContrast = null;
  try {
    savedContrast = localStorage.getItem(CONTRAST_KEY);
  } catch {
    // Without storage the device setting still applies.
  }
  setContrast(savedContrast ? savedContrast === 'more' : Boolean(window.matchMedia?.('(prefers-contrast: more)').matches));

  function toggleContrast() {
    const more = document.documentElement.dataset.contrast !== 'more';
    setContrast(more);
    try {
      localStorage.setItem(CONTRAST_KEY, more ? 'more' : 'standard');
    } catch {
      // A temporary preference is useful even without persistence.
    }
  }

  const canSpeak = Boolean(
    window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'
  );
  const speechLabel = speakButton?.textContent.trim() || 'Read this aloud';
  let utterance = null;

  function showSpeechState(reading) {
    if (!speakButton) return;
    speakButton.textContent = reading ? 'Stop reading' : speechLabel;
    speakButton.setAttribute('aria-pressed', String(reading));
  }

  function stopReading() {
    const wasReading = utterance !== null;
    utterance = null;
    showSpeechState(false);
    if (wasReading && canSpeak) window.speechSynthesis.cancel();
  }

  function toggleSpeech() {
    if (utterance) {
      stopReading();
      return;
    }
    const text = helpCopy?.innerText.replace(/\s+/g, ' ').trim();
    if (!canSpeak || !text || !dialog?.open) return;
    const next = new window.SpeechSynthesisUtterance(text);
    next.lang = document.documentElement.lang || navigator.language || 'en';
    const finish = () => {
      if (utterance !== next) return;
      utterance = null;
      showSpeechState(false);
    };
    next.onend = finish;
    next.onerror = finish;
    utterance = next;
    showSpeechState(true);
    try {
      window.speechSynthesis.speak(next);
    } catch {
      finish();
    }
  }

  if (speakButton) {
    speakButton.hidden = !canSpeak || !helpCopy;
    showSpeechState(false);
  }

  function openHelp() {
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeHelp() {
    stopReading();
    if (dialog?.open) dialog.close();
  }

  function chooseTool(event) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-help-tool]')
      : null;
    if (!button || !dialog?.contains(button)) return;
    const tool = button.dataset.helpTool;
    if (!HELP_TOOLS.has(tool)) return;
    event.preventDefault();
    closeHelp();
    if (typeof onTool === 'function') onTool(tool);
  }

  openButton?.addEventListener('click', openHelp);
  closeButton?.addEventListener('click', closeHelp);
  textSizeButton?.addEventListener('click', toggleReadingSize);
  contrastButton?.addEventListener('click', toggleContrast);
  speakButton?.addEventListener('click', toggleSpeech);
  dialog?.addEventListener('click', chooseTool);
  dialog?.addEventListener('close', stopReading);
  window.addEventListener('pagehide', stopReading);

  return function unmountPlaygroundHelp() {
    stopReading();
    openButton?.removeEventListener('click', openHelp);
    closeButton?.removeEventListener('click', closeHelp);
    textSizeButton?.removeEventListener('click', toggleReadingSize);
    contrastButton?.removeEventListener('click', toggleContrast);
    speakButton?.removeEventListener('click', toggleSpeech);
    dialog?.removeEventListener('click', chooseTool);
    dialog?.removeEventListener('close', stopReading);
    window.removeEventListener('pagehide', stopReading);
  };
}
