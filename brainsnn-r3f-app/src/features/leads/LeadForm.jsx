// The one place a visitor can say "I want this".
//
// Before this existed the entire product's conversion path was a bare
// `mailto:hello@brainsnn.com`, which silently does nothing for most people on
// mobile or webmail, plus a pricing button that displayed "You're on the Pro
// list" while storing the email precisely nowhere.
//
// So the contract here is narrow and deliberate:
//
//   - A success state is shown only when the server says the lead was received.
//   - Any other outcome — unconfigured, upstream failure, network error — shows
//     the mailto fallback with the brief already composed, so the visitor still
//     has a way through and knows the form did not take it.
//
// That is the same discipline the rest of this codebase applies to model
// claims, applied to a claim made to a customer.
import React, { useEffect, useState } from 'react';
import { Loader2, Mail, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { track } from '../../lib/analytics.js';

export const LEAD_SEGMENTS = Object.freeze([
  { id: 'brands', label: 'Brand or campaign team' },
  { id: 'publishers', label: 'Publisher or creator' },
  { id: 'schools', label: 'School, museum or training' },
  { id: 'research', label: 'Research or innovation team' },
  { id: 'self-serve', label: 'Just me — I want the tool' },
  { id: 'other', label: 'Something else' },
]);

const FALLBACK_EMAIL = 'hello@brainsnn.com';

/** Composes the same brief the old mailto: pathway sent, so nothing is lost. */
export function composeBriefMailto(lead, fallbackEmail = FALLBACK_EMAIL) {
  const segment = LEAD_SEGMENTS.find((entry) => entry.id === lead.segment);
  const subject = `GaugeGap pilot — ${segment ? segment.label : 'enquiry'}`;
  const body = [
    `Audience: ${lead.audience || ''}`,
    `Concept or topic: ${lead.concept || ''}`,
    `What I want people to understand or do: ${lead.outcome || ''}`,
    `Target launch window: ${lead.timeline || ''}`,
    '',
    'Please suggest the smallest useful pilot.',
  ].join('\n');
  return `mailto:${fallbackEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function LeadForm({
  defaultSegment = 'brands',
  heading = 'Tell us what you want people to be able to operate.',
  note = 'One audience, one concept, one interaction. We reply with the smallest useful pilot.',
  compact = false,
}) {
  const [lead, setLead] = useState({
    email: '', name: '', segment: defaultSegment,
    audience: '', concept: '', outcome: '', timeline: '',
  });
  const [state, setState] = useState('idle'); // idle | sending | sent | failed
  const [failure, setFailure] = useState(null);

  // Submissions were tracked and views were not, so the form's conversion rate
  // had no denominator: a day with no leads was indistinguishable from a day
  // where nobody ever saw the form.
  useEffect(() => {
    track('lead_form_viewed', { segment: defaultSegment, compact });
  }, [defaultSegment, compact]);

  function set(field, value) {
    setLead((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setState('sending');
    setFailure(null);
    track('pilot_clicked', { segment: lead.segment });
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) {
        setState('sent');
        track('lead_captured', { segment: lead.segment });
        return;
      }
      // Not delivered. Say so, and hand back a route that works.
      setState('failed');
      setFailure({
        reason: body.status === 'not_configured'
          ? 'The form is not connected yet.'
          : 'That did not go through.',
        email: body.fallbackEmail || FALLBACK_EMAIL,
      });
    } catch {
      setState('failed');
      setFailure({ reason: 'That did not go through.', email: FALLBACK_EMAIL });
    }
  }

  if (state === 'sent') {
    return (
      <div className="lead-form lead-form-sent" data-testid="lead-form-sent" role="status">
        <h3>Got it.</h3>
        <p>We have your brief and will reply to {lead.email}.</p>
      </div>
    );
  }

  return (
    <form className={`lead-form${compact ? ' is-compact' : ''}`} onSubmit={submit} data-testid="lead-form">
      <div className="lead-form-intro">
        <h3>{heading}</h3>
        <p>{note}</p>
      </div>

      <div className="lead-form-grid">
        <label>
          <span>Email</span>
          <input
            type="email" required value={lead.email} placeholder="you@company.com"
            onChange={(event) => set('email', event.target.value)}
            data-testid="lead-email"
          />
        </label>
        <label>
          <span>Name</span>
          <input value={lead.name} onChange={(event) => set('name', event.target.value)} />
        </label>
        <label>
          <span>You are</span>
          <select
            value={lead.segment}
            onChange={(event) => set('segment', event.target.value)}
            data-testid="lead-segment"
          >
            {LEAD_SEGMENTS.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Target launch window</span>
          <input
            value={lead.timeline} placeholder="e.g. this quarter"
            onChange={(event) => set('timeline', event.target.value)}
          />
        </label>
      </div>

      {compact ? null : (
        <div className="lead-form-grid lead-form-grid-wide">
          <label>
            <span>Audience</span>
            <input value={lead.audience} onChange={(event) => set('audience', event.target.value)} />
          </label>
          <label>
            <span>Concept or topic</span>
            <input value={lead.concept} onChange={(event) => set('concept', event.target.value)} />
          </label>
          <label>
            <span>What should people understand or do?</span>
            <textarea rows={3} value={lead.outcome} onChange={(event) => set('outcome', event.target.value)} />
          </label>
        </div>
      )}

      <div className="lead-form-actions">
        <Button variant="primary" type="submit" disabled={state === 'sending' || !lead.email.includes('@')}>
          {state === 'sending'
            ? <><Loader2 size={16} aria-hidden="true" /> Sending…</>
            : <><Send size={16} aria-hidden="true" /> Send the brief</>}
        </Button>
        <a className="lead-form-mailto" href={composeBriefMailto(lead)}>
          <Mail size={15} aria-hidden="true" /> or email us directly
        </a>
      </div>

      {state === 'failed' && failure ? (
        <p className="lead-form-failure" role="alert" data-testid="lead-form-failure">
          {failure.reason} Nothing was saved — please{' '}
          <a href={composeBriefMailto(lead, failure.email)}>email {failure.email}</a> instead.
        </p>
      ) : null}
    </form>
  );
}
