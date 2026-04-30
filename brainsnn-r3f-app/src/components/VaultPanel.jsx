import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createVault,
  localStorageBackend,
  memoryBackend,
} from '../utils/vault';
import {
  renderMarkdown,
  extractTags,
  wordCount,
} from '../utils/vaultMarkdown';
import { buildLinkGraph, backlinksFor } from '../utils/vaultGraph';
import { autocompleteTitles, searchVault } from '../utils/vaultSearch';
import { ensureDailyNote } from '../utils/vaultDaily';
import { scoreContent } from '../utils/cognitiveFirewall';

/**
 * Layer 109 — Vault.
 *
 * Local-first markdown vault with bidirectional [[wikilinks]], backlinks,
 * tag filter, fuzzy search, daily notes, folder import/export — and a
 * cognitive-firewall score on every note (the BrainSNN differentiator).
 *
 * Data lives in localStorage by namespace `brainsnn_vault_*`; the L57
 * Data Portability layer continues to round-trip the entire workspace.
 */

const STORAGE_BACKEND = localStorageBackend() ?? memoryBackend();
const VAULT = createVault({ backend: STORAGE_BACKEND });

function fmtMs(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString();
}

function pctBar(p, color) {
  return (
    <div style={{ height: 5, borderRadius: 2, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
      <div style={{ width: `${(p * 100).toFixed(1)}%`, height: '100%', background: color }} />
    </div>
  );
}

function FirewallScoreCard({ score }) {
  if (!score) return null;
  return (
    <div
      style={{
        padding: 10,
        background: 'rgba(255,255,255,0.025)',
        borderRadius: 6,
        marginTop: 10,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong>Cognitive firewall</strong>
        <span className="muted small-note">{score.recommendedAction}</span>
      </div>
      {[
        { key: 'emotionalActivation', label: 'emotional', color: '#dd6974' },
        { key: 'cognitiveSuppression', label: 'suppression', color: '#fdab43' },
        { key: 'manipulationPressure', label: 'pressure', color: '#a86fdf' },
        { key: 'trustErosion', label: 'trust erosion', color: '#5591c7' },
      ].map((row) => (
        <div key={row.key} style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
            <span>{row.label}</span>
            <span style={{ fontFamily: 'monospace' }}>{(score[row.key] * 100).toFixed(0)}</span>
          </div>
          {pctBar(score[row.key], row.color)}
        </div>
      ))}
    </div>
  );
}

export default function VaultPanel() {
  const [tick, setTick] = useState(0);                    // bump to trigger reread
  const [activeId, setActiveId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingBody, setEditingBody] = useState('');
  const [editingTagsRaw, setEditingTagsRaw] = useState('');
  const [search, setSearch] = useState('');
  const [showPreview, setShowPreview] = useState(true);
  const [autocomplete, setAutocomplete] = useState({ open: false, items: [], anchor: 0 });
  const editorRef = useRef(null);

  const notes = useMemo(() => {
    void tick;
    return VAULT.list().map((entry) => VAULT.get(entry.id)).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeId) || null,
    [notes, activeId],
  );

  // Sync editor state when activeId changes.
  useEffect(() => {
    if (!activeNote) {
      setEditingTitle('');
      setEditingBody('');
      setEditingTagsRaw('');
      return;
    }
    setEditingTitle(activeNote.title);
    setEditingBody(activeNote.body);
    setEditingTagsRaw((activeNote.tags || []).join(', '));
  }, [activeId, activeNote]);

  const linkGraph = useMemo(() => buildLinkGraph(notes), [notes]);
  const resolveWikilink = useMemo(() => linkGraph.resolve, [linkGraph]);
  const backlinks = useMemo(
    () => (activeId ? backlinksFor(notes, activeId) : []),
    [notes, activeId],
  );

  const searchResults = useMemo(() => {
    if (!search) return null;
    return searchVault(notes, search, { limit: 12 });
  }, [notes, search]);

  const previewHtml = useMemo(
    () => renderMarkdown(editingBody, { resolveWikilink }),
    [editingBody, resolveWikilink],
  );

  const firewallScore = useMemo(() => {
    if (!activeNote) return null;
    if ((editingBody || '').trim().split(/\s+/).length < 5) return null;
    return scoreContent(editingBody);
  }, [editingBody, activeNote]);

  const stats = useMemo(() => {
    const noteStats = VAULT.stats();
    return { ...noteStats, words: wordCount(editingBody), links: linkGraph.edges.length };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, editingBody, linkGraph]);

  function bump() { setTick((t) => t + 1); }

  function handleNew() {
    const note = VAULT.create({ title: 'Untitled', body: '' });
    setActiveId(note.id);
    bump();
  }

  function handleDailyNote() {
    const note = ensureDailyNote(VAULT);
    setActiveId(note.id);
    bump();
  }

  function handleSave() {
    if (!activeNote) return;
    const tags = editingTagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
    VAULT.update(activeId, { title: editingTitle, body: editingBody, tags });
    bump();
  }

  function handleDelete() {
    if (!activeNote) return;
    if (!confirm(`Delete "${activeNote.title}"? This cannot be undone.`)) return;
    VAULT.remove(activeId);
    setActiveId(null);
    bump();
  }

  function handleExport() {
    const bundle = VAULT.exportBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-vault-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  async function handleImportFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const bundle = [];
    for (const file of files) {
      const text = await file.text();
      const filename = file.name.replace(/\.md$/i, '').replace(/_/g, ' ');
      // try to parse as JSON bundle first
      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) bundle.push(...parsed);
          continue;
        } catch { /* fall through */ }
      }
      bundle.push({ title: filename, body: text });
    }
    VAULT.importBundle(bundle);
    bump();
  }

  function handleEditorKeyDown(e) {
    // wikilink autocomplete trigger: typing '[[' opens the picker
    if (e.key === 'Enter' && autocomplete.open && autocomplete.items.length) {
      e.preventDefault();
      insertWikilink(autocomplete.items[0].title);
      return;
    }
    if (e.key === 'Escape' && autocomplete.open) {
      setAutocomplete({ open: false, items: [], anchor: 0 });
    }
  }

  function handleEditorChange(e) {
    const next = e.target.value;
    setEditingBody(next);
    const cursor = e.target.selectionStart;
    const upto = next.slice(0, cursor);
    const m = /\[\[([^\][\n]*)$/.exec(upto);
    if (m) {
      const items = autocompleteTitles(notes, m[1]);
      setAutocomplete({ open: items.length > 0, items, anchor: cursor - m[1].length });
    } else {
      setAutocomplete({ open: false, items: [], anchor: 0 });
    }
  }

  function insertWikilink(title) {
    const ed = editorRef.current;
    if (!ed) return;
    const cursor = ed.selectionStart;
    const upto = editingBody.slice(0, cursor);
    const after = editingBody.slice(cursor);
    const m = /\[\[([^\][\n]*)$/.exec(upto);
    if (!m) return;
    const start = cursor - m[1].length;
    const next = `${editingBody.slice(0, start)}${title}]]${after}`;
    setEditingBody(next);
    setAutocomplete({ open: false, items: [], anchor: 0 });
    requestAnimationFrame(() => {
      ed.focus();
      const pos = start + title.length + 2;
      ed.setSelectionRange(pos, pos);
    });
  }

  function handlePreviewClick(e) {
    const target = e.target.closest('a.vault-wikilink');
    if (!target) return;
    e.preventDefault();
    const wikilink = target.dataset.wikilink;
    if (!wikilink) return;
    const existing = VAULT.getByTitle(wikilink);
    if (existing) {
      setActiveId(existing.id);
    } else {
      const note = VAULT.create({ title: wikilink, body: '' });
      setActiveId(note.id);
    }
    bump();
  }

  return (
    <section className="panel panel-pad vault-panel">
      <div className="eyebrow">Layer 109 · vault</div>
      <h2>{stats.noteCount} notes · {stats.tags} tags · {stats.links} links</h2>
      <p className="muted">
        Local-first markdown vault with bidirectional <code>[[wikilinks]]</code>,
        tag pane, fuzzy search, and a <strong>cognitive firewall on every note</strong> —
        not just incoming text. Storage is the same <code>brainsnn_*</code>
        localStorage namespace as the rest of the app.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={handleNew}>New note</button>
        <button className="btn" onClick={handleDailyNote}>Today’s note</button>
        <label className="btn">
          Import .md / .json
          <input
            type="file"
            multiple
            accept=".md,.markdown,.txt,.json"
            style={{ display: 'none' }}
            onChange={(e) => handleImportFiles(e.target.files)}
          />
        </label>
        <button className="btn" onClick={handleExport}>Export JSON</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(0, 2fr)', gap: 10, marginTop: 14 }}>
        {/* Sidebar */}
        <div>
          <input
            className="share-input"
            placeholder="Search vault…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%' }}
          />
          <div style={{ marginTop: 8, maxHeight: 380, overflowY: 'auto' }}>
            {searchResults
              ? searchResults.length
                ? searchResults.map(({ note, score }) => (
                    <button
                      key={note.id}
                      onClick={() => setActiveId(note.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '6px 8px',
                        background: activeId === note.id ? 'rgba(90,212,255,0.1)' : 'transparent',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: 4,
                        marginBottom: 4,
                        color: '#cbd5e1',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{note.title}</div>
                      <div className="muted small-note">{Math.round(score)} · {note.tags?.join(', ') || 'no tags'}</div>
                    </button>
                  ))
                : <div className="muted small-note">No matches.</div>
              : notes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => setActiveId(note.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      background: activeId === note.id ? 'rgba(90,212,255,0.1)' : 'transparent',
                      border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: 4,
                      marginBottom: 4,
                      color: '#cbd5e1',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{note.title}</div>
                    <div className="muted small-note">
                      {(note.tags || []).join(', ') || 'no tags'} · {fmtMs(note.modifiedAt).split(',')[0]}
                    </div>
                  </button>
                ))}
            {!notes.length && !searchResults && (
              <div className="muted small-note">Empty vault. Click <strong>New note</strong> or <strong>Today’s note</strong>.</div>
            )}
          </div>
        </div>

        {/* Editor + preview + side info */}
        <div>
          {!activeNote && (
            <div className="muted small-note" style={{ padding: 16, textAlign: 'center' }}>
              No note selected.
            </div>
          )}
          {activeNote && (
            <>
              <input
                className="share-input"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={handleSave}
                style={{ width: '100%', fontSize: 18, fontWeight: 600 }}
              />
              <input
                className="share-input"
                placeholder="tags, comma, separated"
                value={editingTagsRaw}
                onChange={(e) => setEditingTagsRaw(e.target.value)}
                onBlur={handleSave}
                style={{ width: '100%', marginTop: 6, fontSize: 12 }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: showPreview ? '1fr 1fr' : '1fr', gap: 10, marginTop: 10 }}>
                <div style={{ position: 'relative' }}>
                  <textarea
                    ref={editorRef}
                    value={editingBody}
                    onChange={handleEditorChange}
                    onKeyDown={handleEditorKeyDown}
                    onBlur={handleSave}
                    placeholder="Write markdown. Use [[Title]] to link."
                    style={{
                      width: '100%',
                      minHeight: 300,
                      background: 'rgba(255,255,255,0.025)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 4,
                      padding: 8,
                      color: '#e2e8f0',
                      fontFamily: 'monospace',
                      fontSize: 13,
                      resize: 'vertical',
                    }}
                  />
                  {autocomplete.open && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        left: 8,
                        background: '#1e293b',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 4,
                        padding: 4,
                        zIndex: 10,
                      }}
                    >
                      {autocomplete.items.map((it) => (
                        <button
                          key={it.id}
                          onClick={() => insertWikilink(it.title)}
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: '4px 8px',
                            background: 'transparent',
                            border: 'none',
                            color: '#cbd5e1',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            cursor: 'pointer',
                          }}
                        >
                          {it.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {showPreview && (
                  <div
                    onClick={handlePreviewClick}
                    style={{
                      background: 'rgba(255,255,255,0.025)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 4,
                      padding: 12,
                      fontSize: 13,
                      lineHeight: 1.55,
                      minHeight: 300,
                      maxHeight: 420,
                      overflowY: 'auto',
                    }}
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? 'Hide preview' : 'Show preview'}
                </button>
                <button className="btn primary" onClick={handleSave}>Save</button>
                <button className="btn" onClick={handleDelete} style={{ marginLeft: 'auto' }}>
                  Delete
                </button>
              </div>

              <FirewallScoreCard score={firewallScore} />

              <div style={{ marginTop: 12 }}>
                <h3 style={{ fontSize: 13, marginBottom: 4 }}>Backlinks ({backlinks.length})</h3>
                {backlinks.length === 0 && <div className="muted small-note">No incoming wikilinks yet.</div>}
                {backlinks.map((bl, i) => {
                  const src = notes.find((n) => n.id === bl.from);
                  return (
                    <button
                      key={`${bl.from}-${i}`}
                      onClick={() => setActiveId(bl.from)}
                      style={{
                        display: 'block',
                        textAlign: 'left',
                        padding: '4px 8px',
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: 4,
                        margin: '2px 0',
                        color: '#cbd5e1',
                        fontSize: 12,
                        cursor: 'pointer',
                        width: '100%',
                      }}
                    >
                      {src?.title || bl.from} → <code style={{ color: '#5ad4ff' }}>[[{bl.target}]]</code>
                    </button>
                  );
                })}
              </div>

              {linkGraph.missing.length > 0 && activeNote && (
                <div className="muted small-note" style={{ marginTop: 12 }}>
                  Broken wikilinks across the vault:
                  {' '}
                  {linkGraph.missing.slice(0, 6).map((m, i) => (
                    <span key={i} style={{ marginRight: 6 }}><code>[[{m.target}]]</code> ×{m.count}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
