import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackMessage?: string },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; fallbackMessage?: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
        }}>
          <h2 style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
            Something went wrong
          </h2>
          <p style={{ marginBottom: '1rem' }}>
            {this.props.fallbackMessage ?? 'An unexpected error occurred in this section.'}
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '1.5rem' }}>
            {this.state.error?.message}
          </p>
          <button
            className="btn-secondary"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
