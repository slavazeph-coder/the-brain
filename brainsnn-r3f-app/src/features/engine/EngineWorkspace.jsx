import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Download, FlaskConical } from 'lucide-react';
import './engine-workspace.css';

const MAX_CHARS = 8000;
const SAMPLE = {
  original: 'Act now! This guaranteed solution will change everything. Everyone knows it is the only choice.',
  candidate: 'This is a proposed solution. Review the source material, compare alternatives, and test it on your own task before deciding.',
};
const signed = (value) => `${value > 0 ? '+' : ''}${value}`;
const checkNames = { 'trust-regression': 'Trust signal does not drop', 'pressure-regression': 'Pressure signal does not increase' };
const apiExample = `curl https://www.brainsnn.com/api/engine/compare \\
  -H 'Content-Type: application/json' \\
  -d '{"original":"Act now! Guaranteed results.","candidate":"Review the evidence before deciding."}'`;

function TextEvidence({ label, item }) {
  return <details className="ew-evidence">
    <summary>{label} text, hash and source signals</summary>
    <p className="ew-hash"><strong>SHA-256</strong> <code>{item.sha256}</code></p>
    <p className="ew-caption">Exact submitted text</p><pre className="ew-source">{item.content}</pre>
    <p className="ew-caption">Offsets are zero-based UTF-16 positions; the end is exclusive. A matched phrase explains a heuristic signal and does not verify a claim.</p>
    {item.findings.length ? <ol className="ew-findings">{item.findings.map((finding, index) => <li key={`${finding.start}-${index}`}>
      <div><strong>{finding.signal}</strong><code>[{finding.start}, {finding.end})</code></div>
      <blockquote>{finding.quotation}</blockquote><p>{finding.explanation}</p>
    </li>)}</ol> : <p>No source signals were returned. This is not a factual clearance.</p>}
    {item.findingsTruncated && <p>Signal excerpts are capped. Inspect the exact text above for the full context.</p>}
  </details>;
}

function ComparisonResult({ record }) {
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${record.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <section className="ew-result" aria-labelledby="ew-result-title">
    <div className="ew-section-heading"><div><p className="ew-eyebrow">COMPARISON RECORD</p><h2 id="ew-result-title">Review required.</h2></div><span className="ew-tag">{record.signalsWithinLimits ? 'Signals within limits' : 'Signal regression detected'}</span></div>
    <p className="ew-muted">{record.boundary}</p>
    {!record.inputChanged && <p className="ew-notice">The two texts are identical. This records a baseline, not an improvement.</p>}
    <div className="ew-table-wrap"><table><caption>Measured heuristic signals · candidate minus original</caption><thead><tr><th scope="col">Signal</th><th scope="col">Original</th><th scope="col">Candidate</th><th scope="col">Change</th></tr></thead><tbody>
      <tr><th scope="row">Trust <small>0–100</small></th><td>{record.original.signals.trust}</td><td>{record.candidate.signals.trust}</td><td>{signed(record.delta.trust)}</td></tr>
      <tr><th scope="row">Manipulation pressure <small>0–1</small></th><td>{record.original.signals.manipulationPressure}</td><td>{record.candidate.signals.manipulationPressure}</td><td>{signed(record.delta.manipulationPressure)}</td></tr>
    </tbody></table></div>
    <ul className="ew-checks">{record.checks.map((check) => <li key={check.id}><span>{checkNames[check.id] || check.id}</span><strong>{check.passed ? 'Within limit' : 'Outside limit'}</strong></li>)}</ul>
    <p className="ew-caption">Default limits: no trust decrease and no pressure increase. Passing these checks does not approve work or promote context.</p>
    <TextEvidence label="Original" item={record.original}/><TextEvidence label="Candidate" item={record.candidate}/>
    <div className="ew-record-footer"><p className="ew-caption">{record.schemaVersion}<br/>{record.execution.durationMs} ms · {record.execution.providerCalls} provider calls · {record.execution.providerTokens} provider tokens<br/><time dateTime={record.generatedAt}>{record.generatedAt}</time></p><button type="button" className="ew-secondary" onClick={download}><Download size={16} aria-hidden="true"/>Download review JSON</button></div>
    <p className="ew-caption">The download includes both exact texts, source signals, hashes, engine revision when available, checks and evidence boundaries.</p>
  </section>;
}

export function EngineWorkspace() {
  const [inputs, setInputs] = useState({ original: '', candidate: '' });
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Enter two texts to create a comparison record.');
  const request = useRef({ sequence: 0, controller: null });
  useEffect(() => { document.title = 'Compare two drafts | BrainSNN Engine'; }, []);
  useEffect(() => () => { request.current.sequence += 1; request.current.controller?.abort(); }, []);

  function change(next, message = 'Inputs changed. Run a new comparison to review these texts.') {
    request.current.sequence += 1;
    request.current.controller?.abort();
    setInputs(next); setRecord(null); setBusy(false); setError(''); setStatus(message);
  }

  async function compare(event) {
    event.preventDefault();
    if (!inputs.original.trim() || !inputs.candidate.trim()) {
      setError('Enter non-empty text in both fields.'); return;
    }
    const sequence = ++request.current.sequence;
    const controller = new AbortController();
    request.current.controller?.abort(); request.current.controller = controller;
    setBusy(true); setRecord(null); setError(''); setStatus('Comparing both texts with the same heuristic engine…');
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/engine/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inputs), signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 429 ? 'Too many requests. Wait a moment, then try again.' : 'The comparison could not be completed. Please try again.');
      const next = await response.json();
      if (next.schemaVersion !== 'brainsnn.engine-comparison.v1' || next.decision !== 'REVIEW_REQUIRED' || next.original?.content !== inputs.original || next.candidate?.content !== inputs.candidate || !Array.isArray(next.checks) || !Array.isArray(next.original?.findings) || !Array.isArray(next.candidate?.findings)) throw new Error('The engine returned an unexpected record. Please try again.');
      if (request.current.sequence !== sequence) return;
      setRecord(next); setStatus('Comparison complete. Independent review is still required.');
    } catch (failure) {
      if (request.current.sequence !== sequence) return;
      setError(failure.name === 'AbortError' ? 'The comparison timed out. Please try again.' : failure.message);
      setStatus('No comparison record is available for these inputs.');
    } finally {
      clearTimeout(timeout);
      if (request.current.sequence === sequence) setBusy(false);
    }
  }

  return <div className="ew-site" data-build-marker="brainsnn-engine-workspace">
    <a className="ew-skip" href="#ew-main">Skip to content</a>
    <header className="ew-header"><a className="ew-brand" href="/" aria-label="BrainSNN home"><FlaskConical size={22} aria-hidden="true"/>BrainSNN <span>/ engine</span></a><nav aria-label="Engine navigation"><a href="/"><ArrowLeft size={15} aria-hidden="true"/>Home</a><a href="/app">Analysis workspace<ArrowUpRight size={15} aria-hidden="true"/></a></nav></header>
    <main id="ew-main">
      <section className="ew-intro"><p className="ew-eyebrow">NATIVE ENGINE · DETERMINISTIC COMPARISON</p><h1>Test the edit.<br/><span>Inspect the evidence.</span></h1><p>Compare an original and a candidate with the same BrainSNN scorer. See what changed, inspect the source signals, and take a review record into your next decision.</p><div className="ew-intro-tags"><span>Same scorer</span><span>Exact text hashes</span><span>Review required</span></div></section>
      <form className="ew-form" onSubmit={compare} aria-labelledby="ew-input-title" noValidate>
        <div className="ew-section-heading"><h2 id="ew-input-title">Two texts. One test.</h2><button className="ew-secondary" type="button" onClick={() => change(SAMPLE, 'Illustrative sample loaded. Run comparison to measure its signals.')}>Load illustrative sample</button></div>
        <p id="ew-privacy" className="ew-muted">Running a comparison sends both texts to BrainSNN. The server processes them without model calls and does not persist the comparison. This is not an offline browser tool. The page keeps the result only until you edit or leave.</p>
        <div className="ew-input-grid">{['original', 'candidate'].map((key) => <div key={key}><div className="ew-input-label"><label htmlFor={`ew-${key}`}>{key === 'original' ? 'Original text' : 'Candidate text'}</label><span id={`ew-${key}-count`}>{inputs[key].length.toLocaleString()} / 8,000</span></div><textarea id={`ew-${key}`} value={inputs[key]} maxLength={MAX_CHARS} rows={9} required aria-describedby={`ew-${key}-count ew-privacy`} placeholder={key === 'original' ? 'Paste the text you are starting from…' : 'Paste the version you want to test…'} onChange={(event) => change({ ...inputs, [key]: event.target.value })}/></div>)}</div>
        <div className="ew-run-row"><button className="ew-primary" type="submit" disabled={busy}>{busy ? 'Comparing…' : 'Run comparison'}<ArrowUpRight size={17} aria-hidden="true"/></button><p role="status" aria-live="polite">{status}</p></div>
        {error && <p className="ew-error" role="alert">{error}</p>}
      </form>
      {record && <ComparisonResult record={record}/>}
      <section id="api" className="ew-api" aria-labelledby="ew-api-title"><p className="ew-eyebrow">FOR AGENT BUILDERS</p><h2 id="ew-api-title">Use the same engine over HTTP.</h2><p>Send a JSON object with <code>original</code> and <code>candidate</code> strings, each 1–8,000 characters of non-empty text. The public endpoint requires no API key and is rate limited.</p><pre><code>{apiExample}</code></pre><p>Optional <code>limits</code>: <code>maxTrustDrop</code> (0–100) and <code>maxPressureIncrease</code> (0–1), both defaulting to 0. The response includes <code>original</code>, <code>candidate</code>, <code>delta</code>, <code>checks</code>, exact hashes and <code>decision: "REVIEW_REQUIRED"</code>.</p><p>For local agent integrations, the repository’s stdio MCP server exposes <code>brain_compare</code> and <code>brain_promotion_check</code>. <a href="https://github.com/slavazeph-coder/the-brain/blob/main/brainsnn-r3f-app/docs/engine.md#mcp">Read the MCP setup and contract</a>.</p><p className="ew-muted">Use the record as input to an independent review or a task-specific test. Heuristic scores cannot certify factual accuracy, market demand, neural response or accepted work.</p></section>
    </main><footer className="ew-footer"><span>BrainSNN · AI work that earns its keep.</span><a href="/evidence">Inspect the benchmark<ArrowUpRight size={14} aria-hidden="true"/></a></footer>
  </div>;
}
