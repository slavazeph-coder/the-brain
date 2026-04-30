/**
 * Layer 109 — Vault store.
 *
 * Local-first persistent note vault. Storage is abstracted so tests can
 * use an in-memory backend; the production default is localStorage with
 * one key per note (`brainsnn_vault_note_<id>`) plus a single index key
 * (`brainsnn_vault_index_v1`). This gives us O(1) per-note read/write
 * and lets the index be loaded and searched without paying for every
 * note body up front.
 *
 * The vault carries its weight by being the *substrate* for L110
 * (graph), L111 (daily notes), and the firewall integration in
 * VaultPanel. Adding a new feature shouldn't require changing the
 * store; everything else is a pure function of `listNotes()` /
 * `getNote(id)`.
 */

// ---------- storage backends ------------------------------------------------

/**
 * In-memory backend for tests.
 */
export function memoryBackend(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get(key) { return map.has(key) ? map.get(key) : null; },
    set(key, value) { map.set(key, value); },
    remove(key) { map.delete(key); },
    keys() { return Array.from(map.keys()); },
  };
}

/**
 * localStorage backend for the browser. Hands back null in non-browser
 * environments instead of throwing — callers should fall through to
 * memoryBackend in that case.
 */
export function localStorageBackend() {
  if (typeof localStorage === 'undefined') return null;
  return {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* quota / privacy */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
    keys() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (k) out.push(k);
        }
      } catch { /* ignore */ }
      return out;
    },
  };
}

// ---------- key namespace --------------------------------------------------

const INDEX_KEY = 'brainsnn_vault_index_v1';
const NOTE_PREFIX = 'brainsnn_vault_note_';

function noteKey(id) {
  return `${NOTE_PREFIX}${id}`;
}

// ---------- id + slug helpers ----------------------------------------------

/**
 * Slugify a title to a URL-safe id. Stable for a given title.
 *   "Hello World!" → "hello-world"
 *   ""             → "untitled"
 */
export function slugify(title) {
  const cleaned = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'untitled';
}

function uniqueId(base, existingIds) {
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function nowMillis() {
  return Date.now();
}

// ---------- vault factory --------------------------------------------------

/**
 * Create a vault on top of a storage backend. The storage interface is the
 * minimal { get, set, remove, keys } shape exported above; pass a custom
 * backend (e.g. an IndexedDB shim) to upgrade later without changing
 * downstream callers.
 */
export function createVault({ backend = (localStorageBackend() ?? memoryBackend()) } = {}) {
  function readIndex() {
    const raw = backend.get(INDEX_KEY);
    if (!raw) return { byId: {} };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.byId) return { byId: {} };
      return parsed;
    } catch {
      return { byId: {} };
    }
  }

  function writeIndex(index) {
    backend.set(INDEX_KEY, JSON.stringify(index));
  }

  function readNote(id) {
    const raw = backend.get(noteKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeNote(note) {
    backend.set(noteKey(note.id), JSON.stringify(note));
  }

  function listEntries() {
    const idx = readIndex();
    return Object.values(idx.byId)
      .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
  }

  function listIds() {
    return Object.keys(readIndex().byId);
  }

  function get(id) {
    return readNote(id);
  }

  function getByTitle(title) {
    const slug = slugify(title);
    const idx = readIndex();
    const entry = idx.byId[slug];
    if (!entry) return null;
    return readNote(entry.id);
  }

  function create({ title = 'Untitled', body = '', tags = [] } = {}) {
    const idx = readIndex();
    const ids = new Set(Object.keys(idx.byId));
    const id = uniqueId(slugify(title), ids);
    const now = nowMillis();
    const note = {
      id,
      title: title.trim() || id,
      body: String(body),
      tags: Array.isArray(tags) ? tags.slice(0, 16).map(String) : [],
      createdAt: now,
      modifiedAt: now,
    };
    writeNote(note);
    idx.byId[id] = { id, title: note.title, tags: note.tags, createdAt: now, modifiedAt: now };
    writeIndex(idx);
    return note;
  }

  function update(id, patch) {
    const existing = readNote(id);
    if (!existing) return null;
    const next = {
      ...existing,
      ...patch,
      id: existing.id,                                         // immutable
      title: (patch.title ?? existing.title).trim() || existing.title,
      tags: Array.isArray(patch.tags)
        ? patch.tags.slice(0, 16).map(String)
        : existing.tags,
      createdAt: existing.createdAt,
      modifiedAt: nowMillis(),
    };
    writeNote(next);
    const idx = readIndex();
    idx.byId[id] = {
      id,
      title: next.title,
      tags: next.tags,
      createdAt: next.createdAt,
      modifiedAt: next.modifiedAt,
    };
    writeIndex(idx);
    return next;
  }

  function remove(id) {
    const idx = readIndex();
    if (!(id in idx.byId)) return false;
    delete idx.byId[id];
    writeIndex(idx);
    backend.remove(noteKey(id));
    return true;
  }

  function importBundle(notes) {
    if (!Array.isArray(notes)) throw new TypeError('importBundle expects an array');
    const idx = readIndex();
    const ids = new Set(Object.keys(idx.byId));
    const created = [];
    for (const raw of notes) {
      const id = uniqueId(slugify(raw.title || raw.id || 'note'), ids);
      ids.add(id);
      const now = nowMillis();
      const note = {
        id,
        title: (raw.title || id).trim(),
        body: String(raw.body || ''),
        tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 16).map(String) : [],
        createdAt: raw.createdAt || now,
        modifiedAt: raw.modifiedAt || now,
      };
      writeNote(note);
      idx.byId[id] = {
        id,
        title: note.title,
        tags: note.tags,
        createdAt: note.createdAt,
        modifiedAt: note.modifiedAt,
      };
      created.push(note);
    }
    writeIndex(idx);
    return created;
  }

  function exportBundle() {
    return listIds().map((id) => readNote(id)).filter(Boolean);
  }

  function clear() {
    for (const id of listIds()) backend.remove(noteKey(id));
    backend.remove(INDEX_KEY);
  }

  function stats() {
    const entries = listEntries();
    let bytes = 0;
    for (const e of entries) {
      const note = readNote(e.id);
      if (note) bytes += note.body.length + note.title.length;
    }
    return {
      noteCount: entries.length,
      bytes,
      tags: new Set(entries.flatMap((e) => e.tags || [])).size,
    };
  }

  return {
    create,
    get,
    getByTitle,
    update,
    remove,
    list: listEntries,
    listIds,
    importBundle,
    exportBundle,
    clear,
    stats,
  };
}
