// The case study, run live rather than written up.
//
// Every figure on this page is computed in the browser, on load, by the same
// modules the product runs on — see holdoutReport.js. Nothing here is typed in,
// which is the only reason it can be trusted six months from now.
//
// The page leads with the engine's worst result on purpose. A comms team being
// sold a detector has no way to check a vendor's claimed accuracy; it can check
// a vendor who publishes the passages it missed, the benign text it wrongly
// flagged, and the exact phrases behind every detection.
import React, { useMemo } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleSlash, ExternalLink, ScanSearch } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { buildHoldoutReport, formatVerdict } from '../../lib/holdoutReport.js';
import { track } from '../../lib/analytics.js';
import '../../styles/evidence.css';

const KIND_COPY = {
  plain: {
    label: 'Conventional phrasing',
    blurb: 'The technique is present and worded the way it usually is. This is the easy case, and the ceiling on everything below.',
  },
  paraphrase: {
    label: 'Paraphrased',
    blurb: 'The same techniques, worded so that no cue list contains the phrase — "the window shuts Friday" instead of "act now". This is where lexical detection runs out.',
  },
  trap: {
    label: 'Benign, but sounds manipulative',
    blurb: 'Honest messages that must use loaded words: a security alert that has to say "suspicious activity", a postmortem that has to say "destroyed". Anything flagged here is a false alarm.',
  },
};

function Figure({ value, caption, tone = 'neutral' }) {
  return (
    <div className={`evidence-figure evidence-figure-${tone}`}>
      <strong>{value}</strong>
      <span>{caption}</span>
    </div>
  );
}

function Passage({ item }) {
  const tone = item.falseAlarm ? 'alarm' : item.missed.length ? 'miss' : 'hit';
  return (
    <article className={`evidence-passage evidence-passage-${tone}`} data-testid="evidence-passage" data-kind={item.kind}>
      <header>
        <code>{item.id}</code>
        <span className="evidence-pressure" data-testid="evidence-pressure">pressure {item.pressure}</span>
        <span className="evidence-label">human label: {item.expectedLevel}</span>
      </header>

      <blockquote>{item.content}</blockquote>

      {item.detected.length > 0 ? (
        <ul className="evidence-detections">
          {item.detected.map((detection) => (
            <li key={detection.id}>
              {item.falseAlarm
                ? <AlertTriangle size={15} aria-hidden="true" />
                : <CheckCircle2 size={15} aria-hidden="true" />}
              <div>
                <strong>{detection.label}</strong>
                <span className="evidence-published">
                  {detection.published}
                  {detection.mapping === 'approximate' ? ' (approximate mapping)' : ''}
                </span>
                {/* The phrases that fired it. A detection nobody can check is
                    not evidence, it is an assertion with a number on it. */}
                <span className="evidence-matches">
                  triggered by {detection.matches.map((phrase) => `“${phrase}”`).join(', ')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="evidence-nothing"><CircleSlash size={15} aria-hidden="true" /> Nothing detected.</p>
      )}

      {item.missed.length > 0 && (
        <p className="evidence-missed" data-testid="evidence-missed">
          Missed, and a human annotator tagged it: {item.missed.join(', ')}
        </p>
      )}
      {item.falseAlarm && (
        <p className="evidence-falsealarm" data-testid="evidence-falsealarm">
          False alarm. This passage is honest; the detector should have stayed quiet.
        </p>
      )}
    </article>
  );
}

export function HoldoutEvidencePage({ onHome, onStart }) {
  // Computed once per mount, from the engine. The corpus is 17 short passages,
  // so this is cheap enough to do on the client and keeps the page honest:
  // there is no build step where a stale number could survive.
  const report = useMemo(() => buildHoldoutReport(), []);
  const verdict = useMemo(() => formatVerdict(report), [report]);

  React.useEffect(() => {
    track('holdout_evidence_viewed', { corpusSize: report.corpusSize, rho: report.outOfSample.rho });
  }, [report]);

  const grouped = useMemo(() => ({
    plain: report.items.filter((item) => item.kind === 'plain'),
    paraphrase: report.items.filter((item) => item.kind === 'paraphrase'),
    trap: report.items.filter((item) => item.kind === 'trap'),
  }), [report]);

  return (
    <div className="evidence-page" data-testid="evidence-page">
      <header className="evidence-hero">
        <button type="button" className="evidence-back" onClick={onHome}>
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <p className="evidence-eyebrow">Held-out evaluation</p>
        <h1>What this engine does on text it has never seen</h1>
        <p className="evidence-lede">
          Most detection vendors publish the number they got on the examples they built the
          detector against. That number is always good and it never survives contact with your
          drafts. Here are both numbers, computed on this page as you load it.
        </p>

        <div className="evidence-headline" data-testid="evidence-headline">
          <Figure value={report.inSample.rho} caption={`in-sample — ${report.inSample.n} passages the cue patterns were written against`} tone="good" />
          <Figure value={report.outOfSample.rho} caption={`held out — ${report.outOfSample.n} passages it had never seen`} tone="bad" />
          <Figure value={`−${report.generalisationGap}`} caption="what tuning on your own examples is worth" tone="neutral" />
        </div>

        <p className="evidence-verdict" data-testid="evidence-verdict">{verdict}</p>
      </header>

      <section className="evidence-summary">
        <h2>The rest of the numbers, including the ones that hurt</h2>
        <div className="evidence-figure-row">
          <Figure value={`${Math.round(report.passageRecall * 100)}%`} caption="of manipulative passages flagged as doing something at all" />
          <Figure value={`${report.classesFound}/${report.classesExpected}`} caption="annotated techniques found" />
          <Figure value={`${report.falseAlarmCount}/${report.trapCount}`} caption="benign passages wrongly flagged" tone="bad" />
          <Figure value={`${Math.round((report.paraphraseRecall ?? 0) * 100)}%`} caption={`of techniques found when phrased outside the cue list (${report.paraphraseCount} passages)`} tone="bad" />
        </div>
        <p className="evidence-note">
          The false-alarm figure is the one to weigh hardest. For a comms team, wrongly flagging
          an honest message costs more than missing a manipulative one, because it is the flag
          that stops a send.
        </p>
      </section>

      <section className="evidence-method">
        {/* Counted, not spelled out: "seventeen" in prose is one more number
            that can quietly stop being true when the corpus changes. */}
        <h2>Why these {report.corpusSize}</h2>
        <p>
          They were written to be scored once, under a rule kept in the source file: no cue
          pattern may be changed in response to a result on them. If the detector does badly
          here, the number is the finding. They are also stacked against it on purpose — a
          holdout containing only text the method obviously handles measures nothing.
        </p>
        <p className="evidence-limits">{report.limits}</p>
      </section>

      {['plain', 'paraphrase', 'trap'].map((kind) => (
        <section className="evidence-group" key={kind}>
          <h2>{KIND_COPY[kind].label} <span>({grouped[kind].length})</span></h2>
          <p className="evidence-group-blurb">{KIND_COPY[kind].blurb}</p>
          {grouped[kind].map((item) => <Passage key={item.id} item={item} />)}
        </section>
      ))}

      <section className="evidence-cta">
        <h2>Run it on your own copy</h2>
        <p>
          The same detector, on your draft, with the same phrase-level evidence behind every
          flag. Nothing is stored on a server.
        </p>
        <div className="evidence-cta-row">
          <Button onClick={() => { track('holdout_evidence_cta_clicked'); onStart?.(); }}>
            <ScanSearch size={16} aria-hidden="true" /> Scan a draft
          </Button>
          <a className="evidence-source-link" href="https://github.com/slavazeph-coder/the-brain/blob/main/brainsnn-r3f-app/src/lib/holdoutCorpus.js" target="_blank" rel="noreferrer">
            Read the corpus and the rule <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
}
