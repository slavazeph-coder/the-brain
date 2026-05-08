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
  importEpisodicBundle,
  findSimilar,
  findBacklinks,
  rewriteCapture
} from '../utils/episodicMemory';
import { captureToBrainState } from '../utils/episodicRouter';
import { redactPII } from '../utils/episodicPII';
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
import { askTheVault } from '../utils/episodicAsk';
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

function CaptureCard({ capture, onApply, onDelete, onPin, onFocus, onRedact }) {
  const cat = EPISODIC_CATEGORIES[capture.primary];
  const fwPct = Math.round((capture.firewall?.pressure || 0) * 100);
  const affChip = capture.affects?.dominant?.[0];
  const [similar, setSimilar] = useState(null);
  const primaryScore = capture.classification?.scores?.[capture.primary]?.score || 0;
  const weak = (capture.classification?.dominant?.length || 0) === 0
    || (capture.primary === 'artifact' && primaryScore < 0.18);

  function toggleSimilar() {
    if (similar !== null) { setSimilar(null); return; }
    const cosineHits = findSimilar(capture.id, { k: 3, minScore: 0.30 })
      .map((h) => ({ ...h, kind: 'cosine' }));
    const linkHits = findBacklinks(capture.id, { k: 3 })
      .map((h) => ({ ...h, kind: 'link' }));
    // Merge, dedup by id, prefer cosine.
    const seen = new Set();
    const merged = [];
    for (const h of [...cosineHits, ...linkHits]) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      merged.push(h);
    }
    setSimilar(merged.slice(0, 6));
  }

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
        {capture.pii?.total > 0 && (
          <span
            className="firewall-chip"
            style={{ borderColor: '#ff8a96', color: '#ff8a96' }}
            title={`Detected ${capture.pii.total} PII / secret match${capture.pii.total === 1 ? '' : 'es'}: ${capture.pii.kinds?.join(', ')}`}
          >
            🔒 PII: {capture.pii.first}
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
      {weak && (
        <p className="muted small-note" style={{ margin: '4px 0 0 0', fontStyle: 'italic', opacity: 0.7 }}>
          Weak signal — no triggers fired. Add a verb (decided / regret / wondering / shipped) or an @mention to help the brain place this note.
        </p>
      )}
      <div className="episodic-card-actions">
        <button className="ghost small" onClick={() => onApply?.(capture)} title="Push this capture's region activation to the 3D brain">
          → Brain
        </button>
        <button className="ghost small" onClick={toggleSimilar} title="Find captures most similar to this one (cosine via MiniLM, lexical fallback)">
          ≈ similar
        </button>
        {capture.pii?.total > 0 && (
          <button
            className="ghost small"
            onClick={() => onRedact?.(capture)}
            title={`Replace ${capture.pii.total} PII / secret match${capture.pii.total === 1 ? '' : 'es'} with typed placeholders`}
            style={{ color: '#ff8a96' }}
          >
            ✂ redact
          </button>
        )}
        <button className="ghost small" onClick={() => onPin?.(capture)}>
          {capture.pinned ? '★ pinned' : '☆ pin'}
        </button>
        <button className="ghost small" onClick={() => onDelete?.(capture)}>
          delete
        </button>
      </div>
      {similar && (
        <div style={{ marginTop: 6 }}>
          {similar.length === 0 && (
            <p className="muted small-note" style={{ margin: 0 }}>
              No related captures yet (try Warm embeddings, or capture more notes that mention the same person / link).
            </p>
          )}
          {similar.map((s) => (
            <button
              key={s.id}
              className="ghost small"
              onClick={() => onFocus?.(s.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4, padding: '4px 8px', fontSize: 11 }}
              title={s.kind === 'link' ? `Linked via ${s.shared?.join(', ')}` : 'Cosine similarity'}
            >
              <span className="muted">{s.kind === 'link' ? '↔' : '≈'} {s.score.toFixed(2)}</span>{' '}
              <strong>{s.capture.title.slice(0, 65)}</strong>
              {s.kind === 'link' && s.shared && (
                <span className="muted" style={{ marginLeft: 6 }}>· {s.shared.slice(0, 2).join(' ')}</span>
              )}
            </button>
          ))}
        </div>
      )}
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
  const [askDraft, setAskDraft] = useState('');
  const [askResult, setAskResult] = useState(null);
  const [streakPulse, setStreakPulse] = useState(null); // { current, longest } | null
  const [autoRun, setAutoRun] = useState(() => {
    try { return localStorage.getItem('brainsnn_episodic_autorun_v1') === '1'; } catch { return false; }
  });
  const voiceSessionRef = useRef(null);
  const ocrInputRef = useRef(null);
  const cardRefs = useRef(new Map());

  // Consume any deep-link capture on mount (one-shot — params get cleaned up).
  useEffect(() => {
    const cap = consumeDeepLinkCapture();
    if (cap) {
      onApplyEpisodic?.(cap);
    }
  }, []);

  // Cleanup voice session on unmount so the mic doesn't stay hot if the
  // panel unmounts (route change, error boundary recover) while listening.
  useEffect(() => () => {
    try { voiceSessionRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  // Quietly warm MiniLM embeddings ~12 seconds after the panel mounts IF
  // the user already has captures and is in a fast environment (best-
  // effort — failures are silent; the lexical fallback always works).
  useEffect(() => {
    if (embedReady) return;
    const stats0 = captureStats();
    if (stats0.total < 5) return;
    const t = setTimeout(() => {
      initEmbeddings()
        .then(() => ensureAllEmbeddings())
        .then(() => setEmbedReady(true))
        .catch(() => { /* graceful — fall back to lexical */ });
    }, 12_000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const list = getCaptures(opts);
    // Pinned float to the top, then chronological desc.
    list.sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return b.ts - a.ts;
    });
    return list.slice(0, 30);
  }, [filter, search]);

  const allCapturesForGraph = useMemo(() => getCaptures().slice(0, 60), [captures]);
  const stats = useMemo(() => captureStats(), [captures]);
  const streak = useMemo(() => computeStreak(getCaptures()), [captures]);

  // Re-evaluate auto-brief readiness when captures change AND on a slow
  // interval so a panel left open across midnight (or after the cooldown
  // window expires) catches up without waiting for the next capture.
  useEffect(() => {
    const refresh = () => {
      const all = getCaptures();
      setAutoBriefReady(shouldRunBrief(all));
      setAutoSynthReady(shouldRunSynthesis(all));
    };
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [captures]);

  // Background auto-run — opt-in via a toggle, persisted. When the brief
  // becomes ready, wait 45s (so the user isn't interrupted mid-thought)
  // then run silently. The timer is cancelled on:
  //   - manual capture via Capture button
  //   - the user typing in the draft / title / ask boxes
  //   - any subsequent re-render that toggles busy / brief state.
  useEffect(() => {
    if (!autoRun) return;
    if (busy) return;
    if (draft.trim() || askDraft.trim()) return; // user is mid-typing
    let timer = null;
    if (autoBriefReady?.ok && !brief) {
      timer = setTimeout(() => { handleBrief(); }, 45_000);
    } else if (autoSynthReady?.ok && !synth) {
      timer = setTimeout(() => { handleSynthesis(); }, 60_000);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [autoRun, autoBriefReady?.ok, autoSynthReady?.ok, busy, brief, synth, draft, askDraft]);

  function toggleAutoRun() {
    setAutoRun((v) => {
      const next = !v;
      try { localStorage.setItem('brainsnn_episodic_autorun_v1', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }

  function handleCapture() {
    const text = draft.trim();
    if (!text) return;
    const before = computeStreak(getCaptures());
    const cap = addCapture(text, { title: draftTitle.trim() || undefined });
    if (cap) {
      onApplyEpisodic?.(cap);
      setDraft('');
      setDraftTitle('');
      // First capture of a new UTC day → pulse a streak banner for 6s.
      const after = computeStreak(getCaptures());
      if (after.current > before.current) {
        setStreakPulse({ current: after.current, longest: after.longest });
        setTimeout(() => setStreakPulse(null), 6000);
      }
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

  function handleRedact(capture) {
    if (!capture?.id || !(capture.pii?.total > 0)) return;
    if (!confirm(`Replace ${capture.pii.total} PII / secret match${capture.pii.total === 1 ? '' : 'es'} in "${capture.title}" with typed placeholders? Original text will be lost.`)) return;
    const redacted = redactPII(capture.text);
    rewriteCapture(capture.id, redacted);
  }

  function loadExample(i) {
    const ex = EXAMPLE_CAPTURES[i];
    setDraftTitle(ex.title);
    setDraft(ex.text);
  }

  async function handleAsk() {
    const q = askDraft.trim();
    if (!q) return;
    setBusy('ask');
    try {
      const res = await askTheVault(q);
      setAskResult(res);
    } finally {
      setBusy(null);
    }
  }

  function focusCapture(id) {
    const el = cardRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.boxShadow = '0 0 0 2px #5ad4ff';
    setTimeout(() => { if (el) el.style.boxShadow = ''; }, 1400);
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
            aria-pressed={voiceState === 'listening'}
            aria-label={voiceState === 'listening' ? 'Stop voice capture' : 'Start voice capture'}
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

      {streakPulse && (
        <div className="episodic-autobrief-banner" role="status" aria-live="polite" style={{ borderColor: 'rgba(94,230,154,0.5)', background: 'linear-gradient(90deg, rgba(94,230,154,0.10), rgba(255,212,138,0.10))' }}>
          <span>
            <strong style={{ color: '#5ee69a' }}>
              {streakPulse.current === 1 ? '🌱 Streak started' : `🔥 ${streakPulse.current}-day streak — kept alive`}
            </strong>
            {streakPulse.longest > streakPulse.current && (
              <span className="muted small-note" style={{ marginLeft: 8 }}>longest: {streakPulse.longest}d</span>
            )}
          </span>
        </div>
      )}

      {(autoBriefReady?.ok || autoSynthReady?.ok) && (
        <div className="episodic-autobrief-banner" role="status" aria-live="polite">
          <span>
            <strong>The vault is ready to talk back.</strong>{' '}
            {autoBriefReady?.ok && <>Daily brief unlocked ({autoBriefReady.freshCount} fresh captures). </>}
            {autoSynthReady?.ok && <>Weekly synthesis unlocked ({autoSynthReady.weeklyCount} this week). </>}
            {autoRun && <em>· auto-run on</em>}
          </span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }} title="Run brief / synthesis automatically 45s after they unlock">
              <input type="checkbox" checked={autoRun} onChange={toggleAutoRun} />
              auto-run
            </label>
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

      <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: 'rgba(255,212,138,0.06)', border: '1px solid rgba(255,212,138,0.22)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <strong style={{ color: '#ffd48a' }}>Ask the vault</strong>
          <span className="muted small-note">RAG over your captures · {embedReady ? 'cosine' : 'lexical fallback'}{isGemmaConfigured() ? ' + Gemma' : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="share-input"
            placeholder='What did I think about Postgres last week? · Why am I saving fear-coded posts? · Decisions I have not committed to'
            value={askDraft}
            onChange={(e) => setAskDraft(e.target.value.slice(0, 240))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAsk(); }}
            style={{ flex: 1 }}
          />
          <button className="btn primary" onClick={handleAsk} disabled={busy === 'ask' || !askDraft.trim()}>
            {busy === 'ask' ? 'Searching…' : 'Ask →'}
          </button>
        </div>
        {askResult?.ok && (
          <div style={{ marginTop: 10 }}>
            <p style={{ margin: 0 }}>{askResult.answer}</p>
            {askResult.hits?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong className="muted small-note">Top {askResult.hits.length} hits</strong>
                {askResult.hits.map((h, i) => (
                  <button
                    key={h.capture.id}
                    className="ghost small"
                    onClick={() => focusCapture(h.capture.id)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4, padding: '6px 8px', background: 'rgba(255,255,255,0.03)' }}
                  >
                    <span className="muted" style={{ fontSize: 11 }}>{i + 1}.</span>{' '}
                    <strong>{h.capture.title.slice(0, 70)}</strong>{' '}
                    <span className="muted small-note">— {h.score.toFixed(2)} · {EPISODIC_CATEGORIES[h.capture.primary]?.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {askResult && !askResult.ok && (
          <p className="muted small-note" style={{ marginTop: 8 }}>
            {askResult.reason === 'empty-vault' ? 'Capture some notes first — the vault is empty.'
              : askResult.reason === 'question-too-short' ? 'Type a longer question.'
              : `No match: ${askResult.reason}`}
          </p>
        )}
      </div>

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
          {stats.withPII > 0 && (
            <span style={{ color: '#ff8a96', marginLeft: 6 }} title="Captures containing email / phone / API key / SSN / IP">
              · 🔒 {stats.withPII} flagged for PII
            </span>
          )}
        </span>
      </div>

      <EpisodicGraph
        captures={allCapturesForGraph}
        height={150}
        onNodeClick={focusCapture}
      />

      <div className="episodic-pill-row" role="tablist" aria-label="Filter captures by episodic category">
        <button
          role="tab"
          aria-selected={filter === 'all'}
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
              role="tab"
              aria-selected={filter === id}
              className="ghost small"
              onClick={() => setFilter(id)}
              style={filter === id ? { borderColor: cat.color, color: cat.color } : { color: 'inherit', opacity: n ? 1 : 0.5 }}
              title={cat.description}
              aria-label={`Filter by ${cat.label}, ${n} captures`}
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
          <div key={c.id} ref={(el) => { if (el) cardRefs.current.set(c.id, el); else cardRefs.current.delete(c.id); }}>
            <CaptureCard
              capture={c}
              onApply={handleApply}
              onDelete={handleDelete}
              onPin={handlePin}
              onFocus={focusCapture}
              onRedact={handleRedact}
            />
          </div>
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
