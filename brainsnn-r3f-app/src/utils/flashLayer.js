/**
 * flashLayer — shared "scroll to a layer panel and ring it cyan" helper.
 *
 * Extracted from CommandPalette.jsx and src/utils/hotkeys.js (both had
 * their own copies of nearly identical logic). The new AppShell needs
 * the same behavior when ⌘K or a 2-letter chord jumps to a layer in a
 * different workspace — it dispatches a `shell:goto` first, then we
 * scroll + flash on the next frame.
 */

import { bus } from '../shell/bus';
import { LAYER_CATALOG } from './layerCatalog';

// Map each layer-id to its workspace. Keep this in sync with
// src/shell/workspaces/*.jsx — when a panel moves workspaces, update here.
export const LAYER_WORKSPACE = {
  // Anchor + drawer panels per workspace. Defaults to 'analyze' for any
  // layer not explicitly mapped.
  4:  'defend', 5:  'defend', 22: 'defend', 23: 'defend', 24: 'defend',
  25: 'defend', 27: 'defend', 31: 'defend', 32: 'defend', 36: 'defend',
  38: 'training', 39: 'defend', 40: 'defend', 41: 'defend', 42: 'training',
  43: 'analyze', 44: 'connect', 45: 'defend', 46: 'defend', 47: 'connect',
  48: 'defend', 49: 'connect', 50: 'training', 51: 'knowledge', 52: 'defend',
  53: 'knowledge', 54: 'connect', 55: 'defend', 56: 'training', 57: 'connect',
  58: 'connect', 59: 'connect', 60: 'defend', 61: 'defend', 62: 'defend',
  63: 'knowledge', 64: 'training', 65: 'connect', 66: 'defend', 67: 'analyze',
  68: 'training', 69: 'knowledge', 70: 'defend', 71: 'brain', 72: 'connect',
  73: 'training', 74: 'defend', 75: 'analyze', 76: 'connect', 77: 'connect',
  78: 'connect', 79: 'training', 80: 'defend', 81: 'connect', 82: 'connect',
  83: 'defend', 84: 'knowledge', 85: 'connect', 86: 'connect', 87: 'training',
  88: 'training', 89: 'training', 90: 'knowledge', 91: 'connect', 92: 'connect',
  93: 'defend', 94: 'connect', 95: 'connect', 96: 'connect', 97: 'connect',
  98: 'connect', 99: 'defend', 100: 'connect',
  1: 'brain',  2: 'brain',  3: 'brain',  6: 'connect', 7: 'analyze',
  8: 'analyze', 9: 'home', 10: 'home', 11: 'connect', 12: 'home',
  13: 'brain', 14: 'connect', 15: 'connect', 16: 'connect', 17: 'analyze',
  18: 'knowledge', 19: 'brain', 20: 'knowledge', 21: 'brain', 26: 'brain',
  28: 'knowledge', 29: 'brain', 30: 'brain', 33: 'knowledge', 34: 'knowledge',
  35: 'knowledge', 37: 'brain', 101: 'defend', 102: 'connect'
};

export function workspaceForLayer(layerId) {
  return LAYER_WORKSPACE[Number(layerId)] || 'analyze';
}

const FLASH_CLASS_DURATION = 1400;

/**
 * Locate a panel by layer id and scroll it into view with a brief cyan
 * ring. If `LAYER_WORKSPACE` says it lives elsewhere, switch workspaces
 * first via the shell bus, then wait one frame before scrolling so the
 * target is in the DOM.
 */
export function flashLayer(layerId) {
  const id = Number(layerId);
  if (!id) return false;

  const ws = workspaceForLayer(id);
  bus.emit('shell:goto', { workspace: ws });

  // Two-rAF dance: first to let React render the new workspace, second
  // to let layout settle before scrolling.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const target = findPanelForLayer(id);
      if (!target) return;
      target.classList.add('shell-flash');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => target.classList.remove('shell-flash'), FLASH_CLASS_DURATION);
    });
  });
  return true;
}

function findPanelForLayer(layerId) {
  // The legacy contract is "an .eyebrow element whose text reads
  // 'Layer NN — …'". Search every panel for such an eyebrow.
  const eyebrows = document.querySelectorAll('.eyebrow');
  const re = new RegExp(`\\blayer\\s*${layerId}\\b`, 'i');
  for (const el of eyebrows) {
    if (re.test(el.textContent || '')) {
      // Walk up to the nearest panel-like container.
      return el.closest('section, .panel, .workspace-card') || el.parentElement;
    }
  }
  // Fallback: try a data-layer attribute if we ever add one.
  return document.querySelector(`[data-layer="${layerId}"]`);
}

export function layerLabelFor(layerId) {
  const e = LAYER_CATALOG.find((l) => l.id === Number(layerId));
  return e ? `Layer ${e.id} · ${e.name}` : null;
}
