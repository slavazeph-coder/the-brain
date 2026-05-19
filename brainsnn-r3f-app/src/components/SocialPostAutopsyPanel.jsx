import React, { useMemo, useRef, useState } from 'react';
import { ocrImage } from '../utils/ocr';
import { archiveScan } from '../utils/scanArchive';
import {
  SAMPLE_SOCIAL_POST,
  analyzeSocialPost,
  buildSocialPostReport,
  buildSocialPostSharePayload,
  decodeSocialPostShare,
  socialPostShareUrl,
  socialPostOgUrl,
} from '../utils/socialPostAutopsy';

function readSharedSocialPost() {
  try {
    const hash = new URLSearchParams(window.location.search).get('s');
    return hash ? decodeSocialPostShare(hash) : null;
  } catch {
    return null;
  }
}

/**
 * Layer 103 — Social Post Autopsy panel.
 *
 * Paste an Instagram / TikTok / X / LinkedIn caption, add OCR text from
 * carousel screenshots, then run the post through the Firewall + Affective
 * Decoder + viral-mechanic detector as one social-native report.
 */
export default function SocialPostAutopsyPanel() {
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [slidesText, setSlidesText] = useState('');
  const [report, setReport] = useState(null);
  const [sharedPayload, setSharedPayload] = useState(() => readSharedSocialPost());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(() => (readSharedSocialPost() ? 'Loaded shared Social Post Autopsy card' : ''));
  const [err, setErr] = useState('');
  const fileInputRef = useRef(null);

  const canAnalyze = useMemo(
    () => Boolean(url.trim() || caption.trim() || slidesText.trim()),
    [url, caption, slidesText],
  );

  const sharePayload = useMemo(() => buildSocialPostSharePayload(report), [report]);
  const shareUrl = useMemo(
    () => (sharePayload ? socialPostShareUrl(window.location.origin, sharePayload) : ''),
    [sharePayload],
  );
  const verticalOgUrl = useMemo(
    () => (sharePayload ? socialPostOgUrl(window.location.origin, sharePayload, { vertical: true }) : ''),
    [sharePayload],
  );
  const sharedVerticalOgUrl = useMemo(
    () => (sharedPayload ? socialPostOgUrl(window.location.origin, sharedPayload, { vertical: true }) : ''),
    [sharedPayload],
  );
  const sharedShareUrl = useMemo(
    () => (sharedPayload ? socialPostShareUrl(window.location.origin, sharedPayload) : ''),
    [sharedPayload],
  );

  function runAnalysis() {
    if (!canAnalyze) return;
    setErr('');
    setSharedPayload(null);
    const next = analyzeSocialPost({ url, caption, slidesText });
    setReport(next);
    setStatus(`Analyzed ${next.platform.label} post · ${Math.round(next.pressure * 100)}% pressure`);
  }

  function loadSample() {
    setSharedPayload(null);
    setUrl(SAMPLE_SOCIAL_POST.url);
    setCaption(SAMPLE_SOCIAL_POST.caption);
    setSlidesText(SAMPLE_SOCIAL_POST.slidesText);
    setReport(analyzeSocialPost(SAMPLE_SOCIAL_POST));
    setStatus('Loaded sample social-post autopsy');
  }

  async function handleFiles(files) {
    const list = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setSharedPayload(null);
    setBusy(true);
    setErr('');
    setStatus(`OCR running on ${list.length} screenshot${list.length === 1 ? '' : 's'}…`);
    try {
      const chunks = [];
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        setStatus(`OCR ${i + 1}/${list.length}: ${file.name}`);
        // eslint-disable-next-line no-await-in-loop
        const { text, confidence } = await ocrImage(file, {
          onProgress: (p) => setStatus(`OCR ${i + 1}/${list.length}: ${Math.round(p * 100)}%`),
        });
        chunks.push(`Slide ${i + 1}: ${String(text || '').trim()}\n[OCR confidence: ${Math.round(confidence)}%]`);
      }
      setSlidesText((prev) => [prev.trim(), chunks.join('\n\n---\n\n')].filter(Boolean).join('\n\n---\n\n'));
      setStatus(`OCR complete · added ${chunks.length} slide${chunks.length === 1 ? '' : 's'}`);
    } catch (e) {
      setErr(e?.message || 'OCR failed');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function copyText(text, okLabel) {
    if (!text) return;
    if (!navigator.clipboard?.writeText) {
      window.prompt('Copy:', text);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => setStatus(okLabel),
      () => window.prompt('Copy:', text),
    );
  }

  function copyReport() {
    copyText(buildSocialPostReport(report), 'Report copied');
  }

  function copyShareCard() {
    copyText(shareUrl, 'Share card link copied');
  }

  function copyVerticalImage() {
    copyText(verticalOgUrl, 'Vertical image URL copied');
  }

  function copySharedShareCard() {
    copyText(sharedShareUrl, 'Shared card link copied');
  }

  function copySharedVerticalImage() {
    copyText(sharedVerticalOgUrl, 'Shared vertical image URL copied');
  }

  function scanInFirewall() {
    const text = report?.combinedText || [caption, slidesText].filter(Boolean).join('\n\n');
    if (!text.trim()) return;
    window.location.href = `${window.location.origin}/?scan=${encodeURIComponent(text.slice(0, 4000))}`;
  }

  function saveToArchive() {
    if (!report) return;
    const entry = archiveScan({
      text: report.combinedText,
      score: report.firewall,
      receipt: { id: `sp_${Date.now().toString(36)}` },
      entity: report.handle || report.platform.id,
      tags: [
        'social-post-autopsy',
        report.platform.id,
        report.tier.id,
        ...report.mechanics.slice(0, 4).map((m) => m.id),
      ],
    });
    setStatus(`Archived as ${entry.id}`);
  }

  return (
    <section className="panel panel-pad social-post-autopsy-panel">
      <div className="eyebrow">Layer 103 · social post autopsy</div>
      <h2>Autopsy an Instagram / TikTok / X post</h2>
      <p className="muted">
        Paste a social URL, caption, and carousel OCR text. Or upload screenshots
        and BrainSNN will OCR the slides locally, then detect the viewer install:
        the affect, viral mechanics, pressure spike, and share-risk pattern.
      </p>

      {sharedPayload && (
        <SharedSocialPostCard
          payload={sharedPayload}
          onCopyShare={copySharedShareCard}
          onCopyVertical={copySharedVerticalImage}
          onNewScan={() => {
            setSharedPayload(null);
            setStatus('Ready for a new Social Post Autopsy');
          }}
        />
      )}

      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <input
          className="share-input"
          placeholder="Post URL — Instagram / TikTok / X / LinkedIn / YouTube"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <textarea
          className="firewall-input"
          placeholder="Caption, transcript, or visible post copy…"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
        />
        <textarea
          className="firewall-input"
          placeholder="Carousel OCR text. Separate slides with --- or label them Slide 1:, Slide 2:, etc."
          value={slidesText}
          onChange={(e) => setSlidesText(e.target.value)}
          rows={6}
        />
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={runAnalysis} disabled={!canAnalyze || busy}>
          Analyze post
        </button>
        <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          OCR carousel screenshots
        </button>
        <button className="btn" onClick={loadSample} disabled={busy}>
          Load sample
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
      </div>

      {(status || err) && (
        <p className="muted small-note" style={{ marginTop: 8, color: err ? '#dd6974' : undefined }}>
          {err ? `Error: ${err}` : status}
        </p>
      )}

      {report && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.035)',
              borderLeft: `4px solid ${report.tier.color}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="eyebrow">{report.platform.label}{report.handle ? ` · ${report.handle}` : ''}</div>
                <h3 style={{ margin: '2px 0 4px' }}>{report.tier.label}</h3>
                <p className="muted" style={{ margin: 0 }}>{report.viewerInstall}</p>
              </div>
              <strong style={{ color: report.tier.color, fontSize: 28, lineHeight: 1 }}>
                {Math.round(report.pressure * 100)}%
              </strong>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
            <ResultCard title="Dominant affect">
              {report.affect?.dominant?.length ? (
                report.affect.dominant.map((a) => (
                  <Chip key={a.id} label={`${a.label} · ${Math.round(a.score * 100)}%`} />
                ))
              ) : <span className="muted small-note">Neutral / low signal</span>}
            </ResultCard>

            <ResultCard title="Viral mechanics">
              {report.mechanics.length ? report.mechanics.slice(0, 6).map((m) => (
                <Chip key={m.id} label={`${m.label} ×${m.hits}`} title={m.desc} />
              )) : <span className="muted small-note">None detected</span>}
            </ResultCard>

            <ResultCard title="Propaganda templates">
              {report.firewall?.templates?.length ? report.firewall.templates.slice(0, 6).map((t) => (
                <Chip key={t.id || t.label} label={`${t.label || t.id} ×${t.hits || 1}`} />
              )) : <span className="muted small-note">None detected</span>}
            </ResultCard>
          </div>

          {report.slides.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow">Carousel pressure map</div>
              {report.slides.map((slide) => {
                const tone = slide.pressure >= 0.55 ? '#dd6974' : slide.pressure >= 0.28 ? '#fdab43' : '#6daa45';
                return (
                  <div
                    key={slide.index}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '72px 1fr 72px',
                      gap: 10,
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.025)',
                      marginTop: 5,
                    }}
                  >
                    <strong>Slide {slide.index}</strong>
                    <div>
                      <div style={{ width: '100%', height: 7, background: '#1a1f2e', borderRadius: 999 }}>
                        <div style={{ width: `${Math.round(slide.pressure * 100)}%`, height: '100%', background: tone, borderRadius: 999 }} />
                      </div>
                      <p className="muted small-note" style={{ margin: '4px 0 0' }}>
                        {slide.title} · {slide.dominantAffect}{slide.mechanics.length ? ` · ${slide.mechanics.join(', ')}` : ''}
                      </p>
                    </div>
                    <span style={{ color: tone, fontFamily: 'monospace', textAlign: 'right' }}>
                      {Math.round(slide.pressure * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {shareUrl && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(90,212,255,0.04)', border: '1px solid rgba(90,212,255,0.12)' }}>
              <div className="eyebrow">Share artifact</div>
              <p className="muted small-note" style={{ margin: '4px 0 0' }}>
                Public card route: <code>/s/&lt;hash&gt;</code>. Vertical image: <code>/api/social-og?size=vertical</code>.
              </p>
              <input className="share-input" value={shareUrl} readOnly style={{ marginTop: 6 }} onFocus={(e) => e.target.select()} />
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div className="eyebrow">Recommended checks</div>
            <ul className="muted" style={{ marginTop: 4, paddingLeft: 20 }}>
              {report.recommendations.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>

          <div className="control-actions" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={scanInFirewall}>Scan combined text in Firewall →</button>
            <button className="btn" onClick={copyShareCard}>Copy share card</button>
            <button className="btn" onClick={copyVerticalImage}>Copy vertical image</button>
            <button className="btn" onClick={saveToArchive}>Archive autopsy</button>
            <button className="btn" onClick={copyReport}>Copy report</button>
          </div>
        </div>
      )}
    </section>
  );
}

function SharedSocialPostCard({ payload, onCopyShare, onCopyVertical, onNewScan }) {
  const tone = payload.p >= 0.72 ? '#dd6974' : payload.p >= 0.45 ? '#fdab43' : payload.p >= 0.22 ? '#d7c54f' : '#6daa45';
  const mechanics = Array.isArray(payload.vm) ? payload.vm : [];
  const slides = Array.isArray(payload.sl) ? payload.sl : [];

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: 'rgba(90,212,255,0.045)', border: `1px solid ${tone}55`, borderLeft: `4px solid ${tone}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Shared Social Post Autopsy · {payload.pl || 'Social post'}{payload.hd ? ` · ${payload.hd}` : ''}</div>
          <h3 style={{ margin: '2px 0 4px' }}>{Math.round((payload.p || 0) * 100)}% pressure · {payload.af || 'Attention'}</h3>
          <p className="muted" style={{ margin: 0 }}>{payload.vi || 'Shared BrainSNN social-post scan.'}</p>
        </div>
        <strong style={{ color: tone, fontSize: 28, lineHeight: 1 }}>
          {Math.round((payload.p || 0) * 100)}%
        </strong>
      </div>

      {mechanics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {mechanics.map((m) => <Chip key={m} label={m} />)}
        </div>
      )}

      {payload.tx && (
        <p className="muted" style={{ marginTop: 10, fontStyle: 'italic' }}>
          “{payload.tx}”
        </p>
      )}

      {slides.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow">Shared slide pressure</div>
          {slides.map((slide, idx) => {
            const p = slide.p || 0;
            const sc = p >= 0.55 ? '#dd6974' : p >= 0.28 ? '#fdab43' : '#6daa45';
            return (
              <div key={`${slide.i || idx}-${p}`} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 56px', gap: 8, alignItems: 'center', marginTop: 5 }}>
                <span className="muted small-note">Slide {slide.i || idx + 1}</span>
                <div style={{ width: '100%', height: 7, background: '#1a1f2e', borderRadius: 999 }}>
                  <div style={{ width: `${Math.round(p * 100)}%`, height: '100%', background: sc, borderRadius: 999 }} />
                </div>
                <span style={{ color: sc, fontFamily: 'monospace', textAlign: 'right' }}>{Math.round(p * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted small-note" style={{ marginTop: 10 }}>
        Shared cards carry a compact proof summary, not the full post text.
      </p>
      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={onNewScan}>Run new autopsy</button>
        <button className="btn" onClick={onCopyShare}>Copy shared card</button>
        <button className="btn" onClick={onCopyVertical}>Copy vertical image</button>
      </div>
    </div>
  );
}

function ResultCard({ title, children }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.025)' }}>
      <div className="eyebrow">{title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>{children}</div>
    </div>
  );
}

function Chip({ label, title }) {
  return (
    <span
      title={title}
      style={{
        padding: '3px 7px',
        borderRadius: 999,
        background: 'rgba(90,212,255,0.08)',
        border: '1px solid rgba(90,212,255,0.18)',
        color: '#dcecff',
        fontSize: 12,
      }}
    >
      {label}
    </span>
  );
}
