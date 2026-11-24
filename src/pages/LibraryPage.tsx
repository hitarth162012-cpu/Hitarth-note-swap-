import { useEffect, useState } from 'react';
import { BookOpen, Bookmark } from 'lucide-react';
import { NoteCard } from '../components/NoteCard';
import { NoteGridSkeleton } from '../components/Skeletons';
import { apiRequest } from '../lib/api';
import type { Language, NoteSummary, UserProfile } from '../types';

interface LibraryPageProps {
  user: UserProfile | null;
  lang: Language;
  onOpenAuth: () => void;
  onOpenNote: (noteId: string) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function LibraryPage({ user, lang, onOpenAuth, onOpenNote, onToast }: LibraryPageProps) {
  const [tab, setTab] = useState<'unlocked' | 'bookmarks'>('unlocked');
  const [library, setLibrary] = useState<NoteSummary[]>([]);
  const [bookmarks, setBookmarks] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ library: NoteSummary[]; bookmarks: NoteSummary[] }>('/api/notes/my/library');
      setLibrary(res.library);
      setBookmarks(res.bookmarks);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [user?.id]);

  async function handleBookmark(noteId: string) {
    try {
      await apiRequest(`/api/notes/${noteId}/bookmark`, { method: 'POST' });
      await load();
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <BookOpen className="mx-auto h-10 w-10 text-indigo-500" />
          <h1 className="mt-3 font-display text-2xl font-bold text-slate-900 dark:text-white">
            My Study Library
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Sign in to access all notes you have unlocked with Coins — available forever.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-5 min-h-[44px] rounded-xl bg-indigo-600 px-6 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const items = tab === 'unlocked' ? library : bookmarks;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            My Library
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            All unlocked notes stay in your library forever, complete with Gemini AI study tools.
          </p>
        </div>

        <div className="flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setTab('unlocked')}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              tab === 'unlocked'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Unlocked ({library.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('bookmarks')}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
              tab === 'bookmarks'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Bookmark className="h-4 w-4" />
            Saved ({bookmarks.length})
          </button>
        </div>
      </div>

      {loading ? (
        <NoteGridSkeleton count={3} />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="font-display text-base font-bold text-slate-900 dark:text-white">
            {tab === 'unlocked' ? 'No unlocked notes yet' : 'No bookmarked notes yet'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {tab === 'unlocked'
              ? 'Unlock a note with Coins or try a Free Sample note from the home feed.'
              : 'Bookmark notes you want to unlock later.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
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
