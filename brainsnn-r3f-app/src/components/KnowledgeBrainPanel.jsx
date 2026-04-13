import React, { useRef, useState } from 'react';
import { KNOWLEDGE_DOMAINS, knowledgeToBrainState } from '../data/knowledgeGraph';
import {
  parseFileInventory, parseJSONInventory, buildKnowledgeMap,
  detectGaps, generateLearningSuggestions
} from '../utils/knowledgeScanner';

function DomainCard({ domainId, data }) {
  const domain = KNOWLEDGE_DOMAINS[domainId];
  if (!domain) return null;
  const depthPct = ((data?.depth || 0) * 100).toFixed(0);
  const barColor = data?.depth > 0.6 ? 'var(--ok)' : data?.depth > 0.3 ? '#fdab43' : 'var(--danger)';

  return (
    <div className="kb-domain-card">
      <div className="kb-domain-head">
        <span className="kb-domain-dot" style={{ background: domain.color }} />
        <strong>{domain.name}</strong>
        <span className="muted kb-domain-count">{data?.count || 0} docs</span>
      </div>
      <div className="weight-bar">
        <span style={{ width: `${depthPct}%`, background: barColor }} />
      </div>
      <div className="kb-domain-meta">
        <span>Depth {depthPct}%</span>
        <span>Fresh {((data?.freshness || 0) * 100).toFixed(0)}%</span>
        <span>Cover {((data?.coverage || 0) * 100).toFixed(0)}%</span>
      </div>
      {data?.topics?.length > 0 && (
        <div className="firewall-chips" style={{ marginTop: 6 }}>
          {data.topics.slice(0, 5).map((t, i) => (
            <span key={i} className="firewall-chip">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function GapCard({ gap }) {
  const sevColor = gap.severity === 'critical' ? 'var(--danger)' : '#fdab43';
  return (
    <div className="kb-gap-card">
      <div className="kb-gap-head">
        <span className="kb-gap-sev" style={{ color: sevColor }}>
          {gap.severity === 'critical' ? '!!' : '!'} {gap.type}
        </span>
        <strong>{gap.name}</strong>
      </div>
      <p className="muted">{gap.message}</p>
      <p className="kb-gap-suggestion">{gap.suggestion}</p>
    </div>
  );
}

export default function KnowledgeBrainPanel({ onApplyKnowledgeState }) {
  const [inputMode, setInputMode] = useState('text'); // text | json | manual
  const [rawInput, setRawInput] = useState('');
  const [knowledgeMap, setKnowledgeMap] = useState(null);
  const [gaps, setGaps] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const handleScan = () => {
    setError('');
    try {
      let documents;
      if (inputMode === 'json') {
        documents = parseJSONInventory(rawInput);
      } else {
        documents = parseFileInventory(rawInput);
      }

      const result = buildKnowledgeMap(documents);
      setKnowledgeMap(result.map);
      setScanResult(result);

      const detectedGaps = detectGaps(result.map);
      setGaps(detectedGaps);

      const learnSuggestions = generateLearningSuggestions(detectedGaps, result.map);
      setSuggestions(learnSuggestions);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawInput(text);
    setInputMode(file.name.endsWith('.json') ? 'json' : 'text');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleApplyToBrain = () => {
    if (!knowledgeMap || !onApplyKnowledgeState) return;
    const brainState = knowledgeToBrainState(knowledgeMap);
    onApplyKnowledgeState(brainState);
  };

  const handleLoadExample = () => {
    setInputMode('text');
    setRawInput(
`src/utils/sim.js | STDP Simulation Engine | 2026-04-10
src/utils/cognitiveFirewall.js | Cognitive Firewall Scoring | 2026-04-08
src/utils/gemmaEngine.js | Gemma 4 API Client | 2026-04-12
src/utils/analytics.js | Neural Analytics Engine | 2026-04-12
src/utils/pluginSystem.js | Analysis Plugin System | 2026-04-13
src/utils/liveSync.js | WebSocket Live Sync | 2026-04-13
src/components/BrainScene.jsx | 3D Brain Viewer | 2026-04-05
server/api.py | TRIBE v2 FastAPI Server | 2026-04-06
server/region_mapper.py | Brain Region Mapper | 2026-04-06
docs/architecture.md | System Architecture Notes | 2026-03-20
docs/security-model.md | Security Threat Model | 2026-02-15
notes/market-analysis.md | Competitive Market Analysis | 2026-03-01
notes/pricing-strategy.md | Pricing and Monetization | 2026-03-10
research/tribe-v2-paper.md | TRIBE v2 Foundation Model | 2026-04-05
research/gemma-4-overview.md | Gemma 4 Model Architecture | 2026-04-12
tools/build-pipeline.md | CI/CD Pipeline Config | 2026-01-20
tools/dev-workflow.md | Developer Workflow Guide | 2025-12-01`
    );
  };

  const overallDepth = knowledgeMap
    ? Object.values(knowledgeMap).reduce((a, d) => a + d.depth, 0) / Object.keys(knowledgeMap).length
    : 0;

  return (
    <section className="panel panel-pad kb-panel">
      <div className="eyebrow">Layer 18 — Second Brain</div>
      <h2>Knowledge Brain</h2>
      <p className="muted">
        Transform the 3D brain into a knowledge map. Feed your file inventory and see which
        knowledge domains are strong, which are stale, and where the gaps are. Based on the
        LLM-Wiki organizing framework.
      </p>

      {/* Input mode tabs */}
      <div className="kb-input-tabs">
        <button className={`btn-sm ${inputMode === 'text' ? 'active' : ''}`} onClick={() => setInputMode('text')}>
          File list
        </button>
        <button className={`btn-sm ${inputMode === 'json' ? 'active' : ''}`} onClick={() => setInputMode('json')}>
          JSON
        </button>
        <button className="btn-sm" onClick={handleLoadExample}>
          Load example
        </button>
        <button className="btn-sm" onClick={() => fileRef.current?.click()}>
          Upload file
        </button>
        <input ref={fileRef} type="file" accept=".json,.txt,.md,.csv" style={{ display: 'none' }} onChange={handleFileUpload} />
      </div>

      <textarea
        className="firewall-input"
        placeholder={inputMode === 'json'
          ? '[{"path": "docs/ai.md", "title": "AI Notes", "tags": ["ai","ml"]}]'
          : 'path/to/file.md | Document Title | 2026-04-10\npath/to/other.md | Other Doc'}
        value={rawInput}
        onChange={(e) => setRawInput(e.target.value)}
        rows={6}
      />

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={handleScan} disabled={!rawInput.trim()}>
          Scan knowledge
        </button>
        {knowledgeMap && (
          <button className="btn" onClick={handleApplyToBrain}>
            Apply to 3D brain
          </button>
        )}
      </div>

      {error && <p className="gemma-error">{error}</p>}

      {/* Results */}
      {knowledgeMap && (
        <div className="kb-results">
          {/* Overview */}
          <div className="kb-overview">
            <div className="kb-overview-stat">
              <small>Total documents</small>
              <strong>{scanResult?.totalDocs || 0}</strong>
            </div>
            <div className="kb-overview-stat">
              <small>Overall depth</small>
              <strong style={{ color: overallDepth > 0.5 ? 'var(--ok)' : overallDepth > 0.25 ? '#fdab43' : 'var(--danger)' }}>
                {(overallDepth * 100).toFixed(0)}%
              </strong>
            </div>
            <div className="kb-overview-stat">
              <small>Knowledge gaps</small>
              <strong style={{ color: gaps.length > 3 ? 'var(--danger)' : gaps.length > 0 ? '#fdab43' : 'var(--ok)' }}>
                {gaps.length}
              </strong>
            </div>
            <div className="kb-overview-stat">
              <small>Domains covered</small>
              <strong>{Object.values(knowledgeMap).filter((d) => d.count > 0).length} / 7</strong>
            </div>
          </div>

          {/* Domain cards */}
          <div className="kb-domains">
            <div className="eyebrow">Knowledge domains</div>
            <div className="kb-domain-grid">
              {Object.entries(knowledgeMap).map(([id, data]) => (
                <DomainCard key={id} domainId={id} data={data} />
              ))}
            </div>
          </div>

          {/* Gaps */}
          {gaps.length > 0 && (
            <div className="kb-gaps">
              <div className="eyebrow">Knowledge gaps detected</div>
              <div className="kb-gap-list">
                {gaps.map((g, i) => <GapCard key={i} gap={g} />)}
              </div>
            </div>
          )}

          {/* Self-learning suggestions */}
          {suggestions.length > 0 && (
            <div className="kb-suggestions">
              <div className="eyebrow">Self-learning suggestions</div>
              <div className="kb-suggestion-list">
                {suggestions.map((s, i) => (
                  <div key={i} className="kb-suggestion-item">
                    <span className={`kb-priority kb-priority-${s.priority}`}>
                      {s.priority}
                    </span>
                    <div>
                      <p className="kb-suggestion-action">{s.action}</p>
                      <p className="muted">{s.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
