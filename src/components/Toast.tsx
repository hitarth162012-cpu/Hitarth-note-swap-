import { Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  text: string;
}

export function ToastStack({
  toasts,
  onDismiss,
  onAskGeminiHelp,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
  onAskGeminiHelp?: (errorText: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4 md:bottom-6">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className={`pointer-events-auto flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
              toast.type === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100'
                : toast.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                  : 'border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100'
            }`}
            role="alert"
          >
            <span className="min-w-0 flex-1">{toast.text}</span>
            {toast.type === 'error' && onAskGeminiHelp && (
              <button
                type="button"
                onClick={() => {
                  onAskGeminiHelp(toast.text);
                  onDismiss(toast.id);
                }}
                className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-lg bg-rose-700 px-2.5 text-[11px] font-semibold text-white hover:bg-rose-800"
              >
                <Sparkles className="h-3 w-3" />
                <span>Ask Gemini</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss toast"
              className="min-h-[32px] min-w-[32px] shrink-0 rounded-lg opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
