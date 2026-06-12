// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ControlsBar from './ControlsBar';
import AppHeader from './AppHeader';
import SimControls from './SimControls';

function renderBar(extra = {}) {
  const props = {
    state: { running: true, scenario: 'Baseline' },
    isRecording: false,
    exportStatus: 'idle',
    quality: 'high',
    mode: 'simulation',
    onSetMode: vi.fn(),
    onSetQuality: vi.fn(),
    onToggleRun: vi.fn(),
    onBurst: vi.fn(),
    onReset: vi.fn(),
    onScenario: vi.fn(),
    onToggleRecording: vi.fn(),
    onExportGif: vi.fn(),
    ...extra,
  };
  render(<ControlsBar {...props} />);
  return props;
}

describe('ControlsBar', () => {
  it('renders the simulation controls without the hero block', () => {
    renderBar();
    expect(screen.getByText('Pause')).toBeInTheDocument();
    expect(screen.getByText('Trigger affect burst')).toBeInTheDocument();
    // Hero moved to AppHeader — no h1 here anymore.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('fires the control callbacks', () => {
    const props = renderBar();
    fireEvent.click(screen.getByText('Pause'));
    expect(props.onToggleRun).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Trigger affect burst'));
    expect(props.onBurst).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('ultra'));
    expect(props.onSetQuality).toHaveBeenCalledWith('ultra');
    fireEvent.click(screen.getByText('TRIBE v2'));
    expect(props.onSetMode).toHaveBeenCalledWith('tribe');
  });
});

describe('AppHeader', () => {
  it('renders the product name and pitch', () => {
    render(<AppHeader />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('BrainSNN');
    expect(screen.getByText(/reads the feelings hidden/i)).toBeInTheDocument();
  });
});

describe('SimControls', () => {
  it('wraps children in a labelled details element', () => {
    render(
      <SimControls>
        <div data-testid="inner">controls</div>
      </SimControls>,
    );
    expect(screen.getByText('Simulation controls')).toBeInTheDocument();
    expect(screen.getByTestId('inner')).toBeInTheDocument();
  });
});
