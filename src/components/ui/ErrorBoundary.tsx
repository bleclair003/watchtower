import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Contains a failure to one module so the shell and navigation stay usable. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[watchtower] module failed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="grid h-full place-items-center p-4 text-center text-xs">
        <div className="max-w-md space-y-2">
          <p className="tracking-widest text-wt-crit">MODULE FAILURE</p>
          <p className="break-words text-wt-fg-muted">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="h-7 border border-wt-fg/60 px-3 hover:bg-wt-fg hover:text-wt-bg"
          >
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}
