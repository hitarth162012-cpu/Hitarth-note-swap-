import { useEffect, useState } from 'react';
import {
  Shield,
  BarChart3,
  CheckCircle2,
  XCircle,
  Ticket,
  RefreshCcw,
  Flag,
  Users,
  Sparkles,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { NoteSummary, UserProfile } from '../types';

interface AdminPageProps {
  user: UserProfile | null;
  onOpenAuth: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

type AdminTab = 'analytics' | 'queue' | 'codes' | 'refunds' | 'reports' | 'users';

export function AdminPage({ user, onOpenAuth, onToast }: AdminPageProps) {
  const [tab, setTab] = useState<AdminTab>('analytics');
  const [dashboard, setDashboard] = useState<{
    stats: {
      totalUnlocks: number;
      totalStudents: number;
      pendingNotes: number;
      openNoteReports: number;
      openChatReports: number;
      pendingRefunds: number;
      coinsBurnedTotal: number;
      coinsCirculating: number;
    };
    analytics: {
      topSubjects: Array<{ subject: string; noteCount: number; totalUnlocks: number }>;
      zeroResultSearches: Array<{ query: string; searchCount: number }>;
      peakHours: Array<{ hour: number; count: number }>;
    };
  } | null>(null);

  const [queue, setQueue] = useState<Array<Record<string, unknown>>>([]);
  const [rewardMap, setRewardMap] = useState<Record<string, number>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const [codes, setCodes] = useState<Array<Record<string, unknown>>>([]);
  const [newCode, setNewCode] = useState('');
  const [newCodeCoins, setNewCodeCoins] = useState(15);
  const [newCodeLimit, setNewCodeLimit] = useState(100);
  const [newCodeExpiry, setNewCodeExpiry] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [newCodeNote, setNewCodeNote] = useState('');

  const [geminiNotes, setGeminiNotes] = useState<NoteSummary[]>([]);
  const [bundleTitle, setBundleTitle] = useState('');
  const [bundlePrice, setBundlePrice] = useState(25);
  const [bundleNoteIds, setBundleNoteIds] = useState<string[]>([]);
  const [geminiRequests, setGeminiRequests] = useState<
    Array<{ id: string; topic: string; subject: string; examClass: string; votesCount: number; status: string }>
  >([]);

  const [refunds, setRefunds] = useState<Array<Record<string, unknown>>>([]);
  const [reportsData, setReportsData] = useState<{
    noteReports: Array<Record<string, unknown>>;
    chatReports: Array<Record<string, unknown>>;
    suspiciousTransfers: Array<Record<string, unknown>>;
  }>({ noteReports: [], chatReports: [], suspiciousTransfers: [] });

  const [usersData, setUsersData] = useState<{
    users: Array<Record<string, unknown>>;
    auditLogs: Array<Record<string, unknown>>;
  }>({ users: [], auditLogs: [] });

  async function loadTabData(active = tab) {
    if (!user || user.role !== 'admin') return;
    try {
      if (active === 'analytics') {
        const res = await apiRequest<typeof dashboard>('/api/admin/dashboard');
        setDashboard(res);
      } else if (active === 'queue') {
        const res = await apiRequest<{ queue: Array<Record<string, unknown>> }>('/api/admin/queue');
        setQueue(res.queue);
      } else if (active === 'codes') {
        const [cRes, nRes, gRes] = await Promise.all([
          apiRequest<{ codes: Array<Record<string, unknown>> }>('/api/admin/redeem-codes'),
          apiRequest<{ notes: NoteSummary[] }>('/api/notes?section=gemini'),
          apiRequest<{
            requests: Array<{
              id: string;
              topic: string;
              subject: string;
              examClass: string;
              votesCount: number;
              status: string;
            }>;
          }>('/api/community/gemini-requests'),
        ]);
        setCodes(cRes.codes);
        setGeminiNotes(nRes.notes);
        setGeminiRequests(gRes.requests);
      } else if (active === 'refunds') {
        const res = await apiRequest<{ refunds: Array<Record<string, unknown>> }>('/api/admin/refunds');
        setRefunds(res.refunds);
      } else if (active === 'reports') {
        const res = await apiRequest<typeof reportsData>('/api/admin/reports');
        setReportsData(res);
      } else if (active === 'users') {
        const res = await apiRequest<typeof usersData>('/api/admin/users');
        setUsersData(res);
      }
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  useEffect(() => {
    loadTabData(tab);
  }, [tab, user?.id, user?.role]);

  if (!user || user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <Shield className="mx-auto h-10 w-10 text-indigo-600" />
          <h1 className="mt-3 font-display text-2xl font-bold text-slate-900 dark:text-white">
            Admin Console Access Required
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Sign in with your Admin passcode to review student uploads, manage redeem codes, and view analytics.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-5 min-h-[44px] rounded-xl bg-slate-900 px-6 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
          >
            Admin Sign In
          </button>
        </div>
      </div>
    );
  }

  async function handleReviewNote(noteId: string, decision: 'approve' | 'reject') {
    try {
      await apiRequest(`/api/admin/notes/${noteId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          uploadRewardCoins: rewardMap[noteId] ?? 2,
          rejectionReason: rejectReasons[noteId] || 'Incomplete or unreadable note pages',
        }),
      });
      onToast('success', decision === 'approve' ? 'Note approved & Coins awarded' : 'Note rejected');
      await loadTabData('queue');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleCreateCode(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/redeem-codes', {
        method: 'POST',
        body: JSON.stringify({
          code: newCode,
          valueCoins: newCodeCoins,
          usageLimit: newCodeLimit,
          expiresAt: newCodeExpiry,
          note: newCodeNote,
        }),
      });
      setNewCode('');
      setNewCodeNote('');
      onToast('success', 'Redeem code created!');
      await loadTabData('codes');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleCreateBundle(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/bundles', {
        method: 'POST',
        body: JSON.stringify({
          title: bundleTitle,
          bundlePriceCoins: bundlePrice,
          noteIds: bundleNoteIds,
        }),
      });
      setBundleTitle('');
      setBundleNoteIds([]);
      onToast('success', 'Gemini Bundle created!');
      await loadTabData('codes');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleProcessRefund(id: string, approve: boolean) {
    try {
      await apiRequest(`/api/admin/refunds/${id}/process`, {
        method: 'POST',
        body: JSON.stringify({ approve }),
      });
      onToast('success', approve ? 'Coin refund approved' : 'Refund declined');
      await loadTabData('refunds');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleResolveNoteReport(id: string, action: 'dismiss' | 'remove_note') {
    try {
      await apiRequest(`/api/admin/reports/note/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      onToast('success', 'Note report updated');
      await loadTabData('reports');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleResolveChatReport(
    id: string,
    action: 'dismiss' | 'delete_msg' | 'mute_user' | 'ban_user',
  ) {
    try {
      await apiRequest(`/api/admin/reports/chat/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      onToast('success', `Chat report action (${action}) applied`);
      await loadTabData('reports');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  async function handleUserStatus(userId: string, action: 'ban' | 'unban' | 'mute' | 'unmute') {
    try {
      await apiRequest(`/api/admin/users/${userId}/status`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      onToast('success', `User ${action} applied`);
      await loadTabData('users');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  const tabs: Array<{ id: AdminTab; label: string; icon: typeof BarChart3 }> = [
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'queue', label: 'Review Queue', icon: CheckCircle2 },
    { id: 'codes', label: 'Codes & Gemini', icon: Ticket },
    { id: 'refunds', label: '24h Refunds', icon: RefreshCcw },
    { id: 'reports', label: 'Reports & Safety', icon: Flag },
    { id: 'users', label: 'Users & Audit', icon: Users },
  ];

  const maxHourCount = Math.max(1, ...(dashboard?.analytics.peakHours.map((h) => h.count) || [1]));

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Admin Console
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Moderation, Coin economy oversight, Gemini bundles, and zero-result search analytics.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((tItem) => {
          const Icon = tItem.icon;
          const active = tab === tItem.id;
          return (
            <button
              key={tItem.id}
              type="button"
              onClick={() => setTab(tItem.id)}
              className={`inline-flex min-h-[42px] shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-semibold transition-colors whitespace-nowrap ${
                active
                  ? 'bg-slate-900 text-white dark:bg-indigo-600'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tItem.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: ANALYTICS */}
      {tab === 'analytics' && dashboard && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Total Unlocks', value: dashboard.stats.totalUnlocks },
              { label: 'Students', value: dashboard.stats.totalStudents },
              { label: 'Pending Review', value: dashboard.stats.pendingNotes },
              { label: 'Coins Burned / Circulating', value: `🪙${dashboard.stats.coinsBurnedTotal} / 🪙${dashboard.stats.coinsCirculating}` },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                <p className="mt-1 font-mono-num text-2xl font-extrabold text-slate-900 dark:text-white">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Top Subjects by Unlocks
              </h2>
              <div className="mt-4 space-y-2.5">
                {dashboard.analytics.topSubjects.map((s) => (
                  <div key={s.subject} className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{s.subject}</span>
                    <span className="font-mono-num text-xs text-slate-500">
                      {s.totalUnlocks} unlocks · {s.noteCount} notes
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Zero-Result Search Keywords (Content Gaps)
              </h2>
              <div className="mt-4 space-y-2.5">
                {dashboard.analytics.zeroResultSearches.length === 0 ? (
                  <p className="text-sm text-slate-500">No zero-result searches recorded yet.</p>
                ) : (
                  dashboard.analytics.zeroResultSearches.map((z) => (
                    <div key={z.query} className="flex items-center justify-between text-sm">
                      <span className="font-medium text-rose-600 dark:text-rose-400">"{z.query}"</span>
                      <span className="font-mono-num text-xs text-slate-500">
                        {z.searchCount} searches
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Peak Activity Hours (UTC 00–23)
            </h2>
            <div className="mt-4 flex h-32 items-end gap-1.5">
              {dashboard.analytics.peakHours.map((h) => (
                <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    title={`${h.hour}:00 UTC — ${h.count} events`}
                    className="w-full rounded-t bg-indigo-500/80 dark:bg-indigo-400/80"
                    style={{ height: `${Math.max(6, Math.round((h.count / maxHourCount) * 100))}%` }}
                  />
                  <span className="font-mono-num text-[9px] text-slate-400">
                    {h.hour % 3 === 0 ? h.hour : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REVIEW QUEUE */}
      {tab === 'queue' && (
        <div className="space-y-4">
          {queue.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              No pending notes in the review queue.
            </div>
          ) : (
            queue.map((n) => {
              const id = String(n.id);
              return (
                <div
                  key={id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                        {String(n.title)}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {String(n.subject)} · {String(n.exam_class)} · Price: 🪙{Number(n.price_coins)} · By {String(n.uploader_name)}
                      </p>
                    </div>
                    <span className="text-xs font-bold uppercase text-amber-600">{String(n.status)}</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{String(n.description)}</p>
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Upload Reward (0–2 Coins):
                      <select
                        value={rewardMap[id] ?? 2}
                        onChange={(e) => setRewardMap((p) => ({ ...p, [id]: Number(e.target.value) }))}
                        className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono-num dark:border-slate-700 dark:bg-slate-950"
                      >
                        <option value={0}>🪙0</option>
                        <option value={1}>🪙1</option>
                        <option value={2}>🪙2</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleReviewNote(id, 'approve')}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </button>
                    <input
                      type="text"
                      value={rejectReasons[id] || ''}
                      onChange={(e) => setRejectReasons((p) => ({ ...p, [id]: e.target.value }))}
                      placeholder="Rejection reason..."
                      className="min-w-[180px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleReviewNote(id, 'reject')}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700"
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: REDEEM CODES & GEMINI BUNDLES/REQUESTS */}
      {tab === 'codes' && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={handleCreateCode}
              className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Create Redeem Code
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="EXAM20"
                  className="rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-sm uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={newCodeCoins}
                  onChange={(e) => setNewCodeCoins(Number(e.target.value))}
                  placeholder="Coins"
                  className="rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min={1}
                  value={newCodeLimit}
                  onChange={(e) => setNewCodeLimit(Number(e.target.value))}
                  placeholder="Usage limit"
                  className="rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <input
                  type="date"
                  value={newCodeExpiry}
                  onChange={(e) => setNewCodeExpiry(e.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <input
                type="text"
                value={newCodeNote}
                onChange={(e) => setNewCodeNote(e.target.value)}
                placeholder="Optional note (e.g., Diwali Offer)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-indigo-600 px-5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Create Code
              </button>
            </form>

            {geminiNotes.length > 0 && (
              <form
                onSubmit={handleCreateBundle}
                className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Create Gemini Bundle
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={bundleTitle}
                    onChange={(e) => setBundleTitle(e.target.value)}
                    placeholder="Bundle title"
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <input
                    type="number"
                    min={5}
                    value={bundlePrice}
                    onChange={(e) => setBundlePrice(Number(e.target.value))}
                    placeholder="Bundle Coins"
                    className="rounded-xl border border-slate-200 px-3 py-2 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1 text-xs">
                  {geminiNotes.map((gn) => (
                    <label key={gn.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bundleNoteIds.includes(gn.id)}
                        onChange={(e) =>
                          setBundleNoteIds((prev) =>
                            e.target.checked ? [...prev, gn.id] : prev.filter((i) => i !== gn.id),
                          )
                        }
                      />
                      <span className="truncate">{gn.title}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  className="min-h-[42px] rounded-xl bg-amber-600 px-5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Create Gemini Bundle
                </button>
              </form>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Active Redeem Codes & Topic Requests
            </h2>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {codes.map((c) => (
                <div key={String(c.id)} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <span className="font-mono-num font-bold text-slate-900 dark:text-white">
                      {String(c.code)}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      🪙{Number(c.value_coins)} · {Number(c.used_count)}/{Number(c.usage_limit)} used · {String(c.note || '')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      apiRequest(`/api/admin/redeem-codes/${c.id}/toggle`, { method: 'POST' }).then(() =>
                        loadTabData('codes'),
                      )
                    }
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold dark:border-slate-700"
                  >
                    {Number(c.is_active) === 1 ? 'Active (Disable)' : 'Disabled (Enable)'}
                  </button>
                </div>
              ))}
            </div>
            <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">
              Ranked Gemini Note Requests
            </h3>
            <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {geminiRequests.map((gr) => (
                <div key={gr.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <strong>{gr.topic}</strong> ({gr.subject}) · {gr.votesCount} votes
                  </span>
                  {gr.status === 'fulfilled' ? (
                    <span className="text-xs font-bold text-emerald-600">Fulfilled ✓</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        apiRequest(`/api/admin/gemini-requests/${gr.id}/fulfill`, { method: 'POST' }).then(() =>
                          loadTabData('codes'),
                        )
                      }
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                    >
                      Mark Fulfilled
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: 24H REFUNDS */}
      {tab === 'refunds' && (
        <div className="space-y-3">
          {refunds.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              No Coin refund requests.
            </div>
          ) : (
            refunds.map((r) => (
              <div
                key={String(r.id)}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {String(r.note_title)} · 🪙{Number(r.price_coins)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Buyer: {String(r.buyer_name)} · Reason: {String(r.reason)} · Status: {String(r.status)}
                  </p>
                </div>
                {String(r.status) === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleProcessRefund(String(r.id), true)}
                      className="min-h-[36px] rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white"
                    >
                      Return Coins
                    </button>
                    <button
                      type="button"
                      onClick={() => handleProcessRefund(String(r.id), false)}
                      className="min-h-[36px] rounded-xl bg-rose-600 px-3.5 text-xs font-semibold text-white"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 5: REPORTS & SAFETY (Reported Chats ONLY + Note Reports + Suspicious Transfers) */}
      {tab === 'reports' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Reported Chat Messages Only (Private chats remain private unless reported)
            </h2>
            <div className="mt-3 space-y-3">
              {reportsData.chatReports.length === 0 ? (
                <p className="text-sm text-slate-500">No reported chat messages.</p>
              ) : (
                reportsData.chatReports.map((cr) => (
                  <div
                    key={String(cr.id)}
                    className="rounded-xl border border-slate-200 p-3.5 text-xs space-y-2 dark:border-slate-800"
                  >
                    <div className="flex justify-between">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {String(cr.reported_user_name)} (reported by {String(cr.reporter_name)})
                      </span>
                      <span className="uppercase font-bold text-amber-600">{String(cr.status)}</span>
                    </div>
                    <p className="rounded-lg bg-slate-50 p-2 text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      "{String(cr.message_body)}"
                    </p>
                    {String(cr.status) === 'open' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleResolveChatReport(String(cr.id), 'delete_msg')}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 font-semibold text-white"
                        >
                          Delete Msg
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveChatReport(String(cr.id), 'mute_user')}
                          className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white"
                        >
                          Mute User
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveChatReport(String(cr.id), 'ban_user')}
                          className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white"
                        >
                          Ban User
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResolveChatReport(String(cr.id), 'dismiss')}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold dark:border-slate-700"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Reported Notes & Suspicious Coin Transfers
            </h2>
            <div className="mt-3 space-y-2">
              {reportsData.noteReports.map((nr) => (
                <div key={String(nr.id)} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-xs dark:border-slate-800">
                  <span>
                    <strong>{String(nr.note_title)}</strong> · {String(nr.reason)} ({String(nr.status)})
                  </span>
                  {String(nr.status) === 'open' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleResolveNoteReport(String(nr.id), 'remove_note')}
                        className="rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white"
                      >
                        Remove Note
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveNoteReport(String(nr.id), 'dismiss')}
                        className="rounded-lg border border-slate-200 px-3 py-1 font-semibold"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {reportsData.suspiciousTransfers.map((st) => (
                <div key={String(st.id)} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  ⚠️ Suspicious transfer: {String(st.sender_name)} → {String(st.receiver_name)} (🪙{Number(st.amount_coins)}) · {String(st.flag_reason)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: USERS & AUDIT LOG */}
      {tab === 'users' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Users Moderation
            </h2>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {usersData.users.map((u) => {
                const uid = String(u.id);
                const isBanned = Number(u.is_banned) === 1;
                const isMuted = Number(u.is_chat_muted) === 1;
                return (
                  <div key={uid} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white">{String(u.name)}</span>
                      <span className="ml-2 text-slate-500">
                        {String(u.email)} · 🪙{Number(u.coins_balance)} · {String(u.role)}
                      </span>
                    </div>
                    {String(u.role) !== 'admin' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleUserStatus(uid, isMuted ? 'unmute' : 'mute')}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold dark:border-slate-700"
                        >
                          {isMuted ? 'Unmute Chat' : 'Mute Chat'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUserStatus(uid, isBanned ? 'unban' : 'ban')}
                          className={`rounded-lg px-2.5 py-1 font-semibold text-white ${
                            isBanned ? 'bg-emerald-600' : 'bg-rose-600'
                          }`}
                        >
                          {isBanned ? 'Unban' : 'Ban'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Coin Audit Log
            </h2>
            <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {usersData.auditLogs.map((a) => (
                <div key={String(a.id)} className="flex justify-between py-2">
                  <span>
                    <strong className="font-mono-num">{String(a.action)}</strong> · actor {String(a.actor_id)} · target {String(a.target_id)}
                  </span>
                  <span className="font-mono-num text-slate-500">
                    🪙{Number(a.amount_coins)} · {new Date(String(a.created_at)).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
