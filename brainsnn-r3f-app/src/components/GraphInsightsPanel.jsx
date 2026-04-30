import React, { useMemo, useState } from 'react';
import { parseFiles } from '../utils/codeParser';
import { detectCommunities, detectCommunitiesLeiden } from '../utils/communities';
import { analyzeGraph } from '../utils/graphAnalytics';
import { downloadGraphWikiBundle } from '../utils/wikiGenerator';

/**
 * Layer 101 — Graph Insights
 *
 * Cannibalized from safishamsi/graphify. Takes the same code paste as
 * Layer 20 and runs three structural analytics on top:
 *   - Edge confidence (EXTRACTED / INFERRED / AMBIGUOUS) provenance
 *   - God-node detection (cross-community hubs, artifact-filtered)
 *   - Surprising connections (cross-community + cross-filetype + asym)
 *   - Suggested questions (7 archetypes derived from graph structure)
 *
 * Toggle Leiden refinement to split disconnected communities. Export
 * everything as a markdown wiki bundle.
 */
export default function GraphInsightsPanel({ onApplyToNetwork }) {
  const [input, setInput] = useState(EXAMPLE_INPUT);
  const [graph, setGraph] = useState(null);
  const [algorithm, setAlgorithm] = useState('leiden'); // 'louvain' | 'leiden'
  const [error, setError] = useState(null);

  const result = useMemo(() => {
    if (!graph) return null;
    try {
      const detect = algorithm === 'leiden' ? detectCommunitiesLeiden : detectCommunities;
      const communities = detect({ nodes: graph.nodes, edges: graph.edges });
      const analytics = analyzeGraph(graph, communities);
      return { graph, communities, analytics };
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [graph, algorithm]);

  function handleAnalyze() {
    setError(null);
    const files = parseInput(input);
    if (!files.length) {
      setGraph(null);
      return;
    }
    const parsed = parseFiles(files);
    setGraph(parsed);
  }

  function handleExport() {
    if (!result) return;
    downloadGraphWikiBundle(result.graph, result.communities, result.analytics);
  }

  function applyToBrain() {
    if (!result?.analytics) return;
    const { godNodes, surprising, questions } = result.analytics;
    // Map insight density onto cognitive regions:
    //   PFC = analytical load (questions)
    //   HPC = recall surface (god-nodes)
    //   CTX = breadth (community count)
    //   THL = signal routing (surprising connections)
    //   AMY = ambiguity / unease (AMBIGUOUS edges)
    const ambig = (graph?.stats?.provenance?.AMBIGUOUS) || 0;
    const regions = {
      PFC: clamp(0.35 + questions.length * 0.04, 0.2, 0.95),
      HPC: clamp(0.3 + godNodes.length * 0.05, 0.2, 0.9),
      CTX: clamp(0.25 + (result.communities.communities.length || 0) * 0.03, 0.2, 0.9),
      THL: clamp(0.25 + surprising.length * 0.04, 0.2, 0.9),
      AMY: clamp(0.2 + ambig * 0.02, 0.15, 0.9),
      BG: 0.35,
      CBL: 0.3
    };
    onApplyToNetwork?.({
      regions,
      scenario: `Graph Insights · ${godNodes.length} god-nodes · ${surprising.length} surprising · ${questions.length} questions`
    });
  }

  return (
    <section className="panel panel-pad code-brain-panel">
      <div className="eyebrow">Layer 101</div>
      <h2>Graph Insights</h2>
      <p className="muted">
        Cannibalized from safishamsi/graphify. Edge-confidence provenance,
        god-node detection, surprising connections, and 7 graph-derived
        question archetypes — turns Layer 20 from a viewer into an analyst.
      </p>

      <label className="muted small-note">
        Paste files using <code>=== path/to/file.ext ===</code> delimiters,
        or one file raw:
      </label>
      <textarea
        className="code-brain-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={8}
        spellCheck={false}
      />

      <div className="code-brain-actions">
        <button className="primary" onClick={handleAnalyze}>Analyze graph</button>
        <label className="muted small-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Clusterer:</span>
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value)}
            className="code-brain-query"
            style={{ padding: '4px 8px', maxWidth: 140 }}
          >
            <option value="leiden">Leiden-lite</option>
            <option value="louvain">Louvain</option>
          </select>
        </label>
        {result && (
          <>
            <button className="ghost" onClick={applyToBrain}>Apply to brain</button>
            <button className="ghost" onClick={handleExport}>Export wiki</button>
          </>
        )}
      </div>

      {error && <div className="muted small-note" style={{ color: '#f87171' }}>Error: {error}</div>}

      {result && (
        <>
          <div className="code-brain-stats">
            <div className="metric"><small>Nodes</small><strong>{result.graph.nodes.length}</strong></div>
            <div className="metric"><small>Edges</small><strong>{result.graph.edges.length}</strong></div>
            <div className="metric"><small>Communities</small><strong>{result.communities.communities.length}</strong></div>
            <div className="metric"><small>Modularity</small><strong>{result.communities.modularity.toFixed(3)}</strong></div>
            {result.communities.refined != null && (
              <div className="metric"><small>Leiden splits</small><strong>{result.communities.refined}</strong></div>
            )}
          </div>

          <ProvenanceBreakdown stats={result.graph.stats} />

          <Section title="God-nodes" hint="High-degree hubs spanning multiple communities, artifact-filtered.">
            {result.analytics.godNodes.length === 0 ? (
              <Empty>No god-nodes — graph has no dominant hubs.</Empty>
            ) : (
              <div className="code-brain-results">
                {result.analytics.godNodes.map((g) => (
                  <div key={g.id} className="code-brain-result-row">
                    <span className="code-brain-kind">{g.kind}</span>
                    <span className="code-brain-name">{g.label}</span>
                    <span className="code-brain-path muted small-note">{g.path || ''}</span>
                    <span className="code-brain-scores muted small-note">
                      deg {g.degree} · {g.communities} comms · score {g.score.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Surprising connections" hint="Cross-community + cross-filetype + peripheral→hub edges.">
            {result.analytics.surprising.length === 0 ? (
              <Empty>No surprises — every edge sits inside its community.</Empty>
            ) : (
              <div className="code-brain-results">
                {result.analytics.surprising.map((s, i) => (
                  <div key={i} className="code-brain-result-row">
                    <span className="code-brain-name">{s.sourceLabel} ↔ {s.targetLabel}</span>
                    <span className="code-brain-scores muted small-note">
                      {s.score.toFixed(2)} · {s.reasons.join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Suggested questions" hint="Derived purely from graph structure — no LLM.">
            {result.analytics.questions.length === 0 ? (
              <Empty>No questions raised — graph reads cleanly.</Empty>
            ) : (
              <ul className="code-brain-question-list">
                {result.analytics.questions.map((q, i) => (
                  <li key={i}>
                    <span className="code-brain-archetype">{q.archetype}</span>
                    <span>{q.prompt}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </section>
  );
}

function ProvenanceBreakdown({ stats }) {
  const prov = stats?.provenance;
  if (!prov || !Object.keys(prov).length) return null;
  const total = Object.values(prov).reduce((a, b) => a + b, 0) || 1;
  const tags = [
    { id: 'EXTRACTED', color: '#5ee69a' },
    { id: 'INFERRED', color: '#5ad4ff' },
    { id: 'AMBIGUOUS', color: '#f59e0b' }
  ];
  return (
    <div className="code-brain-communities">
      <strong>Edge confidence</strong>
      <div className="code-brain-chip-grid">
        {tags.map((t) => {
          const count = prov[t.id] || 0;
          if (!count) return null;
          const pct = ((count / total) * 100).toFixed(0);
          return (
            <div
              key={t.id}
              className="code-brain-comm-chip"
              style={{ borderColor: t.color }}
            >
              <span className="code-brain-comm-label" style={{ color: t.color }}>{t.id}</span>
              <span className="code-brain-comm-size">{count} · {pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <div className="code-brain-search">
      <strong>{title}</strong>
      {hint && <div className="muted small-note">{hint}</div>}
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div className="muted small-note">{children}</div>;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- input parsing (mirrors CodeBrainPanel) ----------

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
import bcrypt from 'bcrypt';
import { logger } from './logger';
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
import express from 'express';
import { login, logout } from '../auth';
import { User, findUser } from '../models/user';
export function registerRoutes(app) {
  app.post('/login', login);
  app.post('/logout', logout);
  app.get('/user/:id', (req) => findUser(req.params.id));
}

=== src/logger.js ===
export const logger = {
  info: (msg) => console.log(msg),
  error: (msg) => console.error(msg)
};

=== src/utils/hash.py ===
import hashlib
def sha256(text):
    return hashlib.sha256(text.encode()).hexdigest()
class Hasher:
    def hash(self, value): return sha256(value)
`;
