import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Flag,
  Lock,
  RotateCcw,
  ShieldCheck,
  Star,
  UserPlus,
  UserCheck,
  MessageCircle,
} from 'lucide-react';
import { SecureViewer } from '../components/SecureViewer';
import { apiRequest } from '../lib/api';
import type { AchievementItem, Language, NoteReview, NoteSummary, UserProfile } from '../types';
import { getAccentClasses, t } from '../i18n';

interface NoteDetailPageProps {
  noteId: string;
  user: UserProfile | null;
  lang: Language;
  onBack: () => void;
  onOpenAuth: () => void;
  onShareInChat: (noteId: string) => void;
  onCoinsChange: (newBalance: number, delta: number, label: string, achievements?: AchievementItem[]) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
  onAskGeminiHelp?: (errorText: string, contextPage: string) => void;
}

export function NoteDetailPage({
  noteId,
  user,
  lang,
  onBack,
  onOpenAuth,
  onShareInChat,
  onCoinsChange,
  onToast,
  onAskGeminiHelp,
}: NoteDetailPageProps) {
  const [note, setNote] = useState<NoteSummary | null>(null);
  const [reviews, setReviews] = useState<NoteReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);

  // Review state
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Report & Refund modals
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<'copyright' | 'spam' | 'wrong_content'>('wrong_content');
  const [reportDetails, setReportDetails] = useState('');
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState('');

  const accent = getAccentClasses(user?.equippedTheme || 'indigo');

  async function loadDetail() {
    setLoading(true);
    try {
      const res = await apiRequest<{ note: NoteSummary; reviews: NoteReview[] }>(`/api/notes/${noteId}`);
      setNote(res.note);
      setReviews(res.reviews);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [noteId, user?.id]);

  async function handleUnlock() {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!note) return;
    setUnlocking(true);
    try {
      const res = await apiRequest<{
        coinsBalance: number;
        spentCoins: number;
        referralCredited: boolean;
        newlyUnlocked?: AchievementItem[];
      }>(`/api/notes/${note.id}/unlock`, { method: 'POST' });

      onCoinsChange(res.coinsBalance, -res.spentCoins, 'Note Unlocked', res.newlyUnlocked);
      onToast(
        'success',
        res.referralCredited
          ? 'Note unlocked! +🪙5 Referral bonus credited to you & your friend!'
          : 'Note unlocked forever in My Library!',
      );
      await loadDetail();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setUnlocking(false);
    }
  }

  async function handleFollow() {
    if (!user || !note) {
      onOpenAuth();
      return;
    }
    try {
      const res = await apiRequest<{ following: boolean }>(`/api/community/users/${note.uploaderId}/follow`, {
        method: 'POST',
      });
      setNote({ ...note, isFollowingUploader: res.following });
      onToast('success', res.following ? `Following ${note.uploaderName}` : `Unfollowed ${note.uploaderName}`);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleBookmark() {
    if (!user || !note) {
      onOpenAuth();
      return;
    }
    try {
      const res = await apiRequest<{ bookmarked: boolean }>(`/api/notes/${note.id}/bookmark`, {
        method: 'POST',
      });
      setNote({ ...note, isBookmarked: res.bookmarked });
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!note) return;
    setSubmittingReview(true);
    try {
      await apiRequest(`/api/notes/${note.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment }),
      });
      setComment('');
      onToast('success', 'Thank you for your verified buyer review!');
      await loadDetail();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSubmittingReview(false);
    }
  }

  async function handleReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note) return;
    try {
      const res = await apiRequest<{ autoHidden: boolean }>(`/api/notes/${note.id}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason: reportReason, details: reportDetails }),
      });
      setShowReport(false);
      setReportDetails('');
      onToast(
        'info',
        res.autoHidden
          ? 'Report submitted. This note has been auto-hidden for admin moderation.'
          : 'Report submitted for admin review.',
      );
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleRefundSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note) return;
    try {
      await apiRequest(`/api/notes/${note.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: refundReason }),
      });
      setShowRefund(false);
      setRefundReason('');
      onToast('success', '24-hour Coin refund request sent to Admin.');
      await loadDetail();
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  if (loading) {
    return <div className="h-96 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />;
  }

  if (!note) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold">Note not found.</p>
        <button type="button" onClick={onBack} className="mt-4 text-sm font-semibold text-indigo-600">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Notes</span>
      </button>

      {/* Main Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-6">
          {note.isUnlocked || note.hasPreviewPages ? (
            <SecureViewer
              noteId={note.id}
              noteTitle={note.title}
              lang={lang}
              fullAccess={Boolean(note.isUnlocked)}
              onCoinsChange={onCoinsChange}
              onToast={onToast}
              onAskGeminiHelp={onAskGeminiHelp}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="relative overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
                <img
                  src={`/api/notes/${note.id}/preview`}
                  alt={`Blurred preview of ${note.title}`}
                  className="mx-auto block w-full max-w-lg"
                />
              </div>
            </div>
          )}

          {/* Reviews (Buyer-Only) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Verified Buyer Reviews ({reviews.length})
            </h2>

            {note.canReview && (
              <form onSubmit={handleSubmitReview} className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Leave a rating &amp; review
                </p>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setRating(s)}
                      aria-label={`Rate ${s} stars`}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center"
                    >
                      <Star
                        className={`h-5 w-5 ${
                          s <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="How helpful were these notes for your exam prep?"
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={submittingReview}
                  className={`min-h-[40px] rounded-xl px-4 text-xs font-semibold ${accent.btn}`}
                >
                  {submittingReview ? 'Posting...' : 'Submit Review'}
                </button>
              </form>
            )}

            <div className="mt-4 space-y-3">
              {reviews.length === 0 ? (
                <p className="text-xs text-slate-500">No buyer reviews yet.</p>
              ) : (
                reviews.map((rv) => (
                  <div
                    key={rv.id}
                    className="border-b border-slate-100 pb-3 last:border-b-0 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {rv.buyerName}
                      </span>
                      <span className="font-mono-num text-amber-600 dark:text-amber-400">
                        ★ {rv.rating}/5
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{rv.comment}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Sticky Purchase & Metadata Sidebar */}
        <aside className="lg:col-span-4 space-y-4">
          <div className="sticky top-20 rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900">
            {(note.isGeminiNote || note.isPyq) && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <ShieldCheck className="h-4 w-4" />
                <span>
                  {note.isGeminiNote
                    ? t(lang, 'officialGemini')
                    : `${t(lang, 'previousYearPaper')} ${note.pyqYear}`}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span>{note.subject}</span>
              <span>·</span>
              <span>{note.examClass}</span>
              <span>·</span>
              <span className="font-mono-num">
                {note.fileType === 'pdf' ? 'PDF' : note.fileType === 'image' ? 'Images' : 'Note'} · {note.pageCount} pages
              </span>
              {note.ratingCount > 0 && (
                <>
                  <span>·</span>
                  <span className="font-mono-num text-amber-600 dark:text-amber-400">
                    ★ {note.ratingAvg} ({note.ratingCount})
                  </span>
                </>
              )}
            </div>

            <h1 className="font-display text-xl font-extrabold text-slate-900 dark:text-white">
              {note.title}
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {note.description}
            </p>

            {/* Uploader row */}
            <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {note.uploaderName}
                </p>
                <p className="text-xs text-slate-500">
                  {note.uploaderLevel} · {note.salesCount} unlocks
                </p>
              </div>
              {user?.id !== note.uploaderId && (
                <button
                  type="button"
                  onClick={handleFollow}
                  className="flex min-h-[38px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {note.isFollowingUploader ? (
                    <>
                      <UserCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Following</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Follow</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Primary Unlock CTA */}
            {!note.isUnlocked ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={unlocking}
                  onClick={handleUnlock}
                  className={`flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold shadow-sm transition-colors disabled:opacity-50 ${accent.btn}`}
                >
                  <Lock className="h-4 w-4" />
                  <span>
                    {unlocking
                      ? 'Unlocking...'
                      : note.isFreeSample
                        ? 'Unlock Free Sample'
                        : `${t(lang, 'unlockFor')} 🪙${note.priceCoins}`}
                  </span>
                </button>
                {!note.isGeminiNote && !note.isPyq && !note.isFreeSample && (
                  <p className="text-center text-[11px] text-slate-500">
                    Uploader earns 🪙{Math.floor(note.priceCoins / 2)} · Virtual Coins have no cash value
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Unlocked in your Library forever · AI Study Studio active above
              </div>
            )}

            {/* Utility Actions */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={handleBookmark}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                <Bookmark className={`h-3.5 w-3.5 ${note.isBookmarked ? 'fill-indigo-600 text-indigo-600' : ''}`} />
                <span>{note.isBookmarked ? 'Saved' : 'Save'}</span>
              </button>
              <button
                type="button"
                onClick={() => onShareInChat(note.id)}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                <span>Share / Gift</span>
              </button>
              <button
                type="button"
                onClick={() => (user ? setShowReport(true) : onOpenAuth())}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400"
              >
                <Flag className="h-3.5 w-3.5" />
                <span>Report</span>
              </button>
              {note.canRequestRefund ? (
                <button
                  type="button"
                  onClick={() => setShowRefund(true)}
                  className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>24h Coin Refund</span>
                </button>
              ) : note.refundStatus ? (
                <div className="flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 text-[11px] font-medium text-slate-500 dark:border-slate-800">
                  Refund: {note.refundStatus}
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      {/* Report Modal */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleReportSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="font-display text-lg font-bold">Report Note</h3>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value as typeof reportReason)}
              className="min-h-[42px] w-full rounded-xl border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="wrong_content">Wrong / Misleading Content</option>
              <option value="copyright">Copyright Infringement</option>
              <option value="spam">Spam / Unreadable Scans</option>
            </select>
            <textarea
              rows={3}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Optional details..."
              className="w-full rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReport(false)}
                className="min-h-[40px] rounded-xl px-4 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 24h Coin Refund Modal */}
      {showRefund && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleRefundSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 space-y-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="font-display text-lg font-bold">Request 24-Hour Coin Refund</h3>
            <p className="text-xs text-slate-500">
              If this note is unreadable or wrong, admin can return 🪙{note.priceCoins} to your balance.
            </p>
            <textarea
              rows={3}
              required
              minLength={8}
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Describe what is wrong or unreadable..."
              className="w-full rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRefund(false)}
                className="min-h-[40px] rounded-xl px-4 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[40px] rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white"
              >
                Submit Refund Request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
