// @vitest-environment jsdom
import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../utils/brainLLM', () => ({
  analyzeForBrain: vi.fn(),
  activeBackendLabel: () => 'regex (local)',
}));

import ScanHero from './ScanHero';

// jsdom has no scrollIntoView; the component calls it on result reveal.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const RESULT = {
  manipulationPressure: 0.8,
  emotionalActivation: 0.6,
  cognitiveSuppression: 0.4,
  trustErosion: 0.5,
  evidence: [],
  confidence: 'high',
  recommendedAction: 'High manipulation risk — verify before acting.',
  source: 'regex',
};

describe('ScanHero region links', () => {
  it('clicking a region tag selects that region in the brain', () => {
    const onSelectRegion = vi.fn();
    render(
      <ScanHero
        seed={{ text: 'sample', result: RESULT, nonce: 1 }}
        onSelectRegion={onSelectRegion}
      />,
    );
    fireEvent.click(screen.getByText('basal ganglia ↑'));
    expect(onSelectRegion).toHaveBeenCalledWith('BG');
    fireEvent.click(screen.getByText('amygdala + thalamus ↑'));
    expect(onSelectRegion).toHaveBeenCalledWith('AMY');
  });

  it('network-wide stays a plain span', () => {
    render(<ScanHero seed={{ text: 'x', result: RESULT, nonce: 2 }} />);
    const tag = screen.getByText('network-wide');
    expect(tag.tagName).toBe('SPAN');
  });
});
