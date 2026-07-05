import React from 'react';
import { track } from '../../lib/analytics.js';

// Catches chunk-load failures and WebGL context errors from the lazy 3D scene
// and swaps in the 2D fallback instead of a broken panel.
export class Brain3DErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    track('brain3d_fallback_used', { reason: error?.name || 'render-error' });
  }

  render() {
    if (this.state.failed) return this.props.fallback || null;
    return this.props.children;
  }
}
