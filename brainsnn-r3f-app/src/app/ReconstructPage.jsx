import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Code2,
  FileCode2,
  FileSearch,
  Github,
  Layers3,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { track } from '../lib/analytics.js';

const GITHUB_URL = 'https://github.com/XioAISolutions/Reconstruct';
const GRAB_COMMAND = `npm run reconstruct -- grab https://example.com \\
  --max-pages 12 \\
  --max-depth 2 \\
  --target codex \\
  --out ./.reconstruct/example`;

const SCANNER_PREFILL = `Reconstruct is the proof-first website and app code grabber for AI coding agents. It captures authorized public web UI, turns it into AppSpec evidence and build packs, then scores the rebuilt app with replay checks and correction briefs.`;

const FLOW = [
  {
    icon: FileSearch,
    title: 'Capture what the browser proves',
    text: 'Bounded crawl, route graph, screenshots, DOM facts and integrity manifests from public pages you own or are authorized to inspect.',
  },
  {
    icon: FileCode2,
    title: 'Write the rebuild contract',
    text: 'The output is an AppSpec with page structure, states, assets, evidence references and a clear handoff for coding agents.',
  },
  {
    icon: Code2,
    title: 'Pack it for agents',
    text: 'Generate Codex, Claude, Cursor or Markdown build packs so the next agent starts with evidence instead of a vague prompt.',
  },
  {
    icon: ShieldCheck,
    title: 'Replay before you ship',
    text: 'Evaluate the candidate build, compare behavior against the evidence and produce a correction brief when it drifts.',
  },
];

const OUTPUTS = ['appspec.json', 'GRAB_BRIEF.md', 'evidence/manifest.json', 'build-packs/codex'];

export function ReconstructPage({ onHome, onStart }) {
  const [copied, setCopied] = useState(false);
  const outputRows = useMemo(() => OUTPUTS, []);

  useEffect(() => {
    document.title = 'Reconstruct | Proof-first site grabber for AI agents';
    track('reconstruct_page_viewed');
  }, []);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(GRAB_COMMAND);
      setCopied(true);
      track('reconstruct_command_copied');
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  function openScanner() {
    track('reconstruct_scan_copy_clicked');
    onStart(SCANNER_PREFILL);
  }

  return (
    <div className="reconstruct-shell">
      <header className="reconstruct-nav" aria-label="Reconstruct navigation">
        <button type="button" className="reconstruct-brand" onClick={onHome} aria-label="Back to BrainSNN home">
          <span className="landing-mark">SNN</span>
          <span>
            <strong>BrainSNN.com</strong>
            <small>Reconstruct lab</small>
          </span>
        </button>
        <div className="reconstruct-nav-actions">
          <button type="button" className="reconstruct-text-link" onClick={onHome}>
            <ArrowLeft size={16} aria-hidden="true" />
            BrainSNN
          </button>
          <a className="reconstruct-text-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <Github size={16} aria-hidden="true" />
            GitHub
          </a>
        </div>
      </header>

      <main className="reconstruct-main" data-testid="reconstruct-page" data-build-marker="reconstruct-grab-page">
        <section className="reconstruct-hero" aria-labelledby="reconstruct-heading">
          <div className="reconstruct-copy">
            <div className="reconstruct-pill">
              <Sparkles size={18} aria-hidden="true" />
              Proof-first code grabber for AI agents
            </div>
            <h1 id="reconstruct-heading">Grab the site. Ship the proof.</h1>
            <p>
              Reconstruct turns an authorized public web app into evidence, AppSpec, agent build packs,
              replay checks and correction briefs. It is the serious developer name; the viral verb is
              simple: grab.
            </p>
            <div className="reconstruct-actions">
              <Button variant="primary" onClick={copyCommand}>
                <Clipboard size={17} aria-hidden="true" />
                {copied ? 'Command copied' : 'Copy grab command'}
              </Button>
              <a className="bsn-button bsn-button-secondary reconstruct-button-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Github size={17} aria-hidden="true" />
                Open GitHub
              </a>
              <Button variant="ghost" onClick={openScanner}>
                Scan this pitch <ArrowRight size={17} aria-hidden="true" />
              </Button>
            </div>
            <div className="reconstruct-proof-strip" aria-label="Reconstruct artifact highlights">
              <span><CheckCircle2 size={16} aria-hidden="true" /> AppSpec</span>
              <span><CheckCircle2 size={16} aria-hidden="true" /> Evidence</span>
              <span><CheckCircle2 size={16} aria-hidden="true" /> Build packs</span>
              <span><CheckCircle2 size={16} aria-hidden="true" /> Replay checks</span>
            </div>
          </div>

          <aside className="reconstruct-console" aria-label="Reconstruct grab command preview">
            <div className="reconstruct-console-top">
              <span><Terminal size={16} aria-hidden="true" /> terminal</span>
              <strong>authorized target only</strong>
            </div>
            <pre>{GRAB_COMMAND}</pre>
            <div className="reconstruct-output" aria-label="Generated output files">
              {outputRows.map((row) => (
                <span key={row}>{row}</span>
              ))}
            </div>
          </aside>
        </section>

        <section className="reconstruct-visual-band" aria-label="Reconstruct artifact map">
          <div className="reconstruct-proof-map">
            <div>
              <span>input</span>
              <strong>public URL</strong>
            </div>
            <div>
              <span>contract</span>
              <strong>AppSpec</strong>
            </div>
            <div>
              <span>agent</span>
              <strong>build pack</strong>
            </div>
            <div>
              <span>gate</span>
              <strong>replay score</strong>
            </div>
          </div>
        </section>

        <section className="reconstruct-flow" aria-labelledby="reconstruct-flow-heading">
          <div className="reconstruct-section-head">
            <p className="bsn-eyebrow">How it wins</p>
            <h2 id="reconstruct-flow-heading">Prompt less. Prove more.</h2>
            <p>Everything in the workflow is designed to make a rebuild auditable before another agent writes code.</p>
          </div>
          <div className="reconstruct-flow-grid">
            {FLOW.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title}>
                  <Icon size={24} aria-hidden="true" />
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="reconstruct-boundary" aria-labelledby="reconstruct-boundary-heading">
          <div>
            <p className="bsn-eyebrow">Safety boundary</p>
            <h2 id="reconstruct-boundary-heading">Not a source-code theft tool.</h2>
            <p>
              Reconstruct captures observable browser evidence and rejects hidden backend inference, auth bypass,
              arbitrary form submission and private app scraping. The point is fast authorized reconstruction with receipts.
            </p>
          </div>
          <div className="reconstruct-boundary-list" aria-label="Reconstruct boundaries">
            <span><ShieldCheck size={16} aria-hidden="true" /> Public pages and owned apps</span>
            <span><Zap size={16} aria-hidden="true" /> Bounded crawl depth</span>
            <span><Layers3 size={16} aria-hidden="true" /> Content-addressed evidence</span>
            <span><Play size={16} aria-hidden="true" /> Replay-based acceptance</span>
          </div>
        </section>
      </main>
    </div>
  );
}
