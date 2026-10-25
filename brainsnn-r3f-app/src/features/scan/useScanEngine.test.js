import { beforeEach, describe, expect, it, vi } from '../../test/tinyVitest.js';
import { isKeyboardScanShortcut } from './keyboard.js';
import { initialScanState, scanReducer } from './useScanEngine.js';

describe('useScanEngine and ScanComposer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.__BRAINSNN_ALLOW_LOCAL_FALLBACK__;
  });

  it('surfaces API error state while preserving input', () => {
    const editing = scanReducer(initialScanState, {
      type: 'set-input',
      input: 'This draft has enough content to trigger a scan and preserve input.',
    });
    const errored = scanReducer(editing, { type: 'scan-error', error: 'Service down' });
    expect(errored.status).toBe('error');
    expect(errored.error).toBe('Service down');
    expect(errored.input).toBe('This draft has enough content to trigger a scan and preserve input.');
  });

  it('detects Cmd/Ctrl+Enter keyboard scan shortcut', () => {
    expect(isKeyboardScanShortcut({ key: 'Enter', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isKeyboardScanShortcut({ key: 'Enter', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isKeyboardScanShortcut({ key: 'Enter', ctrlKey: false, metaKey: false })).toBe(false);
  });
});
