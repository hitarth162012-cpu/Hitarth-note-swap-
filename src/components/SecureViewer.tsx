import { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Sparkles,
  Brain,
  MessageSquare,
  ShieldAlert,
  RotateCw,
  Send,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AchievementItem, Language } from '../types';
import { t } from '../i18n';

interface ViewerPage {
  page: number;
  url: string;
  isPreviewOnly: boolean;
}

interface Flashcard {
  front: string;
  back: string;
}

interface QuizQuestion {
  question: string;
  options: string[];
}

interface QuizResult {
  score: number;
  total: number;
  passed: boolean;
  coinsAwarded: number;
  rewardsToday: number;
  maxDailyRewards: number;
  coinsBalance: number;
  corrections: Array<{
    selectedIndex: number;
    correctIndex: number;
    isCorrect: boolean;
    explanation: string;
  }>;
  newlyUnlocked?: AchievementItem[];
}

interface SecureViewerProps {
  noteId: string;
  noteTitle: string;
  lang: Language;
  fullAccess: boolean;
  onCoinsChange: (newBalance: number, delta: number, label: string, achievements?: AchievementItem[]) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
  onAskGeminiHelp?: (errorText: string, contextPage: string) => void;
}

export function SecureViewer({
  noteId,
  noteTitle,
  lang,
  fullAccess,
  onCoinsChange,
  onToast,
  onAskGeminiHelp,
}: SecureViewerProps) {
  const [tab, setTab] = useState<'pages' | 'ai_kit' | 'ask'>('pages');
  const [pages, setPages] = useState<ViewerPage[]>([]);
  const [fileType, setFileType] = useState<string>('structured');
  const [watermarkLabel, setWatermarkLabel] = useState<string>('Protected · NoteSwap');
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingPages, setLoadingPages] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // AI Study Kit state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  // Ask this note state
  const [askQuestion, setAskQuestion] = useState('');
  const [askHistory, setAskHistory] = useState<Array<{ q: string; a: string }>>([]);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingPages(true);
    setPageError(null);
    apiRequest<{
      fullAccess: boolean;
      totalPages: number;
      allowedPages: number;
      fileType: string;
      watermarkLabel: string;
      pages: ViewerPage[];
    }>(`/api/notes/${noteId}/viewer-urls`)
      .then((res) => {
        if (!active) return;
        setPages(res.pages);
        setFileType(res.fileType);
        setWatermarkLabel(res.watermarkLabel);
        setCurrentPage(1);
      })
      .catch((err) => {
        if (!active) return;
        setPageError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoadingPages(false);
      });

    return () => {
      active = false;
    };
  }, [noteId, fullAccess]);

  // Deter Ctrl+S / Ctrl+P shortcuts while viewer is mounted
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['s', 'p', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        onToast('info', 'Downloads & printing are disabled inside the protected viewer.');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToast]);

  async function loadAiKit() {
    if (summary || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiRequest<{
        summary: string;
        flashcards: Flashcard[];
        quiz: QuizQuestion[];
      }>(`/api/notes/${noteId}/ai-kit`, { method: 'POST' });
      setSummary(res.summary);
      setFlashcards(res.flashcards || []);
      setQuiz(res.quiz || []);
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSubmitQuiz() {
    if (Object.keys(quizAnswers).length < quiz.length) {
      onToast('error', `Answer all ${quiz.length} questions first`);
      return;
    }
    setSubmittingQuiz(true);
    try {
      const answers = quiz.map((_, i) => quizAnswers[i]);
      const res = await apiRequest<QuizResult>(`/api/notes/${noteId}/quiz/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      });
      setQuizResult(res);
      if (res.coinsAwarded > 0) {
        onCoinsChange(res.coinsBalance, res.coinsAwarded, 'AI Quiz Bonus', res.newlyUnlocked);
        onToast('success', `Scored ${res.score}/${res.total}! Earned +🪙${res.coinsAwarded} (${res.rewardsToday}/${res.maxDailyRewards} today).`);
      } else if (res.passed) {
        onToast('info', `Scored ${res.score}/${res.total}! Quiz reward already claimed or daily cap reached.`);
      } else {
        onToast('info', `Scored ${res.score}/${res.total}. Score 4/5 or higher to earn +🪙1!`);
      }
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSubmittingQuiz(false);
    }
  }

  async function handleAskNote(e: React.FormEvent) {
    e.preventDefault();
    const q = askQuestion.trim();
    if (!q || asking) return;
    setAsking(true);
    try {
      const res = await apiRequest<{ answer: string }>(`/api/notes/${noteId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      });
      setAskHistory((prev) => [...prev, { q, a: res.answer }]);
      setAskQuestion('');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  const activePageObj = pages.find((p) => p.page === currentPage);

  return (
    <section
      className="noteswap-protected-viewer select-none rounded-2xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
        <div className="flex items-center gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setTab('pages')}
            className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition-colors ${
              tab === 'pages'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Pages ({pages.length})
          </button>
          {fullAccess && (
            <>
              <button
                type="button"
                onClick={() => {
                  setTab('ai_kit');
                  loadAiKit();
                }}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                  tab === 'ai_kit'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                <span>AI Summary &amp; Quiz</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('ask')}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                  tab === 'ask'
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
                <span>Ask this note</span>
              </button>
            </>
          )}
        </div>

        <span className="font-mono-num text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {fileType === 'pdf' ? 'PDF' : fileType === 'image' ? 'Images' : 'Protected'} · No downloads
        </span>
      </div>

      {/* Honest Protection Notice */}
      <div className="flex items-center gap-2 border-b border-slate-100 bg-amber-50/70 px-4 py-2 text-xs text-amber-900 dark:border-slate-800 dark:bg-amber-950/30 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>{t(lang, 'viewerWarning')}</span>
      </div>

      {/* Pages Tab */}
      {tab === 'pages' && (
        <div className="p-4">
          {loadingPages ? (
            <div className="h-96 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ) : pageError ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Lock className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">{pageError}</p>
              {onAskGeminiHelp && (
                <button
                  type="button"
                  onClick={() => onAskGeminiHelp(pageError, 'Note Viewer')}
                  className="mt-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Ask Gemini for Help
                </button>
              )}
            </div>
          ) : activePageObj ? (
            <div>
              <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700">
                {fileType === 'pdf' ? (
                  <iframe
                    src={`${activePageObj.url}#toolbar=0&navpanes=0`}
                    title={noteTitle}
                    className="h-[640px] w-full border-0"
                  />
                ) : (
                  <img
                    src={activePageObj.url}
                    alt={`${noteTitle} page ${currentPage}`}
                    draggable={false}
                    className="mx-auto block w-full max-w-2xl pointer-events-none"
                  />
                )}

                {/* Dynamic Buyer Watermark Overlay on every page */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex flex-col justify-around overflow-hidden opacity-20"
                >
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      className="-rotate-12 whitespace-nowrap text-center font-mono-num text-sm font-bold tracking-wider text-indigo-700 dark:text-indigo-400"
                    >
                      {watermarkLabel} · {watermarkLabel} · {watermarkLabel}
                    </div>
                  ))}
                </div>
              </div>

              {/* Page Pagination */}
              {pages.length > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="flex min-h-[44px] items-center gap-1 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span>Prev</span>
                  </button>
                  <span className="font-mono-num text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Page {currentPage} of {pages.length}
                    {activePageObj.isPreviewOnly ? ' (Free Preview)' : ''}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= pages.length}
                    onClick={() => setCurrentPage((p) => Math.min(pages.length, p + 1))}
                    className="flex min-h-[44px] items-center gap-1 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* AI Study Studio: Summary + 10 Flashcards + 5-Question Quiz */}
      {tab === 'ai_kit' && fullAccess && (
        <div className="p-4 sm:p-6 space-y-6">
          {aiLoading ? (
            <div className="space-y-3 py-8 text-center">
              <Brain className="mx-auto h-8 w-8 animate-pulse text-indigo-600" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Generating Gemini AI Summary, 10 Flashcards &amp; 5-Question Quiz...
              </p>
            </div>
          ) : aiError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <p className="font-semibold">Could not load AI Study Studio</p>
              <p className="mt-1 text-xs">{aiError}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={loadAiKit}
                  className="min-h-[40px] rounded-xl bg-rose-700 px-4 text-xs font-semibold text-white"
                >
                  Retry
                </button>
                {onAskGeminiHelp && (
                  <button
                    type="button"
                    onClick={() => onAskGeminiHelp(aiError, 'AI Study Studio')}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-4 text-xs font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-200"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Ask Gemini for Help
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* AI Summary */}
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Gemini AI Note Summary
                </h3>
                <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 select-text dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  {summary}
                </p>
              </div>

              {/* 10 Interactive Flashcards */}
              {flashcards.length > 0 && (
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      Flashcards ({cardIndex + 1} / {flashcards.length})
                    </h3>
                    <span className="text-xs text-slate-500">Tap card to flip</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCardFlipped((f) => !f)}
                    className="mt-2 flex min-h-[150px] w-full flex-col items-center justify-center rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6 text-center transition-colors hover:bg-indigo-50 dark:border-indigo-900/60 dark:bg-indigo-950/30"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                      {cardFlipped ? 'Answer' : 'Prompt'}
                    </span>
                    <p className="mt-2 text-base font-semibold text-slate-900 dark:text-white">
                      {cardFlipped ? flashcards[cardIndex].back : flashcards[cardIndex].front}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500">
                      <RotateCw className="h-3 w-3" /> Flip
                    </span>
                  </button>
                  <div className="mt-3 flex items-center justify-between">
                    <button
                      type="button"
                      disabled={cardIndex <= 0}
                      onClick={() => {
                        setCardIndex((i) => i - 1);
                        setCardFlipped(false);
                      }}
                      className="min-h-[40px] rounded-xl border border-slate-200 px-4 text-xs font-semibold disabled:opacity-40 dark:border-slate-700"
                    >
                      Previous Card
                    </button>
                    <button
                      type="button"
                      disabled={cardIndex >= flashcards.length - 1}
                      onClick={() => {
                        setCardIndex((i) => i + 1);
                        setCardFlipped(false);
                      }}
                      className="min-h-[40px] rounded-xl border border-slate-200 px-4 text-xs font-semibold disabled:opacity-40 dark:border-slate-700"
                    >
                      Next Card
                    </button>
                  </div>
                </div>
              )}

              {/* 5-Question Quiz */}
              {quiz.length > 0 && (
                <div className="space-y-4 border-t border-slate-200 pt-5 dark:border-slate-800">
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      5-Question Mastery Quiz
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Score 4/5 or higher to earn +🪙1 (max 3 quiz rewards per day).
                    </p>
                  </div>

                  {quiz.map((q, qIdx) => {
                    const correction = quizResult?.corrections[qIdx];
                    return (
                      <div
                        key={qIdx}
                        className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {qIdx + 1}. {q.question}
                        </p>
                        <div className="mt-3 space-y-2">
                          {q.options.map((opt, oIdx) => {
                            const selected = quizAnswers[qIdx] === oIdx;
                            const isCorrect = correction && correction.correctIndex === oIdx;
                            const isWrongPick =
                              correction && correction.selectedIndex === oIdx && !correction.isCorrect;
                            return (
                              <button
                                key={oIdx}
                                type="button"
                                disabled={Boolean(quizResult)}
                                onClick={() =>
                                  setQuizAnswers((prev) => ({ ...prev, [qIdx]: oIdx }))
                                }
                                className={`flex min-h-[42px] w-full items-center rounded-xl border px-3.5 py-2 text-left text-xs font-medium transition-colors ${
                                  isCorrect
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'
                                    : isWrongPick
                                      ? 'border-rose-400 bg-rose-50 text-rose-900 dark:bg-rose-950/50 dark:text-rose-200'
                                      : selected
                                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200'
                                        : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                        {correction && (
                          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                            {correction.explanation}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {!quizResult ? (
                    <button
                      type="button"
                      disabled={submittingQuiz}
                      onClick={handleSubmitQuiz}
                      className="w-full min-h-[44px] rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {submittingQuiz ? 'Grading...' : 'Submit Quiz Answers'}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm font-semibold text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
                      Score: {quizResult.score} / {quizResult.total}
                      {quizResult.coinsAwarded > 0
                        ? ` — +🪙${quizResult.coinsAwarded} credited!`
                        : ''}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Ask This Note Grounded Chat */}
      {tab === 'ask' && fullAccess && (
        <div className="p-4 sm:p-6 space-y-4">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Ask this note
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Answers strictly using content inside “{noteTitle}”.
            </p>
          </div>

          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 select-text dark:border-slate-800 dark:bg-slate-950">
            {askHistory.length === 0 ? (
              <p className="text-xs text-slate-500">
                Try asking: “Summarize the main formula” or “Explain the exam tip on page 1”.
              </p>
            ) : (
              askHistory.map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    You: {item.q}
                  </p>
                  <p className="rounded-xl bg-white p-3 text-sm text-slate-800 border border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                    {item.a}
                  </p>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleAskNote} className="flex gap-2">
            <label htmlFor="ask-note-input" className="sr-only">
              Ask a question about this note
            </label>
            <input
              id="ask-note-input"
              type="text"
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              placeholder="Ask a question grounded in this note..."
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={asking || !askQuestion.trim()}
              aria-label="Send question"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
