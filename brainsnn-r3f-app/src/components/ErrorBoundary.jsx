import React from 'react';

/**
 * Error Boundary — catches render errors in child components
 * and shows a fallback UI instead of crashing the entire app.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[BrainSNN] Error in ${this.props.name || 'component'}:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="panel panel-pad error-boundary-panel">
          <div className="error-boundary-content">
            <span className="error-boundary-icon">!</span>
            <div>
              <strong>{this.props.name || 'Component'} encountered an error</strong>
              <p className="muted">{this.state.error?.message || 'Something went wrong.'}</p>
              <button
                className="btn-sm"
                onClick={() => this.setState({ hasError: false, error: null })}
              >
                Retry
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

/**
 * HOC: wrap a component in an error boundary.
 */
export function withErrorBoundary(Component, name) {
  return function WrappedWithBoundary(props) {
    return (
      <ErrorBoundary name={name || Component.displayName || Component.name}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
