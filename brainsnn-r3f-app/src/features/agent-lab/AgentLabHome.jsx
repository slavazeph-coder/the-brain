import React, { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUpRight, BrainCircuit, Check, ChevronLeft, ChevronRight,
  Code2, FlaskConical, GitBranch, Layers3, Pause, Play, Radio, RefreshCw, ShieldCheck,
} from 'lucide-react';
import {
  EVIDENCE_METRICS, LAB_DESCRIPTION, LAB_TITLE, SETUP_DAY_URL, WORK_STAGES,
  eventStatusLabel, formatCount, formatRecordTime,
} from './agentLabModel.js';
import { useLabSummary } from './useLabSummary.js';
import './agent-lab.css';

const DEPARTMENTS = [
  {
    id: 'content', number: '01', label: 'Content optimizer', short: 'Acquisition', icon: GitBranch,
    tag: 'First capability', outcome: 'Earn a real conversation.',
    description: 'Test the evidence, message and offer against buyer response. Warm introductions and referrals come first; LinkedIn carries the proof.',
    gate: 'Expand when qualified conversations and paid work improve repeatedly.', href: '/app', link: 'Open content analyzer',
  },
  {
    id: 'factory', number: '02', label: 'App production factory', short: 'Delivery', icon: Code2,
    tag: 'Customer delivery', outcome: 'Build something someone needs.',
    description: 'Turn an agreed customer need into a bounded build. Preserve the artifact, acceptance criteria, defects and the time needed to deliver it.',
    gate: 'A standalone product earns its place through paid demand and repeatable delivery.', href: '/missions', link: 'Explore proof missions',
  },
  {
    id: 'stream', number: '03', label: 'Interdimensional stream', short: 'Broadcast', icon: Radio,
    tag: 'Recorded first', outcome: 'Let the work tell the story.',
    description: 'A public window into selected experiments, failures and promotions. Start with recorded replays; a fictional world can frame the real evidence.',
    gate: 'Continuous streaming begins only when returning viewers justify production costs.', href: '#replay', link: 'View recorded events',
  },
  {
    id: 'robotics', number: '04', label: 'Robotics simulator farm', short: 'Research', icon: FlaskConical,
    tag: 'Parked', outcome: 'Keep the research. Earn the expansion.',
    description: 'Preserve the existing simulation experiments. New farm spending stays at zero during the first commercial experiment.',
    gate: 'Reopen with a funded use case and one reproducible learning environment.', href: '/lab', link: 'Explore existing simulations',
  },
];

function Brand() {
  return <a className="al-brand" href="/" aria-label="BrainSNN home">
    <span className="al-brand-mark"><BrainCircuit size={24} strokeWidth={1.6} aria-hidden="true" /></span>
    <span>Brain<span className="al-brand-light">SNN</span><small>THE WORKING AGENT LAB</small></span>
  </a>;
}

function OfficeDiagram() {
  return <svg className="al-office-diagram" viewBox="0 0 560 330" role="img" aria-label="Operating design: acquisition and delivery feed evidence into shared context, which informs the next task. This diagram does not represent live activity.">
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
      <text x="102" y="81">ACQUISITION</text><text x="373" y="81">DELIVERY</text>
      <text x="280" y="141" textAnchor="middle" fill="#9ce7e9">SHARED CONTEXT</text>
      <text x="280" y="266" textAnchor="middle">REVIEW + EVIDENCE</text>
    </g>
    <g fill="#7a9aa6"><circle cx="159" cy="91" r="2" /><circle cx="401" cy="91" r="2" /></g>
  </svg>;
}

function OfficePreview({ summary, loading }) {
  return <aside className="al-office-preview" aria-label="Agent office design">
    <div className="al-panel-top"><span><span className="al-square" /> THE OFFICE</span><span className="al-tag">Operating design</span></div>
    <div className="al-office-caption"><h2>One mission.<br />Shared intelligence.</h2><span className="al-coordinate" aria-hidden="true">LAB / 001<br />CONTEXT → WORK</span></div>
    <OfficeDiagram />
    <div className="al-office-foot"><span><ShieldCheck size={15} aria-hidden="true" /> Evidence determines the next allocation.</span><span>{loading ? 'Checking records' : summary.mode === 'recorded' ? 'Recorded snapshot' : 'Records unavailable'}</span></div>
  </aside>;
}

function Allocation() {
  return <section className="al-allocation" aria-label="Initial working time allocation">
    <div className="al-allocation-label"><span className="al-eyebrow">FOCUS IS A BUDGET</span><p>Initial working time</p></div>
    <div className="al-allocation-shares">
      <div className="al-share al-share-primary"><strong>70<span>%</span></strong><span>Acquisition<br />& delivery</span></div>
      <div className="al-share"><strong>20<span>%</span></strong><span>Execution<br />& evaluation</span></div>
      <div className="al-share"><strong>10<span>%</span></strong><span>Public<br />storytelling</span></div>
      <div className="al-allocation-bar" aria-hidden="true"><i /><i /><i /></div>
    </div>
  </section>;
}

function Departments() {
  const [activeId, setActiveId] = useState('content');
  const active = DEPARTMENTS.find(({ id }) => id === activeId);
  const Icon = active.icon;
  return <section className="al-section" id="office" aria-labelledby="al-office-title">
    <div className="al-section-heading"><div><p className="al-eyebrow">01 / THE DEPARTMENTS</p><h2 id="al-office-title">Different capabilities.<br />The same test: useful work.</h2></div><p>Every department has a purpose, a constraint and a condition for earning more resources.</p></div>
    <div className="al-department-layout">
      <div className="al-department-selector" aria-label="Select a department">
        {DEPARTMENTS.map(({ id, number, label, short, icon: DepartmentIcon, tag }) => <button
          key={id} type="button" className={`al-department-button ${id === activeId ? 'is-selected' : ''}`}
          aria-pressed={id === activeId} aria-controls="al-department-detail" onClick={() => setActiveId(id)}
        ><span className="al-department-number">{number}</span><DepartmentIcon size={20} aria-hidden="true" /><span><strong>{label}</strong><small>{short} / {tag}</small></span><ArrowUpRight size={18} aria-hidden="true" /></button>)}
      </div>
      <article id="al-department-detail" className={`al-department-detail al-department-${active.id}`} aria-live="polite" aria-atomic="true">
        <div className="al-detail-top"><span className="al-tag">{active.tag}</span><Icon size={42} strokeWidth={1} aria-hidden="true" /></div>
        <h3>{active.outcome}</h3><p>{active.description}</p>
        <div className="al-expansion-gate"><span className="al-eyebrow">EXPANSION CONDITION</span><p>{active.gate}</p></div>
        <a className="al-text-link" href={active.href}>{active.link}<ArrowUpRight size={16} aria-hidden="true" /></a>
      </article>
    </div>
  </section>;
}

function Mission() {
  return <section className="al-mission" id="mission" aria-labelledby="al-mission-title">
    <div className="al-mission-copy"><p className="al-eyebrow">02 / THE FIRST COMMERCIAL EXPERIMENT</p><h2 id="al-mission-title">A real business.<br />A useful first delivery.</h2><p>BrainSNN is the learning lab. XIO is the customer-facing business. Our first mission is to sell and deliver an AI Team Setup Day for owner-led service businesses.</p><div className="al-mission-rule"><Check size={16} aria-hidden="true" /><span>One offer. Two messages. Real buyer response.</span></div></div>
    <article className="al-offer"><div className="al-offer-top"><span className="al-eyebrow">DELIVERED BY XIO</span><span className="al-tag">Remote</span></div><h3>AI Team<br />Setup Day</h3><p className="al-price">US$1,500<span>Fixed offer price</span></p><div className="al-offer-details"><p><span>WHO</span>Owner-led service businesses</p><p><span>CHANNEL</span>Warm introductions & referrals</p><p><span>TEST</span>Current message + one challenger</p></div><a className="al-button al-button-primary" href={SETUP_DAY_URL}>See the XIO offer <ArrowUpRight size={17} aria-hidden="true" /></a><p className="al-offer-note">A mission target. This price is not reported revenue.</p></article>
  </section>;
}

function WorkAndEvidence({ summary, loading, refresh }) {
  const recorded = summary.mode === 'recorded';
  return <section className="al-section" id="evidence" aria-labelledby="al-evidence-title">
    <div className="al-section-heading"><div><p className="al-eyebrow">03 / THE EVIDENCE DESK</p><h2 id="al-evidence-title">Progress has a paper trail.</h2></div><p>Accepted work, tested lessons and verified payments determine what gets another budget.</p></div>
    <div className="al-record-status" role="status"><div><span className={`al-record-dot ${recorded ? 'has-records' : ''}`} aria-hidden="true" /><span><strong>{loading ? 'Checking recorded evidence…' : recorded ? 'Recorded snapshot · not a live feed' : 'Recorded evidence unavailable'}</strong><small>{recorded ? formatRecordTime(summary.generatedAt) : 'No verified public snapshot is available. Unknown values are shown as —.'}</small></span></div><button type="button" className="al-refresh" disabled={loading} onClick={refresh}><RefreshCw size={15} className={loading ? 'al-is-refreshing' : ''} aria-hidden="true" />{loading ? 'Refreshing' : 'Refresh records'}</button></div>
    <div className="al-work-stages" aria-label="Recorded work order counts" aria-busy={loading}>
      {WORK_STAGES.map(({ key, label, description }) => <div className={`al-work-stage al-work-${key}`} key={key}><div><span className="al-stage-dot" aria-hidden="true" /><span>{label}</span></div><strong aria-label={`${label}: ${summary.work[key] === null ? 'unknown' : summary.work[key]}`}>{formatCount(summary.work[key])}</strong><p>{description}</p></div>)}
    </div>
    <div className="al-evidence-metrics" aria-label="Recorded evidence counts">
      {EVIDENCE_METRICS.map(({ key, label, description }) => <article key={key}><span className="al-metric-value" aria-label={`${label}: ${summary.evidence[key] === null ? 'unknown' : summary.evidence[key]}`}>{formatCount(summary.evidence[key])}</span><h3>{label}</h3><p>{description}</p></article>)}
    </div>
    <div className="al-accounting-note"><ShieldCheck size={18} aria-hidden="true" /><p>Revenue comes from deduplicated payment records. Cash results account for refunds and direct costs; time-adjusted contribution also accounts for owner effort. A content score cannot certify a sale.</p></div>
  </section>;
}

function ContextAndWorkers() {
  const decisions = [
    { number: '01', title: 'Hire for a bounded task', body: 'A worker starts with a context version, acceptance criteria and a resource allowance.' },
    { number: '02', title: 'Promote on repeated results', body: 'Accepted work and observed commercial contribution earn a larger allocation.' },
    { number: '03', title: 'Retire the configuration', body: 'Stop allocating unsuccessful work. Keep the evidence and useful context.' },
  ];
  return <section className="al-learning" aria-labelledby="al-learning-title">
    <div className="al-learning-head"><p className="al-eyebrow">THE SELECTION MECHANISM</p><h2 id="al-learning-title">The worker must earn it.<br /><span>So must the context.</span></h2><p>Lessons begin as hypotheses. Sources, dates, versions and outcomes travel with them. Independent review and subsequent tasks decide which lessons become standing instructions.</p></div>
    <div className="al-context-track" aria-label="Context promotion process"><span><Layers3 size={17} aria-hidden="true" />Sourced context</span><ArrowRight size={16} aria-hidden="true" /><span>Candidate lesson</span><ArrowRight size={16} aria-hidden="true" /><span>Independent review</span><ArrowRight size={16} aria-hidden="true" /><span>Subsequent test</span><ArrowRight size={16} aria-hidden="true" /><span className="al-track-final">Promoted context</span></div>
    <div className="al-decision-grid">{decisions.map(({ number, title, body }) => <article key={number}><span className="al-eyebrow">{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
    <p className="al-blocked-note">Blocked is a separate state. Missing access, customer replies or an unavailable runtime are dependencies to resolve, not evidence of worker incompetence.</p>
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
    <div className="al-section-heading"><div><p className="al-eyebrow">04 / THE PUBLIC WINDOW</p><h2 id="al-replay-title">Watch what actually happened.</h2></div><p>The interdimensional world is the setting. These are selected, approved records of the work.</p></div>
    <div className="al-replay">
      <div className="al-replay-display"><span className="al-replay-label"><Radio size={15} aria-hidden="true" /> RECORDED REPLAY</span>
        {event ? <div className="al-replay-event" aria-live={playing ? 'off' : 'polite'}><span className="al-tag">{eventStatusLabel(event.status)} · Recorded event</span><h3>{event.label}</h3><time dateTime={event.at}>{formatRecordTime(event.at)}</time></div> : <div className="al-replay-empty"><span className="al-empty-icon"><Play size={27} strokeWidth={1} aria-hidden="true" /></span><h3>{recorded ? 'No approved replay events yet.' : 'The replay is waiting for evidence.'}</h3><p>{recorded ? 'The published snapshot contains no selected events. Refresh records to check for newly approved evidence.' : 'Recorded events will appear when an approved public snapshot is available.'}</p></div>}
        <div className="al-replay-controls"><div><button type="button" aria-label="Previous recorded event" disabled={!event || selected === 0} onClick={() => select(selected - 1)}><ChevronLeft size={17} aria-hidden="true" /></button><button type="button" aria-label={playing ? 'Pause recorded replay' : 'Play recorded replay'} disabled={events.length < 2} onClick={() => { if (!playing && selected === events.length - 1) setSelected(0); setPlaying((value) => !value); }}>{playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}</button><button type="button" aria-label="Next recorded event" disabled={!event || selected === events.length - 1} onClick={() => select(selected + 1)}><ChevronRight size={17} aria-hidden="true" /></button></div><span>{event ? `${selected + 1} / ${events.length} events` : 'No replay available'}</span><span className="al-replay-speed">3 sec / event</span></div>
      </div>
      <aside className="al-replay-ledger" aria-label="Recorded event selection"><div className="al-panel-top"><span>EVENT INDEX</span><span>Oldest → newest</span></div>{events.length ? <ol>{events.map((item, index) => <li key={item.id}><button type="button" aria-current={index === selected ? 'step' : undefined} onClick={() => select(index)}><span className="al-event-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.label}</strong><small>{eventStatusLabel(item.status)} · {formatRecordTime(item.at)}</small></span></button></li>)}</ol> : <div className="al-ledger-empty"><GitBranch size={22} strokeWidth={1.2} aria-hidden="true" /><p>A trace worth watching<br />starts with work worth doing.</p><small>No synthetic activity is counted as demand or validation.</small></div>}</aside>
    </div>
  </section>;
}

function Gates() {
  return <section className="al-section al-gates" aria-labelledby="al-gates-title"><div className="al-section-heading"><div><p className="al-eyebrow">THE FIRST 90 DAYS</p><h2 id="al-gates-title">Expand when the evidence says to.</h2></div><p>Operating gates from the experiment start date. These are targets, not claims of completed work.</p></div><div className="al-gate-grid"><article><span className="al-eyebrow">DAYS 01–14</span><h3>Make execution reliable.</h3><p>Establish a dated baseline. Complete a task-to-delivery dry run. Verify interruptions, retries, refunds and attribution.</p><span className="al-gate-target">GATE / A verified execution path</span></article><article><span className="al-eyebrow">DAYS 15–45</span><h3>Earn the first engagement.</h3><p>Pursue a paid engagement and accepted delivery. Record costs and owner time from the first task.</p><span className="al-gate-target">GATE / Paid, accepted work</span></article><article><span className="al-eyebrow">DAYS 46–90</span><h3>Show it can repeat.</h3><p>Target three independent paid, accepted deliveries with positive time-adjusted contribution.</p><span className="al-gate-target">GATE / Repeatable contribution</span></article></div><p className="al-gates-note">Three deliveries are an operating milestone, not statistical proof that a message wins. If conversations stall, revise acquisition. If purchases stall, revise the offer.</p></section>;
}

export function AgentLabHome() {
  const { summary, loading, refresh } = useLabSummary();
  useEffect(() => { document.title = LAB_TITLE; }, []);
  return <div className="al-site"><a className="al-skip-link" href="#al-main">Skip to content</a>
    <header className="al-header"><Brand /><nav aria-label="Main navigation"><a href="#office">The office</a><a href="#mission">The mission</a><a href="#evidence">Evidence</a><a href="#tools">Tools</a></nav><a className="al-header-cta" href={SETUP_DAY_URL}>Work with XIO <ArrowUpRight size={15} aria-hidden="true" /></a></header>
    <main id="al-main">
      <section className="al-hero" aria-labelledby="al-hero-title"><div className="al-hero-copy"><p className="al-eyebrow"><span className="al-square" /> AN AGENT COMPANY, BUILT ON EVIDENCE</p><h1 id="al-hero-title">AI work that{' '}<br /><span>earns its keep.</span></h1><p className="al-hero-description">{LAB_DESCRIPTION}</p><div className="al-hero-actions"><a className="al-button al-button-primary" href="#office">Enter the office <ArrowDown size={16} aria-hidden="true" /></a><a className="al-button al-button-quiet" href="#mission">Meet the first mission <ArrowUpRight size={16} aria-hidden="true" /></a></div><div className="al-hero-principle"><span>THE PRINCIPLE</span><p>Useful work earns more resources.<br />Every claim needs evidence.</p></div></div><OfficePreview summary={summary} loading={loading} /></section>
      <Allocation /><Departments /><Mission /><WorkAndEvidence summary={summary} loading={loading} refresh={refresh} /><ContextAndWorkers /><Replay events={summary.events} recorded={summary.mode === 'recorded'} /><Gates />
      <section className="al-tools" id="tools" aria-labelledby="al-tools-title"><div><p className="al-eyebrow">ALREADY IN THE LAB</p><h2 id="al-tools-title">Tools and research, within reach.</h2><p>Existing capabilities stay available as the company learns where to focus.</p></div><div className="al-tool-links"><a href="/app"><span>Content analyzer<small>Inspect drafts, claims and evidence</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/missions"><span>Proof missions<small>Bounded objectives and recorded attempts</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/arcade"><span>GaugeGap Arcade<small>Playable research and experiments</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/lab"><span>Neuro Powder Lab<small>Existing neural circuit simulations</small></span><ArrowUpRight size={20} aria-hidden="true" /></a><a href="/evidence"><span>Detector evaluation<small>Inspect the content model’s limitations</small></span><ArrowUpRight size={20} aria-hidden="true" /></a></div></section>
    </main><footer className="al-footer"><Brand /><p>Build context. Test it. Earn the next allocation.</p><a className="al-operator-link" href="https://www.xioai.co/dashboard/agent-lab">Open operator desk</a><a href="https://www.xioai.co/">Customer work by XIO <ArrowUpRight size={14} aria-hidden="true" /></a></footer>
  </div>;
}
