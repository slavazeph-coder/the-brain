import React, { useMemo, useState } from 'react';
import { parseFiles } from '../utils/codeParser';
import { buildBM25Index, hybridSearch } from '../utils/bm25';
import { detectCommunities } from '../utils/communities';

/**
 * Layer 20 — Code-Aware Knowledge Brain
 *
 * Paste multiple source files (JS/TS/Python/Go/Rust) → extract symbols
 * via regex parser → build graph → Louvain community detection →
 * BM25+trigram hybrid search. Shows how the code clusters into communities
 * and maps each community onto a brain region via keyword classification.
 *
 * Cannibalized from GitNexus: Tree-sitter → parseFiles (regex-lite),
 * Leiden → Louvain-lite, BM25+semantic+RRF → BM25+trigram+RRF.
 */
export default function CodeBrainPanel({ onApplyToNetwork }) {
  const [input, setInput] = useState(EXAMPLE_INPUT);
  const [graph, setGraph] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const parsed = useMemo(() => {
    if (!graph) return null;
    const communities = detectCommunities({ nodes: graph.nodes, edges: graph.edges });
    const index = buildBM25Index(graph.docs);
    return { ...graph, communities, index };
  }, [graph]);

  function handleAnalyze() {
    const files = parseInput(input);
    if (!files.length) {
      setGraph(null);
      return;
    }
    const result = parseFiles(files);
    setGraph(result);
    setResults([]);
  }

  function handleSearch() {
    if (!parsed?.index || !query.trim()) return;
    const ranked = hybridSearch(query, parsed.index, { topK: 8 });
    setResults(ranked);
  }

  function applyToBrain() {
    if (!parsed?.communities?.communities?.length) return;
    // Map top communities onto brain regions by size.
    // Larger communities → higher activation on cognitive regions.
    const sorted = [...parsed.communities.communities].sort((a, b) => b.size - a.size);
    const total = sorted.reduce((a, c) => a + c.size, 0) || 1;
    const regions = { CTX: 0.2, HPC: 0.2, THL: 0.2, AMY: 0.1, BG: 0.15, PFC: 0.25, CBL: 0.15 };
    const mapping = ['CTX', 'PFC', 'HPC', 'THL', 'BG', 'CBL', 'AMY'];
    sorted.slice(0, mapping.length).forEach((c, i) => {
      const frac = c.size / total;
      regions[mapping[i]] = Math.min(0.95, 0.25 + frac * 1.2);
    });
    onApplyToNetwork?.({
      regions,
      scenario: `Code Brain · ${sorted.length} communities · Q=${parsed.communities.modularity.toFixed(2)}`
    });
  }

  return (
    <section className="panel panel-pad code-brain-panel">
      <div className="eyebrow">Layer 20</div>
      <h2>Code-Aware Knowledge Brain</h2>
      <p className="muted">
        Regex-parsed code → Louvain community detection → BM25 + trigram hybrid search.
        Cannibalized from GitNexus: Tree-sitter → regex, Leiden → Louvain-lite, RRF hybrid search.
      </p>

      <label className="muted small-note">
        Paste files using <code>=== path/to/file.ext ===</code> delimiters, or one file raw:
      </label>
      <textarea
        className="code-brain-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={8}
        spellCheck={false}
      />

      <div className="code-brain-actions">
        <button className="primary" onClick={handleAnalyze}>Analyze code</button>
        {parsed && (
          <button className="ghost" onClick={applyToBrain}>Apply communities to brain</button>
        )}
      </div>

      {parsed && (
        <>
          <div className="code-brain-stats">
            <div className="metric"><small>Files</small><strong>{parsed.stats.totalFiles}</strong></div>
            <div className="metric"><small>Symbols</small><strong>{parsed.stats.totalSymbols}</strong></div>
            <div className="metric"><small>Communities</small><strong>{parsed.communities.communities.length}</strong></div>
            <div className="metric"><small>Modularity</small><strong>{parsed.communities.modularity.toFixed(3)}</strong></div>
          </div>

          <div className="code-brain-communities">
            <strong>Communities</strong>
            <div className="code-brain-chip-grid">
              {parsed.communities.communities.slice(0, 10).map((c) => (
                <div key={c.id} className="code-brain-comm-chip">
                  <span className="code-brain-comm-label">{c.label}</span>
                  <span className="code-brain-comm-size">{c.size}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="code-brain-search">
            <label className="muted small-note">Hybrid search (BM25 + trigram RRF):</label>
            <div className="code-brain-search-row">
              <input
                className="code-brain-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="e.g. authentication, user model, parseFile"
              />
              <button className="ghost" onClick={handleSearch}>Search</button>
            </div>
            {results.length > 0 && (
              <div className="code-brain-results">
                {results.map((r) => (
                  <div key={r.id} className="code-brain-result-row">
                    <span className="code-brain-kind">{r.doc.meta.kind}</span>
                    <span className="code-brain-name">{r.doc.meta.label}</span>
                    <span className="code-brain-path muted small-note">{r.doc.meta.path || ''}</span>
                    <span className="code-brain-scores muted small-note">
                      bm25 {r.bm25.toFixed(2)} · sem {r.semantic.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- input parsing ----------

/**
 * Accepts either:
 *  A) Multi-file block with delimiters:
 *     === src/foo.js ===
 *     <code>
 *     === src/bar.py ===
 *     <code>
 *  B) Single raw file — treated as "pasted.js"
 */
function parseInput(text) {
  if (!text?.trim()) return [];
  const blockRe = /^===\s*(.+?)\s*===\s*$/gm;
  if (!blockRe.test(text)) {
    return [{ path: 'pasted.js', source: text }];
  }
  const files = [];
  const lines = text.split('\n');
  let currentPath = null;
  let buffer = [];
  const flush = () => {
    if (currentPath) files.push({ path: currentPath, source: buffer.join('\n') });
    buffer = [];
  };
  for (const line of lines) {
    const m = line.match(/^===\s*(.+?)\s*===\s*$/);
    if (m) {
      flush();
      currentPath = m[1];
    } else if (currentPath) {
      buffer.push(line);
    }
  }
  flush();
  return files;
}

const EXAMPLE_INPUT = `=== src/auth.js ===
export function login(user, password) {
  return verifyCredentials(user, password);
}
export function logout(token) {
  return invalidate(token);
}
class AuthService {
  constructor(db) { this.db = db; }
  authenticate(user) { return this.db.check(user); }
}

=== src/models/user.js ===
import { db } from '../auth';
export class User {
  constructor(id, email) { this.id = id; this.email = email; }
  save() { return db.insert(this); }
}
export function findUser(id) { return db.query(id); }

=== src/api/routes.js ===
import { login, logout } from '../auth';
import { User, findUser } from '../models/user';
export function registerRoutes(app) {
  app.post('/login', login);
  app.post('/logout', logout);
  app.get('/user/:id', (req) => findUser(req.params.id));
}
`;
