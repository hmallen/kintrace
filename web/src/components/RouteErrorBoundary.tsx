import { Component, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { BackendDown } from './BackendDown';

// A route-level error boundary. Top-level queries run with `throwOnError`, so a
// failed query throws during render and is caught here. We discriminate:
//   - a fetch rejection (`TypeError`, what `fetch` throws when the backend is
//     unreachable) → the full-page BackendDown state.
//   - everything else — ApiError, a Zod parse failure, or a render-time
//     exception from a component bug → the route-level error UI with a retry
//     action (never a silently-wrong render, and never mislabeled ":3271
//     unreachable").
// Retry resets the query error state (so the failed query refetches) and clears
// the boundary so children re-render.

interface InnerProps {
  children: ReactNode;
  onReset: () => void;
}

interface InnerState {
  error: Error | null;
}

class ErrorBoundaryInner extends Component<InnerProps, InnerState> {
  state: InnerState = { error: null };

  static getDerivedStateFromError(error: Error): InnerState {
    return { error };
  }

  private handleRetry = () => {
    this.props.onReset();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }

    // Only a fetch rejection (network-level failure) is BackendDown; every
    // other error — including a render-time exception — is a route-level error.
    if (error instanceof TypeError) {
      return <BackendDown onRetry={this.handleRetry} />;
    }

    return (
      <section
        role="alert"
        style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
      >
        <h2 style={{ margin: 0 }}>Something went wrong</h2>
        <p style={{ margin: 0, color: '#444' }}>{error.message}</p>
        <div>
          <button type="button" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      </section>
    );
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <ErrorBoundaryInner onReset={reset}>{children}</ErrorBoundaryInner>}
    </QueryErrorResetBoundary>
  );
}
