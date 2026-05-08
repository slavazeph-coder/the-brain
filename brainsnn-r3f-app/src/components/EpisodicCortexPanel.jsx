import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addCapture,
  addInsight,
  getCaptures,
  deleteCapture,
  togglePinned,
  clearAllCaptures,
  ensureAllEmbeddings,
  subscribeEpisodic,
  captureStats,
  exportEpisodicBundle,
  importEpisodicBundle
} from '../utils/episodicMemory';
import { captureToBrainState } from '../utils/episodicRouter';
import { dailyBrief, weeklySynthesis } from '../utils/episodicSynthesis';
import {
  EPISODIC_CATEGORIES,
  EPISODIC_IDS
} from '../data/episodicTaxonomy';
import { initEmbeddings, isReady as embeddingsReady } from '../utils/embeddings';
import { isGemmaConfigured } from '../utils/gemmaEngine';
import {
  shouldRunBrief,
  shouldRunSynthesis,
  recordBrief,
  recordSynthesis,
  nextBriefRelative,
  nextSynthesisRelative,
  getAutoBriefState
} from '../utils/episodicAutoBrief';
import { computeStreak, streakLabel } from '../utils/episodicStreak';
import { detectDecisionDrifts, formatDrift } from '../utils/episodicDrift';
import { consumeDeepLinkCapture, bookmarkletSource } from '../utils/episodicDeepLink';
import { isSpeechSupported, createSpeechSession } from '../utils/speech';
import { ocrImage } from '../utils/ocr';
import EpisodicGraph from './EpisodicGraph';

const EXAMPLE_CAPTURES = [
  {
    title: 'Picked Postgres over DynamoDB',
    text: 'Decided to go with Postgres for the new analytics service. Trade-off: we lose horizontal scale-out for free, but query flexibility is more valuable for this team. Locked in for 2026 H1.'
  },
  {
    title: 'Production outage Wednesday',
    text: 'Auth service crashed at 14:02. Root cause was a missing migration on a staging-only column. Customer-facing for 8 minutes. Regret not catching this in the deploy review — should have been obvious.'
  },
  {
    title: 'Ferrari paper on second brain',
    text: 'Read https://github.com/breferrari/obsidian-mind — the lifecycle hooks pattern (SessionStart / Stop / PostToolUse) is interesting. Same shape as STDP consolidation in Dream Mode. Quote: "procedural code owns the environment, the agent owns content."'
  },
  {
    title: 'Why does pressure spike on weekends?',
    text: 'Question I keep returning to: the firewall logs show mean pressure climbs 30% on Saturdays. Is it me reading more outrage content, or is the corpus actually different on weekends?'
  }
];

function fmtTime(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const dd = Math.floor(hr / 24);
  if (dd < 7) return `${dd}d`;
  return d.toISOString().slice(0, 10);
}

function CategoryChip({ id, score, isPrimary }) {
  const cat = EPISODIC_CATEGORIES[id];
  if (!cat) return null;
  const pct = Math.round((score || 0) * 100);
  return (
    <span
      className="firewall-chip"
      style={{
        borderColor: cat.color,
        background: isPrimary ? `${cat.color}33` : 'transparent',
        color: cat.color,
        fontWeight: isPrimary ? 600 : 400
      }}
      title={cat.description}
    >
      {cat.icon} {cat.label} {pct ? `${pct}%` : ''}
    </span>
  );
}

function CaptureCard({ capture, onApply, onDelete, onPin }) {
  const cat = EPISODIC_CATEGORIES[capture.primary];
  const fwPct = Math.round((capture.firewall?.pressure || 0) * 100);
  const affChip = capture.affects?.dominant?.[0];

  return (
    <div
      style={{
        padding: '10px 12px',
        borderLeft: `3px solid ${cat?.color || '#7c8aa1'}`,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: 6,
        marginTop: 8
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ flex: 1, lineHeight: 1.3 }}>
          {capture.kind === 'insight' && <span style={{ color: '#5ad4ff', marginRight: 6 }}>✦ insight</span>}
          {capture.title}
        </strong>
        <span className="muted small-note" style={{ whiteSpace: 'nowrap' }}>
          {fmtTime(capture.ts)}
          {capture.consolidatedCount > 0 && (
            <span title={`Reinforced ${capture.consolidatedCount}× by Dream Mode`} style={{ marginLeft: 6, color: '#a86fdf' }}>
              · ◐{capture.consolidatedCount}
            </span>
          )}
        </span>
      </div>
      <div className="firewall-chips" style={{ marginTop: 6 }}>
        <CategoryChip id={capture.primary} score={capture.classification?.scores?.[capture.primary]?.score} isPrimary />
        {capture.secondary && <CategoryChip id={capture.secondary} score={capture.classification?.scores?.[capture.secondary]?.score} />}
        {affChip && (
          <span className="firewall-chip" style={{ borderColor: affChip.color, color: affChip.color }} title="Dominant affect">
            ♥ {affChip.label}
          </span>
        )}
        {fwPct > 25 && (
          <span className="firewall-chip" style={{ borderColor: fwPct > 50 ? '#ff4066' : '#fdab43', color: fwPct > 50 ? '#ff4066' : '#fdab43' }} title="Firewall manipulation pressure">
            ⚠ {fwPct}%
          </span>
        )}
        {capture.urls?.[0] && (
          <a className="firewall-chip" href={capture.urls[0]} target="_blank" rel="noopener noreferrer" style={{ color: '#5ad4ff' }}>
            ↗ link
          </a>
        )}
      </div>
      <p className="muted small-note" style={{ margin: '6px 0 0 0', lineHeight: 1.45 }}>
        {capture.text.slice(0, 220)}{capture.text.length > 220 ? '…' : ''}
      </p>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button className="ghost small" onClick={() => onApply?.(capture)} title="Push this capture's region activation to the 3D brain">
          → Brain
        </button>
        <button className="ghost small" onClick={() => onPin?.(capture)}>
          {capture.pinned ? '★ pinned' : '☆ pin'}
        </button>
        <button className="ghost small" onClick={() => onDelete?.(capture)}>
          delete
        </button>
      </div>
    </div>
  );
}

function BriefCard({ brief, onUseInsight }) {
  if (!brief) return null;
  return (
    <div className="episodic-brief-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <strong style={{ color: '#5ad4ff' }}>Daily Brief</strong>
        <span className="muted small-note">
          {brief.count} captures · {brief.source}{brief.gemmaError ? ` (gemma: ${brief.gemmaError})` : ''}
        </span>
      </div>

      <div style={{ marginTop: 8 }}>
        <strong className="muted small-note" style={{ display: 'block', marginBottom: 6 }}>Connections</strong>
        {brief.connections?.length ? brief.connections.map((c, i) => (
          <div key={i} style={{ padding: '6px 8px', marginBottom: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
            <div><strong>{i + 1}.</strong> {c.headline}</div>
            <div className="muted small-note">{c.detail}</div>
          </div>
        )) : <p className="muted small-note">No connections yet — feed it more captures.</p>}
      </div>

      <div style={{ marginTop: 10 }}>
        <strong className="muted small-note">Pattern</strong>
        <p style={{ margin: '4px 0 0 0' }}>{brief.pattern}</p>
      </div>

      <div style={{ marginTop: 10 }}>
        <strong className="muted small-note">Question</strong>
        <p style={{ margin: '4px 0 0 0', fontStyle: 'italic' }}>"{brief.question}"</p>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="ghost small" onClick={() => onUseInsight?.(brief)} title="Save the brief back into the vault as an insight node">
          Save as insight
        </button>
      </div>
    </div>
  );
}

function SynthesisCard({ synth, onUseInsight }) {
  if (!synth) return null;
  const driftCount = synth.drifts?.length || 0;
  return (
    <div className="episodic-synth-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <strong style={{ color: '#a86fdf' }}>
          Weekly Synthesis
          {driftCount > 0 && <span style={{ marginLeft: 8, color: '#ffaaaa', fontSize: 12 }}>· {driftCount} decision drift{driftCount === 1 ? '' : 's'}</span>}
        </strong>
        <span className="muted small-note">{synth.count} captures · {synth.source}</span>
      </div>

      <div>
        <strong className="muted small-note">Emerging thesis</strong>
        <p style={{ margin: '4px 0 0 0' }}>{synth.emergingThesis}</p>
      </div>

      <div style={{ marginTop: 10 }}>
        <strong className="muted small-note">Contradictions & decision drifts</strong>
        {synth.contradictions?.length ? synth.contradictions.map((c, i) => (
          <div key={i} className={c.kind === 'drift' ? 'episodic-drift-card' : ''} style={c.kind === 'drift' ? {} : { padding: '6px 8px', marginTop: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
            <div><strong>{c.headline}</strong></div>
            <div className="muted small-note">{c.detail}</div>
          </div>
        )) : <p className="muted small-note">None detected — your beliefs are aligned this week.</p>}
      </div>

      <div style={{ marginTop: 10 }}>
        <strong className="muted small-note">Knowledge gaps</strong>
        {synth.knowledgeGaps?.length ? synth.knowledgeGaps.map((g, i) => (
          <div key={i} style={{ padding: '6px 8px', marginTop: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
            <div><strong>{g.headline}</strong></div>
            <div className="muted small-note">{g.detail}</div>
          </div>
        )) : <p className="muted small-note">No gaps — every open thread has a follow-up.</p>}
      </div>

      <div style={{ marginTop: 10 }}>
        <strong className="muted small-note">One action</strong>
        <p style={{ margin: '4px 0 0 0', fontStyle: 'italic' }}>{synth.oneAction}</p>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="ghost small" onClick={() => onUseInsight?.(synth)}>
          Save as insight
        </button>
      </div>
    </div>
  );
}

/**
 * Layer 101 — Episodic Cortex.
 *
 * Capture every article, tweet, voice-note transcript, decision, or
 * idea. Each capture flows through Layer 4 (firewall) + Layer 29
 * (affect) + Layer 87 (genre) + the Layer 101 episodic taxonomy and
 * lights up the 3D brain accordingly. Push the same captures through
 * Daily Brief / Weekly Synthesis to make the vault talk back.
 */
export default function EpisodicCortexPanel({ onApplyEpisodic }) {
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [, setTick] = useState(0); // re-render trigger
  const [brief, setBrief] = useState(null);
  const [synth, setSynth] = useState(null);
  const [busy, setBusy] = useState(null); // 'embed' | 'brief' | 'synth' | null
  const [embedReady, setEmbedReady] = useState(embeddingsReady());
  const [autoBriefReady, setAutoBriefReady] = useState(null); // {ok, freshCount} | null
  const [autoSynthReady, setAutoSynthReady] = useState(null);
  const [bookmarkletOpen, setBookmarkletOpen] = useState(false);
  const [voiceState, setVoiceState] = useState('idle'); // 'idle' | 'listening'
  const [ocrProgress, setOcrProgress] = useState(0);
  const voiceSessionRef = useRef(null);
  const ocrInputRef = useRef(null);

  // Consume any deep-link capture on mount (one-shot — params get cleaned up).
  useEffect(() => {
    const cap = consumeDeepLinkCapture();
    if (cap) {
      onApplyEpisodic?.(cap);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeEpisodic(() => setTick((x) => x + 1));
    return () => unsub();
  }, []);

  // Re-render when embeddings warm up
  useEffect(() => {
    if (embedReady) return;
    const t = setInterval(() => {
      if (embeddingsReady()) {
        setEmbedReady(true);
        clearInterval(t);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [embedReady]);

  const captures = useMemo(() => {
    const opts = {};
    if (filter !== 'all') opts.category = filter;
    if (search.trim()) opts.search = search.trim();
    return getCaptures(opts).slice(0, 30);
  }, [filter, search]);

  const allCapturesForGraph = useMemo(() => getCaptures().slice(0, 60), [captures]);
  const stats = useMemo(() => captureStats(), [captures]);
  const streak = useMemo(() => computeStreak(getCaptures()), [captures]);

  // Re-evaluate auto-brief readiness when captures change.
  useEffect(() => {
    const all = getCaptures();
    setAutoBriefReady(shouldRunBrief(all));
    setAutoSynthReady(shouldRunSynthesis(all));
  }, [captures]);

  function handleCapture() {
    const text = draft.trim();
    if (!text) return;
    const cap = addCapture(text, { title: draftTitle.trim() || undefined });
    if (cap) {
      onApplyEpisodic?.(cap);
      setDraft('');
      setDraftTitle('');
    }
  }

  function handleApply(capture) {
    onApplyEpisodic?.(capture);
  }

  function handleDelete(capture) {
    if (!confirm(`Delete "${capture.title}"?`)) return;
    deleteCapture(capture.id);
  }

  function handlePin(capture) {
    togglePinned(capture.id);
  }

  function loadExample(i) {
    const ex = EXAMPLE_CAPTURES[i];
    setDraftTitle(ex.title);
    setDraft(ex.text);
  }

  async function handleOcrPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('ocr');
    setOcrProgress(0);
    try {
      const out = await ocrImage(file, { onProgress: (p) => setOcrProgress(p) });
      if (!out.text) {
        alert('OCR found no text in this image.');
        return;
      }
      const title = (file.name || 'screenshot').replace(/\.[a-zA-Z0-9]{2,5}$/, '').slice(0, 80);
      setDraftTitle((t) => t || title);
      setDraft((d) => (d ? `${d}\n\n${out.text}` : out.text));
    } catch (err) {
      alert(`OCR error: ${err.message || err}`);
    } finally {
      setBusy(null);
      setOcrProgress(0);
      if (ocrInputRef.current) ocrInputRef.current.value = '';
    }
  }

  function handleVoiceToggle() {
    if (voiceState === 'listening') {
      voiceSessionRef.current?.stop();
      return;
    }
    const session = createSpeechSession({ lang: 'en-US', continuous: true });
    if (!session.supported) {
      alert('Web Speech API not supported in this browser. Try Chrome / Edge / Safari.');
      return;
    }
    voiceSessionRef.current = session;
    setVoiceState('listening');
    session.start((evt) => {
      if (evt.error) {
        setVoiceState('idle');
        alert(`Voice capture error: ${evt.error}`);
        return;
      }
      if (evt.state === 'stopped') {
        setVoiceState('idle');
        // session.stop already gives us the final transcript via evt.final
        if (evt.final) setDraft((d) => (d ? `${d} ${evt.final}` : evt.final));
        return;
      }
      if (evt.final || evt.interim) {
        setDraft(((evt.final || '') + (evt.interim ? ` ${evt.interim}` : '')).trim());
      }
    });
  }

  async function handleWarmEmbed() {
    setBusy('embed');
    try {
      if (!embeddingsReady()) await initEmbeddings();
      setEmbedReady(true);
      const res = await ensureAllEmbeddings();
      alert(res.ok ? `Embedded ${res.done}/${res.total} captures.` : `Embedding paused: ${res.reason}`);
    } catch (err) {
      alert(`Embedding error: ${err.message || err}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleBrief() {
    setBusy('brief');
    try {
      const all = getCaptures();
      const result = await dailyBrief(all);
      setBrief(result);
      recordBrief(result, all.length);
      setAutoBriefReady(shouldRunBrief(all));
    } finally {
      setBusy(null);
    }
  }

  async function handleSynthesis() {
    setBusy('synth');
    try {
      const all = getCaptures();
      const result = await weeklySynthesis(all);
      // Augment with decision-drift detector before rendering.
      const drifts = detectDecisionDrifts(all, { topK: 3 });
      const driftCards = drifts.map(formatDrift).filter(Boolean);
      const enriched = {
        ...result,
        contradictions: [...(result.contradictions || []), ...driftCards].slice(0, 5),
        drifts
      };
      setSynth(enriched);
      recordSynthesis(enriched);
      setAutoSynthReady(shouldRunSynthesis(all));
    } finally {
      setBusy(null);
    }
  }

  function handleSaveBriefAsInsight(b) {
    if (!b) return;
    const lines = [];
    lines.push(`# Daily Brief — ${new Date().toISOString().slice(0, 10)}`);
    lines.push(`Pattern: ${b.pattern}`);
    lines.push(`Question: ${b.question}`);
    if (b.connections?.length) {
      lines.push('Connections:');
      b.connections.forEach((c, i) => lines.push(`${i + 1}. ${c.headline} — ${c.detail}`));
    }
    addInsight(lines.join('\n'), { title: `Brief · ${new Date().toISOString().slice(0, 10)}` });
  }

  function handleSaveSynthAsInsight(s) {
    if (!s) return;
    const lines = [];
    lines.push(`# Weekly Synthesis — ${new Date().toISOString().slice(0, 10)}`);
    lines.push(`Thesis: ${s.emergingThesis}`);
    lines.push(`Action: ${s.oneAction}`);
    if (s.contradictions?.length) {
      lines.push('Contradictions:');
      s.contradictions.forEach((c, i) => lines.push(`${i + 1}. ${c.headline} — ${c.detail}`));
    }
    if (s.knowledgeGaps?.length) {
      lines.push('Gaps:');
      s.knowledgeGaps.forEach((g, i) => lines.push(`${i + 1}. ${g.headline} — ${g.detail}`));
    }
    addInsight(lines.join('\n'), { title: `Synthesis · ${new Date().toISOString().slice(0, 10)}` });
  }

  function handleExport() {
    const bundle = exportEpisodicBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-episodic-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bundle = JSON.parse(String(reader.result));
        const res = importEpisodicBundle(bundle, { merge: true });
        if (res.ok) alert(`Imported. Total captures: ${res.count}`);
        else alert(`Import failed: ${res.reason}`);
      } catch (err) {
        alert(`Bad bundle: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  function handleWipe() {
    if (!confirm('Wipe ALL episodic captures? This cannot be undone.')) return;
    clearAllCaptures();
    setBrief(null);
    setSynth(null);
  }

  const gemmaOn = isGemmaConfigured();

  return (
    <section className="panel panel-pad episodic-cortex-panel">
      <div className="eyebrow">Layer 101 · episodic cortex</div>
      <h2>The vault that talks back</h2>
      <p className="muted">
        Drop articles, tweets, voice-note transcripts, decisions, or shower-thought ideas.
        Each capture flows through the firewall, the affect decoder, and an 8-way
        episodic router — then lights up the 3D brain. Two outputs make the vault
        push insights back: <strong>Daily Brief</strong> (connections / pattern /
        question) and <strong>Weekly Synthesis</strong> (thesis / contradictions /
        gaps / one action). Local-only by default; <em>Gemma upgrades the synthesis
        prompts when configured</em>{gemmaOn ? ' — and it is configured.' : '.'}
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 4, marginBottom: 8 }}>
        <span className="muted small-note">Try:</span>
        {EXAMPLE_CAPTURES.map((ex, i) => (
          <button key={i} className="ghost small" onClick={() => loadExample(i)}>
            {ex.title.length > 32 ? ex.title.slice(0, 32) + '…' : ex.title}
          </button>
        ))}
      </div>

      <input
        type="text"
        className="share-input"
        placeholder="Title (optional — inferred from first line if blank)"
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value.slice(0, 120))}
        maxLength={120}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <textarea
        className="firewall-input"
        placeholder="Paste an article, a tweet, a thought, a decision, a meeting note..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
      />

      <div className="control-actions" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={handleCapture} disabled={!draft.trim()}>
          Capture →
        </button>
        <button className="btn" onClick={handleBrief} disabled={busy === 'brief' || stats.total < 1}>
          {busy === 'brief' ? 'Briefing…' : 'Daily Brief'}
        </button>
        <button className="btn" onClick={handleSynthesis} disabled={busy === 'synth' || stats.total < 3}>
          {busy === 'synth' ? 'Synthesizing…' : 'Weekly Synthesis'}
        </button>
        {isSpeechSupported() && (
          <button
            className={voiceState === 'listening' ? 'btn primary' : 'ghost small'}
            onClick={handleVoiceToggle}
            title="Web Speech API live transcription into the capture draft"
            style={voiceState === 'listening' ? { background: '#ff4066', color: '#fff' } : {}}
          >
            {voiceState === 'listening' ? '● Stop voice' : '🎙 Voice capture'}
          </button>
        )}
        <label className="ghost small" style={{ cursor: 'pointer' }} title="Tesseract.js OCR — paste a screenshot text into the draft">
          {busy === 'ocr' ? `OCR ${Math.round(ocrProgress * 100)}%` : '◳ OCR image'}
          <input
            ref={ocrInputRef}
            type="file"
            accept="image/*"
            onChange={handleOcrPick}
            style={{ display: 'none' }}
            disabled={busy === 'ocr'}
          />
        </label>
        <button
          className="ghost small"
          onClick={handleWarmEmbed}
          disabled={busy === 'embed'}
          title={embedReady ? 'Embed any capture without a vector' : 'Load MiniLM (~25MB) and embed all captures'}
        >
          {busy === 'embed' ? 'Embedding…' : embedReady ? '↻ Re-embed' : '⇣ Warm embeddings'}
        </button>
      </div>

      {(autoBriefReady?.ok || autoSynthReady?.ok) && (
        <div className="episodic-autobrief-banner">
          <span>
            <strong>The vault is ready to talk back.</strong>{' '}
            {autoBriefReady?.ok && <>Daily brief unlocked ({autoBriefReady.freshCount} fresh captures). </>}
            {autoSynthReady?.ok && <>Weekly synthesis unlocked ({autoSynthReady.weeklyCount} this week). </>}
          </span>
          <span style={{ display: 'flex', gap: 6 }}>
            {autoBriefReady?.ok && (
              <button className="btn" onClick={handleBrief} disabled={busy === 'brief'}>
                Run brief
              </button>
            )}
            {autoSynthReady?.ok && (
              <button className="btn" onClick={handleSynthesis} disabled={busy === 'synth'}>
                Run synthesis
              </button>
            )}
          </span>
        </div>
      )}

      <BriefCard brief={brief} onUseInsight={handleSaveBriefAsInsight} />
      <SynthesisCard synth={synth} onUseInsight={handleSaveSynthAsInsight} />

      <div className="episodic-stats">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>Timeline</strong>
          <span className={`episodic-streak-tile${streak.current ? '' : ' cold'}`} title={`Longest: ${streak.longest}d · ${streak.totalDays} active days total`}>
            {streakLabel(streak)}{streak.todayCaptures ? ` · ${streak.todayCaptures} today` : ''}
          </span>
        </div>
        <span className="muted small-note">
          {stats.total} total · {stats.last24h} last 24h · {stats.last7d} this week · mean pressure {Math.round(stats.meanPressure * 100)}%
          {stats.dreamConsolidated > 0 && ` · ${stats.dreamConsolidated} dream-reinforced`}
        </span>
      </div>

      <EpisodicGraph captures={allCapturesForGraph} height={150} />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button
          className={`ghost small ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
          style={filter === 'all' ? { borderColor: '#5ad4ff', color: '#5ad4ff' } : {}}
        >
          all ({stats.total})
        </button>
        {EPISODIC_IDS.map((id) => {
          const cat = EPISODIC_CATEGORIES[id];
          const n = stats.byCategory[id] || 0;
          return (
            <button
              key={id}
              className="ghost small"
              onClick={() => setFilter(id)}
              style={filter === id ? { borderColor: cat.color, color: cat.color } : { color: 'inherit', opacity: n ? 1 : 0.5 }}
              title={cat.description}
            >
              {cat.icon} {cat.label} ({n})
            </button>
          );
        })}
      </div>

      <input
        type="text"
        className="share-input"
        placeholder="Search title / text / @mention / #tag..."
        value={search}
        onChange={(e) => setSearch(e.target.value.slice(0, 100))}
        style={{ width: '100%', marginBottom: 8 }}
      />

      {captures.length > 0 ? (
        captures.map((c) => (
          <CaptureCard
            key={c.id}
            capture={c}
            onApply={handleApply}
            onDelete={handleDelete}
            onPin={handlePin}
          />
        ))
      ) : (
        <p className="muted small-note">No captures match the current filter. Drop one above to feed the vault.</p>
      )}

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
          <strong style={{ fontSize: 12 }}>Auto-brief schedule</strong>
          <span className="muted small-note">
            next brief in <strong>{nextBriefRelative()}</strong> · next synthesis in <strong>{nextSynthesisRelative()}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="ghost small" onClick={() => setBookmarkletOpen((v) => !v)}>
            {bookmarkletOpen ? '× Hide bookmarklet' : '↗ Capture bookmarklet'}
          </button>
          <button className="ghost small" onClick={handleExport} disabled={!stats.total}>
            Export bundle
          </button>
          <label className="ghost small" style={{ cursor: 'pointer' }}>
            Import bundle
            <input type="file" accept="application/json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <button className="ghost small" onClick={handleWipe} disabled={!stats.total} style={{ marginLeft: 'auto', color: '#ff8a96' }}>
            Wipe all
          </button>
        </div>

        {bookmarkletOpen && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)' }}>
            <p className="muted small-note" style={{ marginTop: 0 }}>
              Drag the link below into your bookmarks bar. Selecting any text on any
              page and clicking the bookmarklet opens BrainSNN with the selection
              pre-captured into the Episodic Cortex.
            </p>
            <a
              href={bookmarkletSource(typeof window !== 'undefined' ? window.location.origin : '')}
              draggable="true"
              onClick={(e) => e.preventDefault()}
              style={{
                display: 'inline-block', padding: '6px 12px', borderRadius: 6,
                background: 'linear-gradient(90deg,#5ad4ff,#a86fdf)',
                color: '#0c0e16', fontWeight: 600, textDecoration: 'none', cursor: 'grab'
              }}
            >
              ↗ Capture to BrainSNN
            </a>
            <p className="muted small-note" style={{ marginBottom: 0, marginTop: 8 }}>
              Deep-link contract: <code>?capture=&lt;text&gt;</code>{' '}
              <code>?capture-url=&lt;url&gt;</code>{' '}
              <code>?capture-title=&lt;title&gt;</code>.
              Used by the bookmarklet, the MCP relay, and any external integration.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
