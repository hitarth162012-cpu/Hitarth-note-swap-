import { useEffect, useState } from 'react';
import { Sparkles, X, Send, Wrench } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface GeminiErrorHelperModalProps {
  open: boolean;
  errorMessage: string;
  contextPage: string;
  onClose: () => void;
}

export function GeminiErrorHelperModal({
  open,
  errorMessage,
  contextPage,
  onClose,
}: GeminiErrorHelperModalProps) {
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [loading, setLoading] = useState(false);

  async function fetchHelp(customFollowUp?: string) {
    setLoading(true);
    try {
      const res = await apiRequest<{ advice: string }>('/api/ai/help-error', {
        method: 'POST',
        body: JSON.stringify({
          errorMessage,
          contextPage,
          followUp: customFollowUp || undefined,
        }),
      });
      setAdvice(res.advice);
    } catch (err) {
      setAdvice((err as Error).message || 'Unable to contact Gemini helper right now.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && errorMessage) {
      setAdvice('');
      setFollowUp('');
      fetchHelp();
    }
  }, [open, errorMessage, contextPage]);

  if (!open) return null;

  async function handleFollowUpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!followUp.trim() || loading) return;
    await fetchHelp(followUp.trim());
    setFollowUp('');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-sm sm:items-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gemini-help-title"
    >
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
              <Wrench className="h-4 w-4" />
            </div>
            <div>
              <h2 id="gemini-help-title" className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Gemini Error Assistant
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Context: {contextPage}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Gemini assistant"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
          <span className="font-semibold">Detected Issue:</span> {errorMessage}
        </div>

        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Gemini Suggested Fix</span>
          </div>
          {loading ? (
            <div className="mt-3 space-y-2">
              <div className="h-3 w-4/5 animate-pulse rounded bg-indigo-200/70 dark:bg-indigo-900" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-indigo-200/70 dark:bg-indigo-900" />
            </div>
          ) : (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-800 dark:text-slate-200">
              {advice || 'Analyzing the issue...'}
            </p>
          )}
        </div>

        <form onSubmit={handleFollowUpSubmit} className="mt-4 flex gap-2">
          <label htmlFor="gemini-help-followup" className="sr-only">
            Ask a follow-up question
          </label>
          <input
            id="gemini-help-followup"
            type="text"
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            placeholder="Ask Gemini a follow-up question about this error..."
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <button
            type="submit"
            disabled={loading || !followUp.trim()}
            aria-label="Send follow-up"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
