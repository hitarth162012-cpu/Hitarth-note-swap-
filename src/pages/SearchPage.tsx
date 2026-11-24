import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { NoteCard } from '../components/NoteCard';
import { NoteGridSkeleton } from '../components/Skeletons';
import { apiRequest } from '../lib/api';
import type { Language, NoteSummary, UserProfile } from '../types';
import { t } from '../i18n';

interface SearchPageProps {
  initialQuery: string;
  user: UserProfile | null;
  lang: Language;
  onOpenNote: (noteId: string) => void;
  onOpenAuth: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

const SUBJECTS = ['All', 'Physics', 'Chemistry', 'Mathematics', 'Computer Science', 'General Studies'];
const EXAMS = ['All', 'JEE Main & Adv', 'NEET & Class 12', 'B.Tech / GATE CS', 'UPSC / SSC / CUET'];

export function SearchPage({
  initialQuery,
  user,
  lang,
  onOpenNote,
  onOpenAuth,
  onToast,
}: SearchPageProps) {
  const [query, setQuery] = useState(initialQuery);
  const [subject, setSubject] = useState('All');
  const [exam, setExam] = useState('All');
  const [section, setSection] = useState('trending');
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  async function runSearch() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (query.trim()) qs.set('q', query.trim());
      if (subject !== 'All') qs.set('subject', subject);
      if (exam !== 'All') qs.set('exam', exam);
      qs.set('section', section);
      const res = await apiRequest<{ notes: NoteSummary[] }>(`/api/notes?${qs.toString()}`);
      setNotes(res.notes);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runSearch();
  }, [subject, exam, section, user?.id]);

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
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Search Student Study Notes
        </h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
          className="mt-4 flex gap-2"
        >
          <label htmlFor="search-input" className="sr-only">
            Search keywords
          </label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, 'searchPlaceholder')}
              className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-indigo-500 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            {t(lang, 'search')}
          </button>
        </form>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="filter-subject" className="block text-xs font-medium text-slate-500">
              Subject
            </label>
            <select
              id="filter-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-exam" className="block text-xs font-medium text-slate-500">
              Class / Exam
            </label>
            <select
              id="filter-exam"
              value={exam}
              onChange={(e) => setExam(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              {EXAMS.map((ex) => (
                <option key={ex} value={ex}>
                  {ex}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-sort" className="block text-xs font-medium text-slate-500">
              Collection / Sort
            </label>
            <select
              id="filter-sort"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="trending">Trending</option>
              <option value="new">Newly Added</option>
              <option value="top_rated">Top Rated</option>
              <option value="free">Free Samples</option>
            </select>
          </div>
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
    </div>
  );
}
