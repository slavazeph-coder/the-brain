/**
 * Keyboard Shortcuts Manager
 *
 * Registers global keyboard shortcuts and provides a help map.
 * Call registerShortcuts(handlers) on mount, returns cleanup fn.
 */

export const SHORTCUT_MAP = [
  { key: 'Space', label: 'Play / Pause simulation', action: 'toggleRun' },
  { key: 'b', label: 'Trigger sensory burst', action: 'burst' },
  { key: 'r', label: 'Reset brain state', action: 'reset' },
  { key: '1', label: 'Simulation mode', action: 'modeSimulation' },
  { key: '2', label: 'TRIBE v2 mode', action: 'modeTribe' },
  { key: '3', label: 'Live EEG mode', action: 'modeEeg' },
  { key: 's', label: 'Save snapshot', action: 'snapshot' },
  { key: 'e', label: 'Toggle recording', action: 'record' },
  { key: 'q', label: 'Cycle quality (low → high → ultra)', action: 'cycleQuality' },
  { key: '?', label: 'Show keyboard shortcuts', action: 'showHelp' },
];

export function registerShortcuts(handlers) {
  const onKeyDown = (e) => {
    // Skip if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const key = e.code === 'Space' ? 'Space' : e.key;
    const entry = SHORTCUT_MAP.find((s) => s.key === key);
    if (!entry) return;

    const handler = handlers[entry.action];
    if (handler) {
      e.preventDefault();
      handler();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
