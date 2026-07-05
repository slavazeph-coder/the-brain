import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, FileJson, FileText, Link2, Share2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { track } from '../../lib/analytics.js';
import { deriveExecutiveVerdict, getBusinessMetrics } from '../../lib/scoreMapping.js';
import { ExportCard } from './ExportCard.jsx';
import { SharePreview } from './SharePreview.jsx';
import { downloadBlob, renderScoreCardBlob, shareScoreCard } from './scoreCard.js';

function download(filename, blob) {
  downloadBlob(filename, blob);
}

export function ShareDialog({ open, onClose, result }) {
  const [manualCopy, setManualCopy] = useState('');
  const [status, setStatus] = useState('');
  const verdict = result ? deriveExecutiveVerdict(result) : null;
  const shareText = useMemo(() => {
    if (!result || !verdict) return '';
    const metricMap = Object.fromEntries(getBusinessMetrics(result).map((metric) => [metric.id, metric.value]));
    return `BRAIN SCAN\n"${verdict.headline}"\n\nHook Strength: ${metricMap.hookStrength}\nTrust: ${metricMap.trust}\nViral Pull: ${verdict.viralScore}\nManipulation Risk: ${metricMap.manipulationRisk}\n\nAI-estimated content response from BrainSNN — scan yours free at brainsnn.com`;
  }, [result, verdict]);

  useEffect(() => {
    if (!open) return;
    setManualCopy('');
    setStatus('');
  }, [open, result?.id]);

  if (!result) return null;

  async function copyText(text, eventName) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied to clipboard.');
      track(eventName);
    } catch {
      setManualCopy(text);
      setStatus('Clipboard unavailable. Select and copy the text below.');
    }
  }

  function exportReport() {
    download('brainsnn-report.txt', new Blob([`${shareText}\n\nSummary:\n${result.summary}\n\nOriginal:\n${result.rawContent}`], { type: 'text/plain;charset=utf-8' }));
    setStatus('Plain-text report downloaded.');
    track('export_downloaded', { type: 'txt' });
  }

  function exportJson() {
    download('brainsnn-result.json', new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    setStatus('JSON export downloaded.');
    track('export_downloaded', { type: 'json' });
  }

  return (
    <Modal open={open} onClose={onClose} title="Share / Export">
      <div className="share-dialog-grid" data-testid="export-dialog">
        <SharePreview result={result} />
        <div className="export-actions-list">
          <ExportCard
            icon={Share2}
            title="Share your score"
            description="Branded score card with decision score, viral pull and the brain snapshot."
            actionLabel={typeof navigator !== 'undefined' && navigator.canShare ? 'Share' : 'Download'}
            onAction={async () => {
              try {
                const { method } = await shareScoreCard(result);
                if (method === 'shared') {
                  setStatus('Score card shared.');
                  track('share_card_shared');
                } else if (method === 'downloaded') {
                  setStatus('Score card downloaded — post it anywhere.');
                  track('share_card_downloaded');
                }
              } catch (error) {
                setStatus(error.message || 'Score card could not be generated.');
              }
            }}
          />
          <ExportCard icon={Copy} title="Copy summary" description="Short result summary for docs, Slack or client notes." actionLabel="Copy" onAction={() => copyText(shareText, 'share_text_copied')} />
          <ExportCard icon={Download} title="Download PNG" description="The same score card as a plain PNG download." actionLabel="Download" onAction={async () => {
            try {
              download('brainsnn-brain-scan.png', await renderScoreCardBlob(result));
              setStatus('PNG downloaded.');
              track('export_downloaded', { type: 'png' });
            } catch (error) {
              setStatus(error.message || 'PNG export failed.');
            }
          }} />
          <ExportCard icon={FileText} title="Export report" description="Plain-text report with summary and original content." actionLabel="Export" onAction={exportReport} />
          <ExportCard icon={FileJson} title="Export JSON" description="Technical result payload for debugging or future import." actionLabel="Export" onAction={exportJson} />
          <ExportCard icon={Link2} title="Copy public result link" description="Coming soon. Public links need persisted scans before they can resolve." actionLabel="Coming soon" disabled />
          {status ? <p role="status" className="bsn-note">{status}</p> : null}
          {manualCopy ? (
            <label className="manual-copy">
              Manual copy
              <textarea readOnly value={manualCopy} onFocus={(event) => event.target.select()} />
            </label>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
