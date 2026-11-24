import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  aiLoading: boolean;
  aiAdvice: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
    aiLoading: false,
    aiAdvice: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('NoteSwap ErrorBoundary caught error:', error, info);
  }

  handleAskGemini = async () => {
    this.setState({ aiLoading: true });
    try {
      const res = await apiRequest<{ advice: string }>('/api/ai/help-error', {
        method: 'POST',
        body: JSON.stringify({
          errorMessage: this.state.errorMessage,
          contextPage: 'App Render ErrorBoundary',
        }),
      });
      this.setState({ aiAdvice: res.advice });
    } catch {
      this.setState({
        aiAdvice:
          'Try reloading the page. If this keeps happening, sign out and sign back in or clear your browser storage.',
      });
    } finally {
      this.setState({ aiLoading: false });
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf9f6] p-4 dark:bg-slate-950">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <h1 className="font-display text-lg font-bold">Something went wrong</h1>
          </div>

          <p className="mt-2 rounded-xl bg-slate-50 p-3 font-mono-num text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-300">
            {this.state.errorMessage}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
            >
              <RefreshCw className="h-4 w-4" />
              Reload App
            </button>
            <button
              type="button"
              disabled={this.state.aiLoading}
              onClick={this.handleAskGemini}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300"
            >
              <Sparkles className="h-4 w-4" />
              {this.state.aiLoading ? 'Asking Gemini...' : 'Ask Gemini How to Fix'}
            </button>
          </div>

          {this.state.aiAdvice && (
            <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-xs leading-relaxed text-slate-800 whitespace-pre-line dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-slate-200">
              <p className="mb-1 font-bold text-indigo-700 dark:text-indigo-300">Gemini Troubleshooting Steps:</p>
              {this.state.aiAdvice}
            </div>
          )}
        </div>
      </div>
    );
  }
}
