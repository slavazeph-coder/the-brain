import React from 'react';
import { Download, GitCompare, Save, Send, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { deriveExecutiveVerdict } from '../../lib/scoreMapping.js';
import { ExecutiveVerdict } from './ExecutiveVerdict.jsx';
import { BrainVisualizer } from './BrainVisualizer.jsx';
import { DecisionScorecard } from './DecisionScorecard.jsx';
import { ContentHeatmap } from './ContentHeatmap.jsx';
import { AttentionTimeline } from './AttentionTimeline.jsx';
import { EvidencePanel } from './EvidencePanel.jsx';
import { LayerTracePanel } from './LayerTracePanel.jsx';
import { TechnicalDetails } from './TechnicalDetails.jsx';

export function ResultsWorkspace({ result, onImprove, onSave, onQueue, onExport, onOpenResearch }) {
  const verdict = deriveExecutiveVerdict(result);
  return (
    <div className="results-workbench" data-testid="results-workspace">
      <main className="results-main" aria-label="Brain Scan results">
        <ExecutiveVerdict result={result} />
        <BrainVisualizer result={result} />
        <ContentHeatmap result={result} />
        <AttentionTimeline result={result} />
        <EvidencePanel result={result} />
        <DecisionScorecard result={result} />
        <LayerTracePanel result={result} />
        <TechnicalDetails result={result} onOpenResearch={onOpenResearch || (() => {})} />
      </main>
      <aside className="results-inspector" aria-label="Recommended next actions">
        <Badge tone={result.isFallback ? 'warning' : 'cyan'}>{result.isFallback ? 'Demo model result' : 'AI-estimated response'}</Badge>
        <div className="inspector-score">
          <strong>{verdict.score}</strong>
          <span>Decision score</span>
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
          <Button variant="ghost" onClick={() => onSave(result)}><Save size={16} aria-hidden="true" /> Save to Memory</Button>
          <Button variant="ghost" onClick={() => onQueue(result)}><Send size={16} aria-hidden="true" /> Add to Queue</Button>
          <Button variant="ghost" onClick={() => onExport(result)}><Download size={16} aria-hidden="true" /> Export</Button>
        </div>
      </aside>
    </div>
  );
}
