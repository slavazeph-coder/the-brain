import React, { useState } from 'react';
import { Check, MessageSquareWarning, ThumbsUp, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { track } from '../../lib/analytics.js';

const RATINGS = [
  { value: 'useful', label: 'Useful', icon: ThumbsUp },
  { value: 'missed', label: 'Missed something', icon: MessageSquareWarning },
  { value: 'wrong', label: 'Wrong', icon: XCircle },
];

export function ResultFeedback({ result }) {
  const [rating, setRating] = useState('');
  const [category, setCategory] = useState('');
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!result) return null;

  function submit() {
    if (!rating) return;
    track('result_feedback_submitted', {
      rating,
      category: category || 'none',
      feedback: feedback.trim().slice(0, 120),
      scanId: String(result.id || '').slice(0, 60),
      contentType: result.contentType || 'unknown',
      fallback: Boolean(result.isFallback),
    });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <section className="result-feedback submitted" aria-label="Result feedback submitted">
        <Check size={18} aria-hidden="true" />
        <div>
          <strong>Feedback saved</strong>
          <p>That failure case is now easier to reproduce and improve.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="result-feedback" aria-labelledby="result-feedback-heading">
      <div>
        <span className="bsn-eyebrow">Help calibrate BrainSNN</span>
        <strong id="result-feedback-heading">Did BrainSNN understand it?</strong>
      </div>

      <div className="result-feedback-options" role="group" aria-label="Rate this analysis">
        {RATINGS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className={rating === value ? 'selected' : ''}
            onClick={() => setRating(value)}
            aria-pressed={rating === value}
          >
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>

      {rating && rating !== 'useful' ? (
        <>
          <label>
            What went wrong?
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Choose one</option>
              <option value="too_generic">Too generic</option>
              <option value="missed_step">Missed a step / event</option>
              <option value="wrong_signal">Wrong signal or interpretation</option>
              <option value="missing_evidence">Missed evidence already present</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label>
            What did BrainSNN miss?
            <textarea
              value={feedback}
              maxLength={120}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Example: the export at 0:42 was the approval step, not the final result."
            />
          </label>
        </>
      ) : null}

      <div className="result-feedback-submit">
        <p>Only this feedback and scan metadata are sent here — not the original raw input.</p>
        <Button variant="secondary" onClick={submit} disabled={!rating}>Send feedback</Button>
      </div>
    </section>
  );
}
