import React, { useRef, useState } from 'react';
import { Download, GitCompare, Save, Send, Share2, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { deriveExecutiveVerdict } from '../../lib/scoreMapping.js';
import { ExecutiveVerdict } from './ExecutiveVerdict.jsx';
import { BrainSignalView } from './BrainSignalView.jsx';
import { DecisionScorecard } from './DecisionScorecard.jsx';
import { ContentHeatmap } from './ContentHeatmap.jsx';
import { AttentionTimeline } from './AttentionTimeline.jsx';
import { EvidencePanel } from './EvidencePanel.jsx';
import { LayerTracePanel } from './LayerTracePanel.jsx';
import { FirewallPanel } from './FirewallPanel.jsx';
import { AffectPanel } from './AffectPanel.jsx';
import { SolitonFieldPanel } from './SolitonFieldPanel.jsx';
import { TechnicalDetails } from './TechnicalDetails.jsx';
import { InputFusionPanel } from './InputFusionPanel.jsx';
import { ResultFeedback } from './ResultFeedback.jsx';
import { CreativeNeuralReadout } from './CreativeNeuralReadout.jsx';
import { track } from '../../lib/analytics.js';

const RESULT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'lines', label: 'Line-by-line' },
  { id: 'audience', label: 'Audience' },
  { id: 'advanced', label: 'Advanced' },
];

function ResultsTabs({ active, onChange }) {
  const listRef = useRef(null);

  function handleKeyDown(event) {
    const index = RESULT_TABS.findIndex((tab) => tab.id === active);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % RESULT_TABS.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + RESULT_TABS.length) % RESULT_TABS.length;
    if (next === -1) return;
    event.preventDefault();
    onChange(RESULT_TABS[next].id);
    listRef.current?.querySelectorAll('[role="tab"]')[next]?.focus();
  }

  return (
    <div className="results-tabs" role="tablist" aria-label="Scan result sections" ref={listRef} onKeyDown={handleKeyDown}>
      {RESULT_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`results-tab-${tab.id}`}
          aria-selected={active === tab.id}
          aria-controls={`results-panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          className={active === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.id === 'advanced' ? <span className="results-tab-flag">research</span> : null}
        </button>
      ))}
    </div>
  );
}

function TabPanel({ id, active, children }) {
  if (id !== active) return null;
  return (
    <div id={`results-panel-${id}`} role="tabpanel" aria-labelledby={`results-tab-${id}`} className="results-tab-panel">
      {children}
    </div>
  );
}

export function ResultsWorkspace({ result, media, onImprove, onSave, onQueue, onExport, onOpenResearch }) {
  const verdict = deriveExecutiveVerdict(result);
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('overview');
  const isVideoReadout = result?.contentType === 'video' && Boolean(result?.multimodal);

  function selectTab(next) {
    setTab(next);
    track('result_section_viewed', { section: next, isFallback: Boolean(result.isFallback) });
    if (next === 'advanced') track('layer_trace_viewed');
  }

  function handleSave() {
    const record = onSave(result);
    setStatus(record ? 'Saved to local history.' : 'Could not save this scan.');
  }

  return (
    <div className="results-workbench" data-testid="results-workspace">
      <main className="results-main" aria-label="Brain Scan results">
        {isVideoReadout ? (
          <CreativeNeuralReadout
            result={result}
            media={media}
            onCompare={onImprove}
            onExport={onExport}
          />
        ) : (
          <ExecutiveVerdict result={result} />
        )}
        <ResultsTabs active={tab} onChange={selectTab} />
        <TabPanel id="overview" active={tab}>
          {!isVideoReadout ? <InputFusionPanel result={result} /> : null}
          {!isVideoReadout ? <BrainSignalView result={result} /> : null}
          <DecisionScorecard result={result} />
          {isVideoReadout ? <InputFusionPanel result={result} /> : null}
        </TabPanel>
        <TabPanel id="lines" active={tab}>
          <ContentHeatmap result={result} />
          <EvidencePanel result={result} />
          <AttentionTimeline result={result} />
        </TabPanel>
        <TabPanel id="audience" active={tab}>
          <AffectPanel result={result} />
          <FirewallPanel result={result} />
        </TabPanel>
        <TabPanel id="advanced" active={tab}>
          <LayerTracePanel result={result} />
          <SolitonFieldPanel result={result} />
          <TechnicalDetails result={result} onOpenResearch={onOpenResearch || (() => {})} />
        </TabPanel>
      </main>
      <aside className="results-inspector" aria-label="Recommended next actions">
        <Badge tone={result.isFallback ? 'warning' : 'cyan'}>{result.isFallback ? 'Deterministic local result' : 'AI-estimated response'}</Badge>
        <div className="inspector-score">
          <strong>{verdict.score}</strong>
          <span>Decision score</span>
        </div>
        <div className="inspector-callout inspector-viral">
          <span>Viral pull</span>
          <strong>{verdict.viralScore} — {verdict.viralLabel}</strong>
        </div>
        <div className="inspector-callout">
          <span>Primary risk</span>
          <strong>{verdict.primaryRisk}</strong>
        </div>
        <div className="inspector-callout">
          <span>Best next action</span>
          <p>{verdict.bestNextMove}</p>
        </div>
        <div className="inspector-actions">
          <Button variant="primary" onClick={() => onImprove(result)}><Sparkles size={16} aria-hidden="true" /> Improve This</Button>
          <Button variant="secondary" onClick={() => onImprove(result)}><GitCompare size={16} aria-hidden="true" /> Compare Version</Button>
          <Button variant="ghost" onClick={handleSave}><Save size={16} aria-hidden="true" /> Save to History</Button>
          <Button variant="ghost" onClick={() => onQueue(result)}><Send size={16} aria-hidden="true" /> Add to Approvals</Button>
          <Button variant="secondary" onClick={() => onExport(result)}><Share2 size={16} aria-hidden="true" /> Share your score</Button>
          <Button variant="ghost" onClick={() => onExport(result)}><Download size={16} aria-hidden="true" /> Export</Button>
        </div>
        {status ? <p role="status" className="bsn-note results-action-status">{status}</p> : null}
        <ResultFeedback key={result.id || result.timestamp} result={result} />
      </aside>
    </div>
  );
}
