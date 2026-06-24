import React, { useMemo, useState } from 'react';
import { Copy, Download, FileJson, FileText, Link2 } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { track } from '../../lib/analytics.js';
import { deriveExecutiveVerdict, getBusinessMetrics } from '../../lib/scoreMapping.js';
import { ExportCard } from './ExportCard.jsx';
import { SharePreview } from './SharePreview.jsx';

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function downloadPng(result) {
  const verdict = deriveExecutiveVerdict(result);
  const metricMap = Object.fromEntries(getBusinessMetrics(result).map((metric) => [metric.id, metric.value]));
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#06060a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createRadialGradient(260, 140, 0, 260, 140, 520);
  gradient.addColorStop(0, 'rgba(0,245,255,0.32)');
  gradient.addColorStop(1, 'rgba(168,85,247,0.02)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#00f5ff';
  ctx.font = '700 28px JetBrains Mono, monospace';
  ctx.fillText('BRAIN SCAN', 72, 88);
  ctx.fillStyle = '#f1f1f6';
  ctx.font = '700 72px Space Grotesk, Inter, sans-serif';
  const headline = verdict.headline;
  ctx.fillText(headline.slice(0, 25), 72, 210);
  if (headline.length > 25) ctx.fillText(headline.slice(25, 52), 72, 290);
  ctx.fillStyle = '#9aa0b4';
  ctx.font = '28px Inter, sans-serif';
  ctx.fillText('AI-estimated content response', 72, 350);
  const rows = [
    ['Hook Strength', metricMap.hookStrength],
    ['Trust', metricMap.trust],
    ['Manipulation Risk', metricMap.manipulationRisk],
  ];
  rows.forEach(([label, value], index) => {
    const y = 430 + index * 56;
    ctx.fillStyle = '#9aa0b4';
    ctx.fillText(label, 72, y);
    ctx.fillStyle = index === 2 ? '#ef4444' : '#00f5ff';
    ctx.font = '700 34px JetBrains Mono, monospace';
    ctx.fillText(String(value), 420, y);
    ctx.font = '28px Inter, sans-serif';
  });
  ctx.fillStyle = '#f1f1f6';
  ctx.font = '700 30px Inter, sans-serif';
  ctx.fillText('brainsnn.com', 900, 560);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  download('brainsnn-brain-scan.png', blob);
}

export function ShareDialog({ open, onClose, result }) {
  const [manualCopy, setManualCopy] = useState('');
  const [status, setStatus] = useState('');
  const verdict = result ? deriveExecutiveVerdict(result) : null;
  const shareText = useMemo(() => {
    if (!result || !verdict) return '';
    const metricMap = Object.fromEntries(getBusinessMetrics(result).map((metric) => [metric.id, metric.value]));
    return `BRAIN SCAN\n"${verdict.headline}"\n\nHook Strength: ${metricMap.hookStrength}\nTrust: ${metricMap.trust}\nManipulation Risk: ${metricMap.manipulationRisk}\n\nAI-estimated content response from BrainSNN.`;
  }, [result, verdict]);

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
  }

  function exportJson() {
    download('brainsnn-result.json', new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Share / Export">
      <div className="share-dialog-grid" data-testid="export-dialog">
        <SharePreview result={result} />
        <div className="export-actions-list">
          <ExportCard icon={Copy} title="Copy summary" description="Short result summary for docs, Slack or client notes." actionLabel="Copy" onAction={() => copyText(shareText, 'share_text_copied')} />
          <ExportCard icon={Download} title="Download PNG" description="Readable NeuroGlow social image with BrainSNN watermark." actionLabel="Download" onAction={async () => { await downloadPng(result); track('export_downloaded', { type: 'png' }); }} />
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
