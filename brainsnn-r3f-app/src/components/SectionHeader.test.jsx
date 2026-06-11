// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const scrollToLayerPanel = vi.fn();
const openCommandPalette = vi.fn();
vi.mock('../utils/panelNav', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    scrollToLayerPanel: (...a) => scrollToLayerPanel(...a),
    openCommandPalette: (...a) => openCommandPalette(...a),
  };
});

import SectionHeader from './SectionHeader';
import { sectionPanelCount } from '../utils/sectionRegistry';

describe('SectionHeader', () => {
  it('renders a chip per registry panel for the section', () => {
    render(<SectionHeader sectionId="defense" />);
    expect(screen.getByText(/Defense · 12 panels/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(nav.querySelectorAll('.chip-btn')).toHaveLength(
      sectionPanelCount('defense'),
    );
  });

  it('chip click scrolls to that panel', () => {
    render(<SectionHeader sectionId="insights" />);
    fireEvent.click(screen.getByText('Analytics Dashboard'));
    expect(scrollToLayerPanel).toHaveBeenCalledWith(7);
  });

  it('shows the palette CTA only for searchCta sections', () => {
    render(<SectionHeader sectionId="tools" />);
    fireEvent.click(screen.getByText(/Search all 100\+ layers/));
    expect(openCommandPalette).toHaveBeenCalled();
  });

  it('renders nothing for unknown sections', () => {
    const { container } = render(<SectionHeader sectionId="nope" />);
    expect(container.firstChild).toBeNull();
  });
});
