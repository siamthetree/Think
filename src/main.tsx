import './utils/preBootstrap';
import React, { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { StartupLoader } from './components/StartupLoader.tsx';
import './index.css';

interface StartupErrorBoundaryProps {
  children: ReactNode;
}

interface StartupErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class StartupErrorBoundary extends Component<
  StartupErrorBoundaryProps,
  StartupErrorBoundaryState
> {
  constructor(props: StartupErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): StartupErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error || 'Unexpected error');
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[Chinta] Uncaught application error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-stone-950 text-stone-100 text-center font-sans">
          <h1 className="text-lg font-semibold mb-2">Chinta encountered a display error</h1>
          <p className="text-xs text-stone-400 max-w-sm mb-4 break-words">
            {this.state.errorMessage}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold"
          >
            Reload Reader
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupErrorBoundary>
      <StartupLoader>
        <App />
      </StartupLoader>
    </StartupErrorBoundary>
  </StrictMode>,
);
