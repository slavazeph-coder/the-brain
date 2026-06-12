// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import OnboardingWalkthrough from './OnboardingWalkthrough';

const KEY = 'brainsnn_onboarded_v2';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function start() {
  render(<OnboardingWalkthrough />);
  act(() => {
    vi.advanceTimersByTime(1600);
  });
}

describe('OnboardingWalkthrough', () => {
  it('auto-starts on first visit and walks all six steps', () => {
    start();
    expect(screen.getByText('Welcome to BrainSNN')).toBeInTheDocument();
    expect(screen.getByText('1 / 6')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Paste anything/)).toBeInTheDocument();
  });

  it('does not start when the v2 key is set', () => {
    localStorage.setItem(KEY, 'true');
    start();
    expect(screen.queryByText('Welcome to BrainSNN')).toBeNull();
  });

  it('skip dismisses and persists the v2 key', () => {
    start();
    fireEvent.click(screen.getByText('Skip'));
    expect(screen.queryByText('Welcome to BrainSNN')).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('true');
  });
});
