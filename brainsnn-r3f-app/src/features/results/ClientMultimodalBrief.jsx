import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, FileText, LockKeyhole, Mic2, Target, Volume2 } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';

function formatTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function formatRange(start, end) {
  return `${formatTime(start)}–${formatTime(end)}`;
}

function kindLabel(kind) {
  return ({
    claim: 'CLAIM',
    proof: 'PROOF',
    cta: 'CTA',
    price: 'PRICE',
    workflow: 'WORKFLOW',
    drop: 'DROP',
    weakest: 'WEAK WINDOW',
    strongest: 'HIGH CHANGE',
  })[kind] || String(kind || 'MOMENT').toUpperCase();
}

function alignmentBadge(mode) {
  if (mode === 'local-asr') return { tone: 'warning', label: 'LOCAL ASR TIMING' };
  if (mode === 'timed') return { tone: 'cyan', label: 'SUPPLIED TIMING' };
  if (mode === 'estimated') return { tone: 'warning', label: 'ESTIMATED ALIGNMENT' };
  return { tone: 'neutral', label: 'VISUAL TIMING ONLY' };
}

function transcriptSourceLabel(transcript) {
  if (transcript?.timingOrigin === 'local-asr') return 'Local Whisper timing';
  if (transcript?.timingOrigin === 'supplied') return 'Provided timestamps';
  if (transcript?.mode === 'estimated') return 'Estimated timing';
  return 'Not timed';
}

function transcriptSegmentNote(transcript, segment) {
  if (transcript?.timingOrigin === 'local-asr') return 'Browser-local speech model timestamp; verify critical wording and cut points against playback.';
  if (segment?.alignment === 'provided') return 'Timestamp supplied by transcript/captions.';
  return 'Estimated from sentence length and video duration.';
}

function SummaryCard({ icon: Icon, label, children, tone = '' }) {
  return (
    <article className={`client-brief-card ${tone}`}>
      <div className="client-brief-card-label"><Icon size={15} aria-hidden="true" /><span>{label}</span></div>
      <div className="client-brief-card-body">{children}</div>
    </article>
  );
}

export function ClientMultimodalBrief({ result, media }) {
  if (result?.contentType !== 'video' || !result?.multimodal?.clientBrief) return null;
  const multimodal = result.multimodal;
  const brief = multimodal.clientBrief;
  const transcript = multimodal.transcriptTimeline || {};
  const audio = multimodal.audioTimeline || {};
  const moments = multimodal.clientMoments || [];
  const anchors = brief.evidenceAnchors || [];
  const badge = alignmentBadge(brief.alignmentMode);
  const transcriptSegments = (transcript.segments || []).slice(0, 14);
  const clientMoments = moments.slice(0, 12);
  const localAsr = transcript.timingOrigin === 'local-asr';
  const localTranscript = transcript.localTranscript || media?.localTranscript || null;

  return (
    <section className="client-brief" aria-labelledby="client-brief-heading">
      <header className="client-brief-header">
        <div>
          <span className="bsn-eyebrow">Client presentation layer</span>
          <h2 id="client-brief-heading">Decision brief: {brief.headline}</h2>
          <p>Translate the technical readout into a concrete edit, the evidence behind it, and the exact boundary of what BrainSNN knows.</p>
        </div>
        <div className="client-brief-badges">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <Badge tone="cyan">MULTIMODAL V0.3</Badge>
        </div>
      </header>

      <div className="client-brief-sourcebar" aria-label="Client scan source summary">
        <span><Activity size={14} aria-hidden="true" /><small>VISUAL</small><strong>{multimodal.frameCount || 0} local samples</strong></span>
        <span><Volume2 size={14} aria-hidden="true" /><small>AUDIO</small><strong>{audio.status === 'ready' ? `${audio.points?.length || 0} energy points` : 'Unavailable'}</strong></span>
        <span>{localAsr ? <Mic2 size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}<small>TRANSCRIPT</small><strong>{transcriptSourceLabel(transcript)}</strong></span>
        <span><LockKeyhole size={14} aria-hidden="true" /><small>RAW MEDIA</small><strong>Browser-local</strong></span>
      </div>

      {localAsr ? (
        <div className="client-asr-provenance">
          <Mic2 size={17} aria-hidden="true" />
          <div>
            <strong>Speech-to-text generated locally in this browser</strong>
            <p>{localTranscript?.model || 'Whisper'} · {localTranscript?.device || 'browser'} · {localTranscript?.wordCount || 0} timed words. These are model-generated speech timestamps, not measured or user-supplied ground truth.</p>
          </div>
        </div>
      ) : null}

      <div className="client-brief-grid">
        <SummaryCard icon={AlertTriangle} label="PRIMARY ISSUE" tone="risk">
          <p>{brief.primaryIssue}</p>
        </SummaryCard>
        <SummaryCard icon={Target} label="WHY THE CLIENT SHOULD CARE">
          <p>{brief.businessRisk}</p>
        </SummaryCard>
        <SummaryCard icon={CheckCircle2} label="EXACT NEXT EDIT" tone="action">
          <p>{brief.exactEdit}</p>
        </SummaryCard>
      </div>

      {anchors.length ? (
        <section className="client-evidence-section" aria-labelledby="client-evidence-heading">
          <div className="client-section-heading">
            <div><span className="bsn-eyebrow">Evidence chain</span><h3 id="client-evidence-heading">The moments supporting the recommendation</h3></div>
            <small>{brief.timingLabel}</small>
          </div>
          <div className="client-evidence-strip">
            {anchors.map((item, index) => (
              <article key={`${item.kind}-${item.start}-${index}`} className={`client-anchor client-anchor-${item.kind}`}>
                <span>{kindLabel(item.kind)}</span>
                <strong>{formatRange(item.start, item.end)}</strong>
                <p>{item.text}</p>
                <small>{item.alignment === 'local-asr' ? 'local ASR · verify timing' : item.alignment}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="client-moment-section" aria-labelledby="client-moment-heading">
        <div className="client-section-heading">
          <div><span className="bsn-eyebrow">Moment-by-moment audit</span><h3 id="client-moment-heading">What happened, why it matters, what to change</h3></div>
          <small>{clientMoments.length} prioritized moments</small>
        </div>
        <div className="client-moment-table" role="table" aria-label="Client moment audit">
          <div className="client-moment-row client-moment-head" role="row">
            <span role="columnheader">Time</span><span role="columnheader">Signal</span><span role="columnheader">Why it matters</span><span role="columnheader">Action</span><span role="columnheader">Source</span>
          </div>
          {clientMoments.map((moment) => (
            <div className="client-moment-row" role="row" key={moment.id}>
              <span role="cell" className="client-moment-time"><Clock3 size={13} aria-hidden="true" />{formatRange(moment.start, moment.end)}</span>
              <span role="cell"><b>{kindLabel(moment.kind)}</b><em>{moment.label}</em><small>{moment.detail}</small></span>
              <span role="cell">{moment.whyItMatters}</span>
              <span role="cell">{moment.action}</span>
              <span role="cell"><b>{moment.source}</b><small>{moment.confidence}</small>{moment.audioEnergy != null ? <small>audio energy {moment.audioEnergy}/100</small> : null}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="client-detail-grid">
        <section className="client-detail-panel" aria-labelledby="client-transcript-heading">
          <div className="client-section-heading compact">
            <div><span className="bsn-eyebrow">Semantic timeline</span><h3 id="client-transcript-heading">Transcript / caption beats</h3></div>
            <small>{localAsr ? 'LOCAL ASR' : transcript.sourceFormat || 'none'}</small>
          </div>
          {transcriptSegments.length ? (
            <div className="client-transcript-list">
              {transcriptSegments.map((segment) => (
                <article key={segment.id}>
                  <div><strong>{formatRange(segment.start, segment.end)}</strong><span className={`client-kind client-kind-${segment.kind}`}>{kindLabel(segment.kind)}</span></div>
                  <p>{segment.text}</p>
                  <small>{transcriptSegmentNote(transcript, segment)}</small>
                </article>
              ))}
            </div>
          ) : <p className="bsn-note">No timed transcript is available. Generate local captions, add SRT/VTT, or add [mm:ss] lines to turn semantic beats into time-localized review cues.</p>}
          <p className="client-boundary-note">{transcript.disclaimer || (localAsr ? localTranscript?.disclaimer : '')}</p>
        </section>

        <section className="client-detail-panel" aria-labelledby="client-audio-heading">
          <div className="client-section-heading compact">
            <div><span className="bsn-eyebrow">Audio layer</span><h3 id="client-audio-heading">Local sound dynamics</h3></div>
            <Volume2 size={18} aria-hidden="true" />
          </div>
          {audio.status === 'ready' ? (
            <>
              <div className="client-audio-stats">
                <span><small>MEAN ENERGY</small><strong>{audio.summary?.meanEnergy ?? '—'}</strong></span>
                <span><small>MAX ENERGY</small><strong>{audio.summary?.maxEnergy ?? '—'}</strong></span>
                <span><small>SILENT FRACTION</small><strong>{Math.round((audio.summary?.silentFraction || 0) * 100)}%</strong></span>
                <span><small>DYNAMIC CHANGE</small><strong>{audio.summary?.meanDynamics ?? '—'}</strong></span>
              </div>
              <p>Use this layer to see where sound energy rises, falls or goes quiet relative to visual and transcript moments.</p>
            </>
          ) : (
            <div className="client-audio-unavailable"><AlertTriangle size={18} aria-hidden="true" /><p>{audio.reason || 'No local audio envelope was available for this scan.'}</p></div>
          )}
          <p className="client-boundary-note">{audio.disclaimer || 'Audio is not used when local decode is unavailable.'}</p>
        </section>
      </div>

      <section className="client-presenter" aria-labelledby="client-presenter-heading">
        <div className="client-presenter-title"><Target size={17} aria-hidden="true" /><div><span className="bsn-eyebrow">Use this in the room</span><h3 id="client-presenter-heading">What to tell the client</h3></div></div>
        <div className="client-presenter-script">
          <p>“We’re not asking you to trust a mystery score. BrainSNN shows the creative as a timeline: what visually changed, where local sound energy shifted, where the transcript places the claim, proof, price and CTA, and which edit that evidence supports.”</p>
          {localAsr ? (
            <p>“For this scan, BrainSNN generated the transcript locally in the browser. The speech model gives us useful word-level timing, but we label it as model-generated and verify important edit points against playback rather than pretending it is exact ground truth.”</p>
          ) : (
            <p>“When you give us caption timestamps, those semantic moments follow the supplied transcript. When you only give plain text, we clearly mark timing as estimated instead of pretending it is measured.”</p>
          )}
          <p>“The current brain-style layer is a modelled reference visualization. It is not an MRI, EEG or biometric readout. The value today is faster creative review and a reproducible decision trail.”</p>
        </div>
      </section>

      <footer className="client-brief-footer">
        <strong>Scientific boundary</strong>
        <p>{multimodal.disclaimer}</p>
        {media?.fileName ? <small>Source file: {media.fileName} · preview/raw media remained local to this browser session.</small> : null}
      </footer>
    </section>
  );
}
