// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findPanelByLayer,
  flashPanel,
  navigateToLayer,
  NAVIGATE_LAYER_EVENT,
  openCommandPalette,
  OPEN_PALETTE_EVENT,
  scrollToLayerPanel,
} from './panelNav';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('findPanelByLayer', () => {
  it('finds a panel by data-panel-id anchor', () => {
    document.body.innerHTML =
      '<div data-panel-id="l46" class="panel">hi</div>';
    expect(findPanelByLayer(46)).not.toBeNull();
  });

  it('finds string anchors', () => {
    document.body.innerHTML = '<div data-panel-id="eeg">eeg</div>';
    expect(findPanelByLayer('eeg')).not.toBeNull();
  });

  it('falls back to eyebrow text for unanchored panels', () => {
    document.body.innerHTML =
      '<section class="panel"><div class="eyebrow">Layer 29 · Affect</div></section>';
    expect(findPanelByLayer(29)).not.toBeNull();
    expect(findPanelByLayer(30)).toBeNull();
  });
});

describe('flashPanel', () => {
  it('adds then removes the panel-flash class', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.appendChild(el);
    flashPanel(el);
    expect(el.classList.contains('panel-flash')).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(el.classList.contains('panel-flash')).toBe(false);
  });
});

describe('scrollToLayerPanel', () => {
  it('returns false when the panel is hidden (offsetParent null)', () => {
    document.body.innerHTML =
      '<div hidden><div data-panel-id="l7" class="panel"></div></div>';
    expect(scrollToLayerPanel(7)).toBe(false);
  });
});

describe('events', () => {
  it('navigateToLayer dispatches the layer id', () => {
    const seen = [];
    const onEvt = (e) => seen.push(e.detail.layerId);
    window.addEventListener(NAVIGATE_LAYER_EVENT, onEvt);
    navigateToLayer(42);
    window.removeEventListener(NAVIGATE_LAYER_EVENT, onEvt);
    expect(seen).toEqual([42]);
  });

  it('openCommandPalette dispatches the open event', () => {
    const spy = vi.fn();
    window.addEventListener(OPEN_PALETTE_EVENT, spy);
    openCommandPalette();
    window.removeEventListener(OPEN_PALETTE_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
