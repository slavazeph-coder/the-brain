import React, { useEffect, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BrainCircuit, Check, ChevronLeft, ChevronRight,
  FilePenLine, FlaskConical, GitBranch, Layers3, Pause, Play, Radio, RefreshCw, ShieldCheck,
} from 'lucide-react';
import {
  EVIDENCE_METRICS, LAB_DESCRIPTION, LAB_TITLE, SETUP_DAY_URL, WORK_STAGES,
  eventStatusLabel, formatCount, formatRecordTime,
} from './agentLabModel.js';
import { useLabSummary } from './useLabSummary.js';
import './agent-lab.css';

const CAPABILITIES = [
  {
    id: 'analyze', number: '01', label: 'Analyze', short: 'Content and evidence', icon: GitBranch,
    tag: 'Available', outcome: 'Find the claim behind the signal.',
    description: 'Inspect text, page copy or a screen recording for attention, trust, risk and evidence gaps. Follow a finding back to the passage or timestamp that prompted it.',
    detailLabel: 'WHAT YOU CAN INSPECT',
    detail: 'Content scores and visual-change cues support review. They do not measure a reader’s brain or identify actions in a video.', href: '/app', link: 'Open the analyzer',
  },
  {
    id: 'improve', number: '02', label: 'Improve', short: 'Edits you can review', icon: FilePenLine,
    tag: 'Available after a scan', outcome: 'Turn a finding into a specific edit.',
    description: 'Choose a goal, inspect proposed fixes, and apply or undo edits. Compare the revised draft with the original and save a version worth testing.',
    detailLabel: 'YOUR NEXT STEP',
    detail: 'Run a scan in the workspace, then open Improve. A better model score is a candidate improvement; an independent test still has to establish the result.', href: '/app', link: 'Start with a scan',
  },
  {
    id: 'test', number: '03', label: 'Test', short: 'Proof missions', icon: FlaskConical,
    tag: 'Available', outcome: 'Give a decision a measurable test.',
    description: 'Choose a bounded mission with an objective, permitted actions and a judge. Inspect the attempt and the conditions under which its result was recorded.',
    detailLabel: 'EVIDENCE BOUNDARY',
    detail: 'A benchmark or simulated result applies to its tested environment. It does not establish customer demand or real-world performance by itself.', href: '/missions', link: 'Explore proof missions',
  },
  {
    id: 'memory', number: '04', label: 'Memory', short: 'Scans and versions', icon: Layers3,
    tag: 'Available in this browser', outcome: 'Keep the evidence behind an edit.',
    description: 'Save scans and draft versions in the workspace. Reopen an earlier result or duplicate it to begin another comparison.',
    detailLabel: 'CURRENT SCOPE',
    detail: 'This is browser-local history. Shared, reusable context with independent promotion tests is the next engine step.', href: '/app', link: 'Open the workspace',
  },
];

function Brand() {
  return <a className="al-brand" href="/" aria-label="BrainSNN home">
    <span className="al-brand-mark"><BrainCircuit size={24} strokeWidth={1.6} aria-hidden="true" /></span>
    <span>Brain<span className="al-brand-light">SNN</span><small>THE EVIDENCE ENGINE</small></span>
  </a>;
}

function OfficeDiagram() {
  return <svg className="al-office-diagram" viewBox="0 0 560 330" role="img" aria-label="Engine concept: analysis and improvement connect through context, tests and review. This illustration does not represent live activity or an implemented autonomous loop.">
    <defs>
      <pattern id="al-floor-grid" width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M28 0H0V28" fill="none" stroke="#41606a" strokeWidth=".7" />
      </pattern>
      <linearGradient id="al-glass" x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#376574" stopOpacity=".3" /><stop offset="1" stopColor="#1a343e" stopOpacity=".08" />
      </linearGradient>
      <linearGradient id="al-floor" x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#16282e" /><stop offset="1" stopColor="#0b151a" />
      </linearGradient>
    </defs>
    <path d="M42 180 280 52 518 180 280 308Z" fill="url(#al-floor)" stroke="#3e5962" />
    <g transform="matrix(1 .54 -1 .54 280 52)" opacity=".5"><rect width="238" height="238" fill="url(#al-floor-grid)" /></g>
    <path d="m42 180 238 128 238-128v10L280 318 42 190Z" fill="#14242a" stroke="#2b434c" />
    <g fill="url(#al-glass)" stroke="#58737d" strokeWidth="1">
      <path d="m76 162 83-45 77 41-84 46Z" /><path d="M76 162v-40l83-45v40m0-40 77 41v40M76 122l76 41v41m0-41 84-45" />
      <path d="m324 158 77-41 83 45-76 42Z" /><path d="M324 158v-40l77-41v40m0-40 83 45v40m-160-44 84 45v41m0-41 76-41" />
    </g>
    <g fill="#28434b" stroke="#617e86" strokeWidth=".8">
      <path d="m116 135 30-16 33 18-30 16Z" /><path d="m170 145 24-13 28 15-24 13Z" />
      <path d="m357 137 30-16 33 18-30 16Z" /><path d="m411 147 24-13 28 15-24 13Z" />
    </g>
    <g fill="#9bdae1" opacity=".8"><path d="M138 126v-15l17 9v15Z" /><path d="M379 127v-15l17 9v15Z" /></g>
    <g fill="none" stroke="#81d9df" strokeWidth="1.2">
      <path d="m152 208 53 29 75-40 74 40 54-29" strokeDasharray="4 5" />
      <path d="M280 205v40" /><path d="m276 238 4 7 4-7" />
    </g>
    <path d="m243 181 37-20 37 20-37 20Z" fill="#2b5d68" stroke="#86e7e7" />
    <path d="m243 181 37 20 37-20v15l-37 20-37-20Z" fill="#17434e" stroke="#76bbc5" />
    <path d="m251 173 29-16 29 16-29 16Z" fill="#355f6b" stroke="#99eef0" />
    <circle cx="280" cy="172" r="3" fill="#b0f4f3" />
    <g fill="#d2e2e8" fontSize="10" fontFamily="Inter, sans-serif" letterSpacing="1">
      <text x="118" y="81">ANALYZE</text><text x="373" y="81">IMPROVE</text>
      <text x="280" y="141" textAnchor="middle" fill="#9ce7e9">CONTEXT</text>
      <text x="280" y="266" textAnchor="middle">TEST + REVIEW</text>
    </g>
    <g fill="#7a9aa6"><circle cx="159" cy="91" r="2" /><circle cx="401" cy="91" r="2" /></g>
  </svg>;
}

function OfficePreview() {
  return <aside className="al-office-preview" aria-label="Agent office design">
    <div className="al-panel-top"><span><span className="al-square" /> THE OFFICE</span><span className="al-tag">Engine concept</span></div>
    <div className="al-office-caption"><h2>A window into<br />the work.</h2><span className="al-coordinate" aria-hidden="true">BRAINSNN<br />CONTEXT → TEST</span></div>
    <OfficeDiagram />
    <div className="al-office-foot"><span><ShieldCheck size={15} aria-hidden="true" /> Illustrated workflow · no live worker activity</span><a href="#office">Inspect an operational example <ArrowUpRight size={12} aria-hidden="true" /></a></div>
  </aside>;
}

function EngineWorkflow() {
  return <section className="al-engine-workflow" aria-label="Available BrainSNN workflow">
    <div><span className="al-eyebrow">START WITH YOUR OWN CONTENT</span><p>A practical path through the engine</p></div>
    <ol><li><span>01</span><strong>Analyze</strong><small>Inspect the evidence</small></li><li><span>02</span><strong>Improve</strong><small>Review the change</small></li><li><span>03</span><strong>Test</strong><small>Check the result</small></li></ol>
  </section>;
}

function Capabilities() {
  const [activeId, setActiveId] = useState('analyze');
  const active = CAPABILITIES.find(({ id }) => id === activeId);
  const Icon = active.icon;
  return <section className="al-section" id="capabilities" aria-labelledby="al-capabilities-title">
    <div className="al-section-heading"><div><p className="al-eyebrow">01 / AVAILABLE NOW</p><h2 id="al-capabilities-title">From a signal<br />to a testable decision.</h2></div><p>For people building content and agent workflows: inspect the source, make a deliberate change, and keep the result open to review.</p></div>
    <div className="al-department-layout">
      <div className="al-department-selector" aria-label="Select an engine capability">
        {CAPABILITIES.map(({ id, number, label, short, icon: DepartmentIcon, tag }) => <button
          key={id} type="button" className={`al-department-button ${id === activeId ? 'is-selected' : ''}`}
          aria-pressed={id === activeId} aria-controls="al-department-detail" onClick={() => setActiveId(id)}
        ><span className="al-department-number">{number}</span><DepartmentIcon size={20} aria-hidden="true" /><span><strong>{label}</strong><small>{short} / {tag}</small></span><ArrowUpRight size={18} aria-hidden="true" /></button>)}
      </div>
      <article id="al-department-detail" className={`al-department-detail al-department-${active.id}`} aria-live="polite" aria-atomic="true">
        <div className="al-detail-top"><span className="al-tag">{active.tag}</span><Icon size={42} strokeWidth={1} aria-hidden="true" /></div>
        <h3>{active.outcome}</h3><p>{active.description}</p>
        <div className="al-expansion-gate"><span className="al-eyebrow">{active.detailLabel}</span><p>{active.detail}</p></div>
        <a className="al-text-link" href={active.href}>{active.link}<ArrowUpRight size={16} aria-hidden="true" /></a>
      </article>
    </div>
  </section>;
}

function EngineEvidence() {
  return <section className="al-mission" id="benchmark" aria-labelledby="al-benchmark-title">
    <div className="al-mission-copy"><p className="al-eyebrow">02 / EVIDENCE YOU CAN INSPECT</p><h2 id="al-benchmark-title">A useful engine<br />shows its limits.</h2><p>BrainSNN publishes how its content detector performs on unseen passages, including missed cues and false alarms. Inspect that evidence before deciding where a score belongs in your workflow.</p><div className="al-mission-rule"><Check size={16} aria-hidden="true" /><span>A score is a signal. The source and test matter.</span></div></div>
    <article className="al-offer"><div className="al-offer-top"><span className="al-eyebrow">PUBLIC BENCHMARK</span><span className="al-tag">Held-out text</span></div><h3>Look beyond<br />the model score.</h3><div className="al-offer-details"><p><span>INSPECT</span>Development and unseen passages</p><p><span>COMPARE</span>Rank agreement and failure cases</p><p><span>QUESTION</span>What does this test leave unproven?</p></div><a className="al-button al-button-primary" href="/evidence">Inspect the benchmark <ArrowUpRight size={17} aria-hidden="true" /></a><p className="al-offer-note">Published text evaluation · not a prediction of market outcomes</p></article>
  </section>;
}

function AgentBuilders() {
  return <section className="al-builders" id="builders" aria-labelledby="al-builders-title">
    <div><p className="al-eyebrow">FOR AGENT BUILDERS</p><h2 id="al-builders-title">Compare a change.<br />Keep its evidence.</h2><div className="al-builder-links"><a className="al-text-link" href="/engine">Compare two drafts <ArrowRight size={15} aria-hidden="true" /></a><a className="al-text-link" href="/engine#api">Use the API and MCP tools <ArrowUpRight size={15} aria-hidden="true" /></a></div></div>
    <div className="al-builder-contract"><p>Compare original and candidate text through <code>POST /api/engine/compare</code> or the local MCP tool <code>brain_compare</code>.</p><ul><li>Source hashes and exact quote offsets</li><li>Heuristic signal changes and their limits</li><li><code>REVIEW_REQUIRED</code> before treating the change as an improvement</li></ul><p className="al-builder-boundary">Comparison produces review evidence. It does not verify facts, predict market outcomes or execute an agent task.</p></div>
  </section>;
}

function WorkAndEvidence({ summary, loading, refresh }) {
  const recorded = summary.mode === 'recorded';
  return <section className="al-section" id="office" aria-labelledby="al-evidence-title">
    <div className="al-section-heading"><div><p className="al-eyebrow">04 / OPERATIONAL EXAMPLE · XIO</p><h2 id="al-evidence-title">One workload.<br />Its own evidence.</h2></div><p>These records come from XIO’s separate service experiment. They are not BrainSNN-wide usage, benchmark scores or evidence of native agent execution.</p></div>
    <div className="al-example-source"><span>Source: XIO operator desk · approved public summary</span><a href={SETUP_DAY_URL}>View the existing XIO experiment <ArrowUpRight size={14} aria-hidden="true" /></a></div>
    <div className="al-record-status" role="status"><div><span className={`al-record-dot ${recorded ? 'has-records' : ''}`} aria-hidden="true" /><span><strong>{loading ? 'Checking recorded evidence…' : recorded ? 'Recorded snapshot · not a live feed' : 'Recorded evidence unavailable'}</strong><small>{recorded ? formatRecordTime(summary.generatedAt) : 'No verified public snapshot is available. Unknown values are shown as —.'}</small></span></div><button type="button" className="al-refresh" disabled={loading} onClick={refresh}><RefreshCw size={15} className={loading ? 'al-is-refreshing' : ''} aria-hidden="true" />{loading ? 'Refreshing' : 'Refresh records'}</button></div>
    <div className="al-work-stages" aria-label="XIO recorded work order counts" aria-busy={loading}>
      {WORK_STAGES.map(({ key, label, description }) => <div className={`al-work-stage al-work-${key}`} key={key}><div><span className="al-stage-dot" aria-hidden="true" /><span>{label}</span></div><strong aria-label={`${label}: ${summary.work[key] === null ? 'unknown' : summary.work[key]}`}>{formatCount(summary.work[key])}</strong><p>{description}</p></div>)}
    </div>
    <div className="al-evidence-metrics" aria-label="XIO recorded evidence counts">
      {EVIDENCE_METRICS.map(({ key, label, description }) => <article key={key}><span className="al-metric-value" aria-label={`${label}: ${summary.evidence[key] === null ? 'unknown' : summary.evidence[key]}`}>{formatCount(summary.evidence[key])}</span><h3>{label}</h3><p>{description}</p></article>)}
    </div>
    <div className="al-accounting-note"><ShieldCheck size={18} aria-hidden="true" /><p>In this XIO experiment, payment evidence comes from deduplicated receipts. Cash results account for refunds and direct costs; time-adjusted contribution also accounts for owner effort. These records do not establish demand for BrainSNN.</p></div>
  </section>;
}

function ContextAndWorkers() {
  const decisions = [
    { number: '01', title: 'Reusable context', body: 'Carry sources, versions, uncertainty and prior results into a bounded agent task. Keep a proposed lesson separate from an accepted instruction.' },
    { number: '02', title: 'Independent tests', body: 'Compare a candidate with a baseline on later work. Track failures and regressions so improving one score does not hide a weaker result elsewhere.' },
    { number: '03', title: 'Resource allocation', body: 'Use reviewed outcomes to decide which configuration earns another attempt, which needs revision and which should retire. Preserve the evidence either way.' },
  ];
  return <section className="al-learning" id="roadmap" aria-labelledby="al-learning-title">
    <div className="al-learning-head"><p className="al-eyebrow">03 / NEXT ENGINE WORK · ROADMAP</p><h2 id="al-learning-title">Build context.<br /><span>Test what carries forward.</span></h2><p>The next step is to connect today’s analysis, saved versions and proof missions into a reusable context loop. This is the engine roadmap, not a claim of autonomous learning already running.</p></div>
    <div className="al-context-track" aria-label="Planned context promotion process"><span><Layers3 size={17} aria-hidden="true" />Sourced context</span><ArrowRight size={16} aria-hidden="true" /><span>Candidate lesson</span><ArrowRight size={16} aria-hidden="true" /><span>Independent review</span><ArrowRight size={16} aria-hidden="true" /><span>Subsequent test</span><ArrowRight size={16} aria-hidden="true" /><span className="al-track-final">Reusable context</span></div>
    <div className="al-decision-grid">{decisions.map(({ number, title, body }) => <article key={number}><span className="al-eyebrow">{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
    <p className="al-blocked-note">Engine progress will be judged by source traceability, repeatable tests and whether useful context survives a new task.</p>
  </section>;
}

function Replay({ events, recorded }) {
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setSelected(0); setPlaying(false); }, [events]);
  useEffect(() => {
    if (!playing || !events.length) return undefined;
    const timer = setTimeout(() => {
      if (selected >= events.length - 1) setPlaying(false);
      else setSelected((value) => value + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [events.length, playing, selected]);
  const event = events[selected];
  const select = (index) => { setSelected(index); setPlaying(false); };
  return <section className="al-section al-replay-section" id="replay" aria-labelledby="al-replay-title">
    <div className="al-section-heading"><div><p className="al-eyebrow">XIO / THE PUBLIC WINDOW</p><h2 id="al-replay-title">Watch what was recorded.</h2></div><p>Selected, approved events from the same XIO operational example. Playback is a recorded sequence, not a live stream of the BrainSNN engine.</p></div>
    <div className="al-replay">
      <div className="al-replay-display"><span className="al-replay-label"><Radio size={15} aria-hidden="true" /> RECORDED REPLAY</span>
        {event ? <div className="al-replay-event" aria-live={playing ? 'off' : 'polite'}><span className="al-tag">{eventStatusLabel(event.status)} · Recorded event</span><h3>{event.label}</h3><time dateTime={event.at}>{formatRecordTime(event.at)}</time></div> : <div className="al-replay-empty"><span className="al-empty-icon"><Play size={27} strokeWidth={1} aria-hidden="true" /></span><h3>{recorded ? 'No approved replay events yet.' : 'The replay is waiting for evidence.'}</h3><p>{recorded ? 'The published snapshot contains no selected events. Refresh records to check for newly approved evidence.' : 'Recorded events will appear when an approved public snapshot is available.'}</p></div>}
        <div className="al-replay-controls"><div><button type="button" aria-label="Previous recorded event" disabled={!event || selected === 0} onClick={() => select(selected - 1)}><ChevronLeft size={17} aria-hidden="true" /></button><button type="button" aria-label={playing ? 'Pause recorded replay' : 'Play recorded replay'} disabled={events.length < 2} onClick={() => { if (!playing && selected === events.length - 1) setSelected(0); setPlaying((value) => !value); }}>{playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}</button><button type="button" aria-label="Next recorded event" disabled={!event || selected === events.length - 1} onClick={() => select(selected + 1)}><ChevronRight size={17} aria-hidden="true" /></button></div><span>{event ? `${selected + 1} / ${events.length} events` : 'No replay available'}</span><span className="al-replay-speed">3 sec / event</span></div>
      </div>
      <aside className="al-replay-ledger" aria-label="Recorded event selection"><div className="al-panel-top"><span>EVENT INDEX</span><span>Oldest → newest</span></div>{events.length ? <ol>{events.map((item, index) => <li key={item.id}><button type="button" aria-current={index === selected ? 'step' : undefined} onClick={() => select(index)}><span className="al-event-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.label}</strong><small>{eventStatusLabel(item.status)} · {formatRecordTime(item.at)}</small></span></button></li>)}</ol> : <div className="al-ledger-empty"><GitBranch size={22} strokeWidth={1.2} aria-hidden="true" /><p>A trace worth watching<br />starts with work worth doing.</p><small>No synthetic activity is counted as demand or validation.</small></div>}</aside>
    </div>
  </section>;
}

export function AgentLabHome() {
  const { summary, loading, refresh } = useLabSummary();
  useEffect(() => { document.title = LAB_TITLE; }, []);
  return <div className="al-site"><a className="al-skip-link" href="#al-main">Skip to content</a>
    <header className="al-header"><Brand /><nav aria-label="Main navigation"><a href="#capabilities">The engine</a><a href="/evidence">Benchmark</a><a href="#roadmap">What’s next</a><a href="#office">The office</a></nav><a className="al-header-cta" href="/app">Open BrainSNN <ArrowUpRight size={15} aria-hidden="true" /></a></header>
    <main id="al-main">
      <section className="al-hero" aria-labelledby="al-hero-title"><div className="al-hero-copy"><p className="al-eyebrow"><span className="al-square" /> ANALYZE · IMPROVE · TEST</p><h1 id="al-hero-title">An evidence engine{' '}<br /><span>for agent work.</span></h1><p className="al-hero-description">{LAB_DESCRIPTION}</p><div className="al-hero-actions"><a className="al-button al-button-primary" href="/app">Analyze your content <ArrowRight size={16} aria-hidden="true" /></a><a className="al-button al-button-quiet" href="/evidence">Inspect the benchmark <ArrowUpRight size={16} aria-hidden="true" /></a></div><div className="al-hero-principle"><span>THE PRINCIPLE</span><p>Build context. Test decisions.<br />Improve the next run.</p></div></div><OfficePreview /></section>
      <EngineWorkflow /><Capabilities /><EngineEvidence /><AgentBuilders /><ContextAndWorkers /><WorkAndEvidence summary={summary} loading={loading} refresh={refresh} /><Replay events={summary.events} recorded={summary.mode === 'recorded'} />
      <section className="al-tools" id="tools" aria-labelledby="al-tools-title"><div><p className="al-eyebrow">EXPLORE BRAINSNN</p><h2 id="al-tools-title">Tools and research, within reach.</h2><p>Use the workspace for a real draft. Explore claims, benchmarks and simulation environments on their own terms.</p></div><div className="al-tool-links"><a href="/app"><span>Analysis workspace<small>Analyze, improve and save versions</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/reconstruct"><span>Reconstruct<small>Separate a supported claim from its framing</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/missions"><span>Proof missions<small>Bounded objectives and recorded attempts</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/arcade"><span>GaugeGap Arcade<small>Playable research and experiments</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/lab"><span>Neuro Powder Lab<small>Neural circuit simulations</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/evidence"><span>Detector evaluation<small>Inspect the content model’s limitations</small></span><ArrowUpRight size={20} aria-hidden="true" /></a></div></section>
    </main><footer className="al-footer"><Brand /><p>Build context. Test decisions. Improve the next run.</p><a className="al-operator-link" href="https://www.xioai.co/dashboard/agent-lab">XIO example operator desk</a><a href="/app">Open BrainSNN <ArrowUpRight size={14} aria-hidden="true" /></a></footer>
  </div>;
}
