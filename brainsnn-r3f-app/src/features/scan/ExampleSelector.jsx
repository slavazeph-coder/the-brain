import React from 'react';
import { track } from '../../lib/analytics.js';

export const EXAMPLES = [
  {
    id: 'social-hook',
    label: 'Social hook',
    content: 'Most landing pages lose trust in the first ten seconds. Here are three tiny proof points that make a visitor keep reading before they ever see the demo.',
  },
  {
    id: 'paid-ad',
    label: 'Paid ad',
    content: 'Your team does not need more content. It needs a clearer decision before publishing. BrainSNN scans each draft for hook strength, trust, and manipulation risk.',
  },
  {
    id: 'founder-post',
    label: 'Founder post',
    content: 'We rebuilt our review process around one question: will this message help a real customer decide, or just add more noise? The answer changed our entire launch checklist.',
  },
  {
    id: 'sales-email',
    label: 'Sales email',
    content: 'I noticed your team is publishing across email, paid social, and founder channels. We help teams spot the lines that create attention but quietly damage trust.',
  },
  {
    id: 'press-statement',
    label: 'Press statement',
    content: 'Today we are opening BrainSNN to early pilots: a content decision engine for teams that want sharper launches without manipulative copy.',
  },
];

const RISK_EXAMPLE = "They don't want you to know this. If you wait until tomorrow, your competitors will steal every customer and you will regret missing this limited secret forever.";

export function ExampleSelector({ onSelect }) {
  return (
    <div className="scan-examples">
      <span className="bsn-mono">Start with a realistic draft</span>
      <div className="scan-example-row">
        {EXAMPLES.map((example) => (
          <button
            className="bsn-chip"
            type="button"
            key={example.id}
            onClick={() => {
              track('example_selected', { exampleId: example.id });
              onSelect(example.content);
            }}
          >
            {example.label}
          </button>
        ))}
      </div>
      <details className="scan-risk-example">
        <summary>Try a high-risk example</summary>
        <p className="bsn-note">Useful for testing trust-risk and fallback labels. It is intentionally exaggerated.</p>
        <button className="bsn-chip" type="button" onClick={() => onSelect(RISK_EXAMPLE)}>Load high-risk copy</button>
      </details>
    </div>
  );
}
