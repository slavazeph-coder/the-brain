import React from 'react';
import { track } from '../../lib/analytics.js';
import { ClassicsGallery } from './ClassicsGallery.jsx';

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
  {
    // Every other example is deliberately clean copy, written to show off the
    // scoring. The result was that no example in the front row produced a
    // single applicable fix, so the one feature that edits your draft was
    // invisible to anyone who started from a sample: they got "Nothing
    // mechanical left to fix" on their very first scan. This one has the four
    // problems the fixer can actually repair — buried evidence, manufactured
    // urgency, an unverifiable universal, and a vague superlative — in copy
    // that still reads like something a real person would send.
    id: 'launch-email',
    label: 'Launch email',
    content: 'Last chance to join the pilot. Book a call before Friday and lock in the launch rate. Everyone is moving to this workflow, and it is a genuine game-changer for busy teams. We cut review time by 42% across 18 pilot customers.',
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
      <details className="scan-risk-example">
        <summary>Scan the classics</summary>
        <p className="bsn-note">Recognizable formulas — iconic ads, viral hooks, scam emails — as one-click scans.</p>
        <ClassicsGallery
          compact
          onSelect={(content, preset) => {
            track('classic_preset_selected', { presetId: preset?.id, surface: 'composer' });
            onSelect(content);
          }}
        />
      </details>
    </div>
  );
}
