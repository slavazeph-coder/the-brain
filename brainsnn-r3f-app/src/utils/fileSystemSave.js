/**
 * fileSystemSave — File System Access API wrapper.
 *
 * Lets users pick a file once, then "Save" overwrites it repeatedly
 * without the browser's download dialog. Fall back to a regular
 * download anchor when the API isn't available (Safari, Firefox).
 *
 * Handles are intentionally NOT persisted — the spec doesn't allow
 * cross-session writes without re-prompting the user.
 */

import { hasFileSystemAccess } from './capabilities';

const handles = new Map();

export function isAvailable() {
  return hasFileSystemAccess();
}

/**
 * Open a save-file picker and remember the handle under `key`.
 * Returns the handle (or null if API unavailable / user cancelled).
 */
export async function pickSaveFile(key, { suggestedName, types } = {}) {
  if (!hasFileSystemAccess()) return null;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: suggestedName || 'export.json',
      types: types || [{
        description: 'JSON',
        accept: { 'application/json': ['.json'] }
      }]
    });
    handles.set(key, handle);
    return handle;
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Write text to the remembered handle for `key`. If no handle exists
 * yet, prompts for one. If the API is unavailable, falls back to a
 * regular download.
 */
export async function saveText(key, text, fallbackName = 'export.json') {
  if (!hasFileSystemAccess()) {
    return downloadFallback(text, fallbackName);
  }
  let handle = handles.get(key);
  if (!handle) {
    handle = await pickSaveFile(key, { suggestedName: fallbackName });
    if (!handle) return { saved: false, reason: 'cancelled' };
  }
  try {
    // Verify the handle is still writable. The browser revokes
    // permission across sessions and after some inactivity windows.
    if (handle.queryPermission) {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const request = await handle.requestPermission({ mode: 'readwrite' });
        if (request !== 'granted') {
          // Permission denied — drop the handle so the next attempt
          // re-prompts, and fall back to a download.
          handles.delete(key);
          return downloadFallback(text, fallbackName);
        }
      }
    }
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { saved: true, name: handle.name };
  } catch (err) {
    // Stale handle or quota error — fall back rather than swallow.
    handles.delete(key);
    return downloadFallback(text, fallbackName);
  }
}

export function clearHandle(key) {
  handles.delete(key);
}

export function hasHandle(key) {
  return handles.has(key);
}

function downloadFallback(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  return { saved: true, fallback: true, name };
}
