import { useState } from 'react';
import { Bookmark, Lock, Unlock, Star, ShieldCheck, FileText } from 'lucide-react';
import type { Language, NoteSummary } from '../types';
import { t } from '../i18n';

interface NoteCardProps {
  note: NoteSummary;
  lang: Language;
  onOpen: (noteId: string) => void;
  onToggleBookmark?: (noteId: string) => void;
}

export function NoteCard({ note, lang, onOpen, onToggleBookmark }: NoteCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white transition-transform duration-200 hover:-translate-y-0.5 dark:border-slate-800 dark:bg-slate-900">
      {/* Blurred / Teaser Preview Thumbnail */}
      <button
        type="button"
        onClick={() => onOpen(note.id)}
        className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left dark:bg-slate-800"
        aria-label={`Open note ${note.title}`}
      >
        {!imgFailed ? (
          <img
            src={note.coverImage}
            alt={note.title}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
              note.isUnlocked || note.isFreeSample ? '' : 'blur-[3px] brightness-95'
            }`}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4 text-slate-500 dark:from-slate-800 dark:to-slate-900">
            <FileText className="h-8 w-8 opacity-60" />
            <span className="mt-2 text-xs font-medium">{note.subject}</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/15 to-transparent" />

        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs font-medium text-white">
          <span className="flex items-center gap-1.5">
            {note.isUnlocked || note.isFreeSample ? (
              <>
                <Unlock className="h-3.5 w-3.5 text-emerald-300" />
                <span>{note.isFreeSample ? t(lang, 'freeSample') : t(lang, 'unlocked')}</span>
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5 text-amber-300" />
                <span>
                  {note.previewPagesCount > 0
                    ? `${note.previewPagesCount} free preview`
                    : 'Locked preview'}
                </span>
              </>
            )}
          </span>
          <span className="font-mono-num">
            {note.fileType === 'pdf' ? 'PDF' : note.fileType === 'image' ? 'IMG' : ''}
            {note.fileType === 'pdf' || note.fileType === 'image' ? ' · ' : ''}
            {note.pageCount}p
          </span>
        </div>
      </button>

      {/* Card Body with Zero-Pill Clean Typography */}
      <div className="flex flex-1 flex-col p-4">
        {(note.isGeminiNote || note.isPyq) && (
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>
              {note.isGeminiNote
                ? t(lang, 'officialGemini')
                : `${t(lang, 'previousYearPaper')} ${note.pyqYear}`}
            </span>
          </div>
        )}

        {/* Clean Unboxed Metadata */}
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">{note.subject}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate max-w-[140px]">{note.examClass}</span>
          {note.ratingCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-0.5 font-mono-num text-amber-600 dark:text-amber-400">
                <Star className="h-3 w-3 fill-current" />
                {note.ratingAvg}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onOpen(note.id)}
          className="mt-1.5 text-left font-display text-base font-bold leading-snug text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400 line-clamp-2"
        >
          {note.title}
        </button>

        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-2">
          {note.description}
        </p>

        <div className="mt-auto pt-4 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/80">
          <div className="min-w-0 text-xs text-slate-500 dark:text-slate-400">
            <span className="truncate block font-medium text-slate-700 dark:text-slate-300">
              {note.uploaderName}
            </span>
            <span className="text-[11px]">{note.uploaderLevel}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onToggleBookmark && (
              <button
                type="button"
                onClick={() => onToggleBookmark(note.id)}
                aria-label={note.isBookmarked ? `Remove bookmark for ${note.title}` : `Bookmark ${note.title}`}
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Bookmark
                  className={`h-4 w-4 ${note.isBookmarked ? 'fill-indigo-600 text-indigo-600 dark:fill-indigo-400 dark:text-indigo-400' : ''}`}
                />
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpen(note.id)}
              className="min-h-[40px] rounded-xl bg-slate-900 px-3.5 py-2 font-mono-num text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 whitespace-nowrap"
            >
              {note.isFreeSample
                ? t(lang, 'freeSample')
                : note.isUnlocked
                  ? 'Read'
                  : `🪙${note.priceCoins}`}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
