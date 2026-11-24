import { useEffect, useState } from 'react';
import {
  Search,
  Sparkles,
  CalendarClock,
  HelpCircle,
  Trophy,
  BookOpen,
  Package,
  ArrowRight,
  Flame,
} from 'lucide-react';
import { NoteCard } from '../components/NoteCard';
import { NoteGridSkeleton } from '../components/Skeletons';
import { apiRequest } from '../lib/api';
import type {
  AchievementItem,
  GeminiBundle,
  Language,
  NavTab,
  NoteSummary,
  UserProfile,
} from '../types';
import { getAccentClasses, t } from '../i18n';

interface HomePageProps {
  user: UserProfile | null;
  lang: Language;
  onOpenNote: (noteId: string) => void;
  onNavigate: (tab: NavTab) => void;
  onSearchSubmit: (query: string) => void;
  onOpenAuth: () => void;
  onCoinsChange: (newBalance: number, delta: number, label: string, achievements?: AchievementItem[]) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function HomePage({
  user,
  lang,
  onOpenNote,
  onNavigate,
  onSearchSubmit,
  onOpenAuth,
  onCoinsChange,
  onToast,
}: HomePageProps) {
  const [section, setSection] = useState<'trending' | 'new' | 'top_rated' | 'free'>('trending');
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [examNotes, setExamNotes] = useState<NoteSummary[]>([]);
  const [bundles, setBundles] = useState<GeminiBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [unlockingBundleId, setUnlockingBundleId] = useState<string | null>(null);

  const accent = getAccentClasses(user?.equippedTheme || 'indigo');

  async function loadFeed(activeSection: string) {
    setLoading(true);
    try {
      const [notesRes, bundlesRes] = await Promise.all([
        apiRequest<{ notes: NoteSummary[] }>(`/api/notes?section=${encodeURIComponent(activeSection)}`),
        apiRequest<{ bundles: GeminiBundle[] }>('/api/notes/bundles'),
      ]);
      setNotes(notesRes.notes);
      setBundles(bundlesRes.bundles);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeed(section);
  }, [section, user?.id]);

  useEffect(() => {
    if (!user?.examCountdown?.exam_name) {
      setExamNotes([]);
      return;
    }
    apiRequest<{ notes: NoteSummary[] }>(
      `/api/notes?exam=${encodeURIComponent(user.examCountdown.exam_name.split(' ')[0])}`,
    )
      .then((res) => setExamNotes(res.notes.slice(0, 3)))
      .catch(() => setExamNotes([]));
  }, [user?.examCountdown?.exam_name, user?.id]);

  async function handleBookmark(noteId: string) {
    if (!user) {
      onOpenAuth();
      return;
    }
    try {
      const res = await apiRequest<{ bookmarked: boolean }>(`/api/notes/${noteId}/bookmark`, {
        method: 'POST',
      });
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, isBookmarked: res.bookmarked } : n)),
      );
      onToast('success', res.bookmarked ? 'Saved to Bookmarks' : 'Removed from Bookmarks');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleUnlockBundle(bundle: GeminiBundle) {
    if (!user) {
      onOpenAuth();
      return;
    }
    setUnlockingBundleId(bundle.id);
    try {
      const res = await apiRequest<{
        coinsBalance: number;
        newlyUnlocked?: AchievementItem[];
      }>(`/api/notes/bundles/${bundle.id}/unlock`, { method: 'POST' });
      onCoinsChange(res.coinsBalance, -bundle.bundlePriceCoins, 'Gemini Bundle', res.newlyUnlocked);
      onToast('success', `Unlocked "${bundle.title}"! Notes added to My Library.`);
      loadFeed(section);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setUnlockingBundleId(null);
    }
  }

  const tabs: Array<{ id: typeof section; label: string }> = [
    { id: 'trending', label: t(lang, 'trending') },
    { id: 'new', label: t(lang, 'newlyAdded') },
    { id: 'top_rated', label: t(lang, 'topRated') },
    { id: 'free', label: t(lang, 'freeSamples') },
  ];

  return (
    <div className="space-y-10">
      {/* Hero Split */}
      <section className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        <div className="flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              Student Study Marketplace · Virtual Coins Only
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance] dark:text-white">
              {t(lang, 'heroTitle')}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
              {t(lang, 'heroSubtitle')}
            </p>

            {/* Quick Search Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSearchSubmit(searchInput);
              }}
              className="mt-5 flex gap-2"
            >
              <label htmlFor="home-search" className="sr-only">
                Search study notes
              </label>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="home-search"
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t(lang, 'searchPlaceholder')}
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <button
                type="submit"
                className={`min-h-[44px] rounded-xl px-5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${accent.btn}`}
              >
                {t(lang, 'search')}
              </button>
            </form>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => onNavigate('upload')}
              className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {t(lang, 'uploadNotesCta')}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('doubts')}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <HelpCircle className="h-4 w-4" />
              <span>{t(lang, 'doubts')}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('leaderboard')}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Trophy className="h-4 w-4 text-amber-500" />
              <span>{t(lang, 'leaderboard')}</span>
            </button>
            {user && (
              <button
                type="button"
                onClick={() => onNavigate('library')}
                className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <BookOpen className="h-4 w-4" />
                <span>{t(lang, 'library')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Hero Right Visual */}
        <div className="relative min-h-[220px] overflow-hidden rounded-3xl border border-slate-200/80 lg:col-span-5 dark:border-slate-800">
          <img
            src="/src/assets/images/hero_study_desk_1795530739424.jpg"
            alt="Organized handwritten study notebooks on a desk"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-transparent" />
          <div className="absolute bottom-5 left-5 right-5 text-white">
            {user?.examCountdown ? (
              <div className="rounded-2xl bg-slate-950/75 p-4 backdrop-blur-md border border-white/10">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <CalendarClock className="h-4 w-4" />
                    Exam Countdown
                  </span>
                  <span className="font-mono-num text-sm font-bold text-white">
                    {user.examCountdown.daysLeft >= 0
                      ? `${user.examCountdown.daysLeft} days left`
                      : 'Exam passed'}
                  </span>
                </div>
                <p className="mt-1 text-sm font-bold">{user.examCountdown.exam_name}</p>
                {user.examCountdown.daysLeft >= 0 &&
                  user.examCountdown.daysLeft <= user.examCountdown.reminder_days && (
                    <p className="mt-1 text-xs text-emerald-300">
                      Revision reminder active — revise with AI Flashcards &amp; PYQs below!
                    </p>
                  )}
              </div>
            ) : (
              <div>
                <p className="font-mono-num text-xs font-semibold text-amber-300">
                  50% Creator Split · 🪙10 Welcome Bonus
                </p>
                <p className="mt-1 font-display text-lg font-bold">
                  Turn your neat handwritten notes into study Coins.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Personalized Exam Section */}
      {user?.examCountdown && examNotes.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                {t(lang, 'forYourExam')}: {user.examCountdown.exam_name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Curated study packs &amp; PYQs matching your upcoming exam countdown
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Edit Exam Date
            </button>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {examNotes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                lang={lang}
                onOpen={onOpenNote}
                onToggleBookmark={handleBookmark}
              />
            ))}
          </div>
        </section>
      )}

      {/* Gemini Official Bundles */}
      {bundles.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Gemini Official Bundles
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('doubts')}
              className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              <span>Request a Topic</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {bundles.map((b) => (
              <div
                key={b.id}
                className="flex flex-col justify-between rounded-2xl border border-amber-200/80 bg-white p-5 dark:border-amber-900/50 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <span className="flex items-center gap-1.5">
                      <Package className="h-4 w-4" />
                      Official Bundle · Save 🪙{b.savingsCoins}
                    </span>
                    <span className="font-mono-num line-through text-slate-400">
                      🪙{b.regularTotalCoins}
                    </span>
                  </div>
                  <h3 className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white">
                    {b.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{b.description}</p>
                  <ul className="mt-3 space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    {b.notes.map((bn) => (
                      <li key={bn.id}>• {bn.title}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="font-mono-num text-base font-bold text-slate-900 dark:text-white">
                    🪙{b.bundlePriceCoins}
                  </span>
                  <button
                    type="button"
                    disabled={b.allUnlocked || unlockingBundleId === b.id}
                    onClick={() => handleUnlockBundle(b)}
                    className={`min-h-[42px] rounded-xl px-4 text-xs font-semibold transition-colors disabled:opacity-50 ${accent.btn}`}
                  >
                    {b.allUnlocked
                      ? 'All Notes Unlocked'
                      : unlockingBundleId === b.id
                        ? 'Unlocking...'
                        : `Unlock Bundle · 🪙${b.bundlePriceCoins}`}
                  </button>
                </div>
              </div>
            ))}

            {bundles.length === 1 && (
              <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    <Flame className="h-4 w-4 text-amber-500" />
                    <span>Daily Free Coins &amp; Topic Requests</span>
                  </div>
                  <h3 className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white">
                    Earn up to 🪙9 daily without spending
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    Claim your daily streak (+🪙1, or +🪙4 on Day 7), spin the 24h reward wheel (🪙0–5), or score 4/5+ on Gemini note quizzes (+🪙1 each).
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => onNavigate('wallet')}
                    className="min-h-[42px] rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
                  >
                    Open Coin Wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('doubts')}
                    className="min-h-[42px] rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                  >
                    Vote Gemini Topics
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Main Marketplace Feed */}
      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              Study Notes Marketplace
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Browse note collections"
            className="flex items-center gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80"
          >
            {tabs.map((tb) => (
              <button
                key={tb.id}
                role="tab"
                aria-selected={section === tb.id}
                type="button"
                onClick={() => setSection(tb.id)}
                className={`min-h-[38px] whitespace-nowrap shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors ${
                  section === tb.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <NoteGridSkeleton count={6} />
        ) : notes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="font-display text-base font-bold text-slate-800 dark:text-slate-200">
              {t(lang, 'noNotesFound')}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t(lang, 'tryDifferentSearch')}</p>
            <button
              type="button"
              onClick={() => onNavigate('upload')}
              className={`mt-4 min-h-[42px] rounded-xl px-5 text-xs font-semibold transition-colors ${accent.btn}`}
            >
              {t(lang, 'uploadNotesCta')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                lang={lang}
                onOpen={onOpenNote}
                onToggleBookmark={handleBookmark}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
