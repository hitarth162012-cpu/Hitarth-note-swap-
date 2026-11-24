import { useEffect, useState } from 'react';
import { UploadCloud, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { NoteSummary, UserProfile } from '../types';
import { getAccentClasses } from '../i18n';

interface UploadPageProps {
  user: UserProfile | null;
  onOpenAuth: () => void;
  onOpenNote: (noteId: string) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function UploadPage({ user, onOpenAuth, onOpenNote, onToast }: UploadPageProps) {
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Physics');
  const [examClass, setExamClass] = useState('JEE Main & Adv');
  const [description, setDescription] = useState('');
  const [priceCoins, setPriceCoins] = useState(10);
  const [tags, setTags] = useState('');
  const [copyrightDeclared, setCopyrightDeclared] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [myUploads, setMyUploads] = useState<NoteSummary[]>([]);
  const [stats, setStats] = useState({ totalUploads: 0, totalSales: 0, totalEarnedCoins: 0 });
  const accent = getAccentClasses(user?.equippedTheme || 'indigo');

  async function loadUploads() {
    if (!user) return;
    try {
      const res = await apiRequest<{
        uploads: NoteSummary[];
        stats: { totalUploads: number; totalSales: number; totalEarnedCoins: number };
      }>('/api/notes/my/uploads');
      setMyUploads(res.uploads);
      setStats(res.stats);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadUploads();
  }, [user?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!files || files.length === 0) {
      onToast('error', 'Select a PDF or up to 10 page images');
      return;
    }
    if (!copyrightDeclared) {
      onToast('error', 'Confirm the copyright declaration checkbox first');
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('subject', subject);
      fd.append('examClass', examClass);
      fd.append('description', description);
      fd.append('priceCoins', String(priceCoins));
      fd.append('tags', tags);
      fd.append('copyrightDeclared', String(copyrightDeclared));
      Array.from(files).forEach((f) => fd.append('files', f));

      const res = await apiRequest<{ message: string }>('/api/notes/upload', {
        method: 'POST',
        body: fd,
      });
      onToast('success', res.message);
      setTitle('');
      setDescription('');
      setTags('');
      setCopyrightDeclared(false);
      setFiles(null);
      await loadUploads();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <UploadCloud className="mx-auto h-10 w-10 text-indigo-500" />
        <h1 className="mt-3 font-display text-xl font-bold">Upload Notes &amp; Earn Coins</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sign in to upload handwritten PDFs or images, earn up to 🪙2 on approval, and earn 50% of every unlock.
        </p>
        <button
          type="button"
          onClick={onOpenAuth}
          className={`mt-5 min-h-[44px] rounded-xl px-6 text-sm font-semibold ${accent.btn}`}
        >
          Sign in to Upload
        </button>
      </div>
    );
  }

  if (user.role !== 'student') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <UploadCloud className="mx-auto h-10 w-10 text-indigo-500" />
        <h1 className="mt-3 font-display text-xl font-bold text-slate-900 dark:text-white">
          Student-Only Note Uploads
        </h1>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
          Study notes on NoteSwap are contributed exclusively by students. Use your Admin Console to review and approve student submissions.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      {/* Upload Form */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-7 dark:border-slate-800 dark:bg-slate-900"
      >
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Upload Study Notes
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Files are stored privately, checked for SHA-256 duplicates, and earn up to 🪙2 upon admin approval.
          </p>
        </div>

        <div>
          <label htmlFor="up-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Note Title
          </label>
          <input
            id="up-title"
            type="text"
            required
            minLength={4}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Electrostatics & Gauss Law Complete Formulas"
            className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="up-subject" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Subject
            </label>
            <select
              id="up-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option>Physics</option>
              <option>Chemistry</option>
              <option>Mathematics</option>
              <option>Biology</option>
              <option>Computer Science</option>
              <option>General Studies</option>
            </select>
          </div>

          <div>
            <label htmlFor="up-exam" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Class / Exam
            </label>
            <select
              id="up-exam"
              value={examClass}
              onChange={(e) => setExamClass(e.target.value)}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option>JEE Main &amp; Adv</option>
              <option>NEET &amp; Class 12</option>
              <option>B.Tech / GATE CS</option>
              <option>UPSC / SSC / CUET</option>
              <option>Class 11 &amp; Boards</option>
            </select>
          </div>

          <div>
            <label htmlFor="up-price" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Price (🪙1 – 🪙50)
            </label>
            <input
              id="up-price"
              type="number"
              min={1}
              max={50}
              value={priceCoins}
              onChange={(e) => setPriceCoins(Number(e.target.value))}
              className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 px-3 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        <div>
          <label htmlFor="up-desc" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Short Description (shown publicly before unlock)
          </label>
          <textarea
            id="up-desc"
            rows={3}
            required
            minLength={15}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Summarize what topics, derivations, or solved examples are inside..."
            className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div>
          <label htmlFor="up-tags" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Tags (comma separated)
          </label>
          <input
            id="up-tags"
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Mechanics, Formulas, PYQ"
            className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 px-3.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        <div>
          <label htmlFor="up-files" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Study File (1 PDF up to 10 MB, or up to 10 PNG/JPG/WebP Images)
          </label>
          <input
            id="up-files"
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => setFiles(e.target.files)}
            className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-50 file:px-4 file:py-2.5 file:text-xs file:font-semibold file:text-indigo-700 dark:text-slate-300 dark:file:bg-indigo-950 dark:file:text-indigo-300"
          />
          {files && files.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              <span>
                Selected:{' '}
                <strong className="font-semibold">
                  {files.length === 1 && files[0].type === 'application/pdf'
                    ? `PDF (${files[0].name})`
                    : `${files.length} Image${files.length > 1 ? 's' : ''}`}
                </strong>{' '}
                · {(Array.from(files).reduce((s, f) => s + f.size, 0) / (1024 * 1024)).toFixed(2)} MB
              </span>
              <button
                type="button"
                onClick={() => setFiles(null)}
                className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={copyrightDeclared}
            onChange={(e) => setCopyrightDeclared(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>I created these notes myself and hold full rights to share them on NoteSwap.</span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className={`w-full min-h-[46px] rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${accent.btn}`}
        >
          {submitting ? 'Uploading Privately...' : 'Submit Note for Review'}
        </button>
      </form>

      {/* My Uploads & Per-Note Stats */}
      <div className="space-y-4 lg:col-span-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            My Uploads &amp; Creator Stats
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
              <p className="font-mono-num text-xl font-bold">{stats.totalUploads}</p>
              <p className="text-[11px] text-slate-500">Notes</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
              <p className="font-mono-num text-xl font-bold">{stats.totalSales}</p>
              <p className="text-[11px] text-slate-500">Unlocks</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950">
              <p className="font-mono-num text-xl font-bold text-emerald-600 dark:text-emerald-400">
                🪙{stats.totalEarnedCoins}
              </p>
              <p className="text-[11px] text-slate-500">Earned</p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {myUploads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              No uploads yet. Submit your first study sheet!
            </div>
          ) : (
            myUploads.map((u) => (
              <div
                key={u.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenNote(u.id)}
                    className="text-left font-display text-sm font-bold text-slate-900 hover:text-indigo-600 dark:text-white"
                  >
                    {u.title}
                  </button>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold shrink-0">
                    {u.status === 'approved' ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-700 dark:text-emerald-400">Approved</span>
                      </>
                    ) : u.status === 'rejected' ? (
                      <>
                        <XCircle className="h-3.5 w-3.5 text-rose-600" />
                        <span className="text-rose-700 dark:text-rose-400">Rejected</span>
                      </>
                    ) : (
                      <>
                        <Clock className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-amber-700 dark:text-amber-400">Pending</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 font-mono-num text-xs text-slate-500">
                  <span>Price: 🪙{u.priceCoins}</span>
                  <span>·</span>
                  <span>Unlocks: {u.salesCount}</span>
                  <span>·</span>
                  <span>Earned: 🪙{u.totalEarnedCoins + u.uploadRewardCoins}</span>
                </div>
                {u.rejectionReason && (
                  <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                    Reason: {u.rejectionReason}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
