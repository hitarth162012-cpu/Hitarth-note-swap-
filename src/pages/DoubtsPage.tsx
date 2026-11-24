import { useEffect, useState } from 'react';
import { HelpCircle, Sparkles, ThumbsUp, Award, Send, UploadCloud, Brain } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { DoubtItem, UserProfile } from '../types';
import { AVATAR_MAP, getAccentClasses } from '../i18n';

interface DoubtsPageProps {
  user: UserProfile | null;
  onOpenAuth: () => void;
  onCoinsChange: (newBalance: number, delta: number, label: string) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
  onAskGeminiHelp?: (errorText: string, contextPage: string) => void;
}

interface GeminiRequestItem {
  id: string;
  topic: string;
  subject: string;
  examClass: string;
  votesCount: number;
  status: string;
  requesterName: string;
  hasVoted: boolean;
  createdAt: string;
}

export function DoubtsPage({
  user,
  onOpenAuth,
  onCoinsChange,
  onToast,
  onAskGeminiHelp,
}: DoubtsPageProps) {
  const [section, setSection] = useState<'gemini' | 'doubts' | 'requests'>('gemini');
  const [doubts, setDoubts] = useState<DoubtItem[]>([]);
  const [requests, setRequests] = useState<GeminiRequestItem[]>([]);

  // Gemini Direct Doubt Solver state
  const [aiSubject, setAiSubject] = useState('Physics');
  const [aiExam, setAiExam] = useState('JEE Main & Adv');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Per-thread Gemini explanations in Doubt Forum
  const [threadAiAnswers, setThreadAiAnswers] = useState<Record<string, string>>({});
  const [solvingThreadId, setSolvingThreadId] = useState<string | null>(null);

  // New doubt form
  const [dTitle, setDTitle] = useState('');
  const [dSubject, setDSubject] = useState('Physics');
  const [dExam, setDExam] = useState('JEE Main');
  const [dBody, setDBody] = useState('');

  // Answer drafts & reward amount per doubt
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [rewardAmount, setRewardAmount] = useState<Record<string, number>>({});

  // New Gemini topic request form
  const [reqTopic, setReqTopic] = useState('');
  const [reqSubject, setReqSubject] = useState('Biology');
  const [reqExam, setReqExam] = useState('NEET UG');
  const [busy, setBusy] = useState(false);

  const accent = getAccentClasses(user?.equippedTheme || 'indigo');

  async function loadAll() {
    try {
      const [dRes, gRes] = await Promise.all([
        apiRequest<{ doubts: DoubtItem[] }>('/api/community/doubts'),
        apiRequest<{ requests: GeminiRequestItem[] }>('/api/community/gemini-requests'),
      ]);
      setDoubts(dRes.doubts);
      setRequests(gRes.requests);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  useEffect(() => {
    loadAll();
  }, [user?.id]);

  async function handleAskGeminiTutor(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return onOpenAuth();
    if (aiQuestion.trim().length < 4 && !aiFile) {
      onToast('error', 'Type your study doubt or attach an image/PDF question.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const fd = new FormData();
      fd.append('subject', aiSubject);
      fd.append('examClass', aiExam);
      fd.append('question', aiQuestion);
      if (aiFile) fd.append('file', aiFile);

      const res = await apiRequest<{ answer: string; hasAttachment: boolean }>('/api/ai/doubt', {
        method: 'POST',
        body: fd,
      });
      setAiAnswer(res.answer);
    } catch (err) {
      const msg = (err as Error).message;
      setAiError(msg);
      onToast('error', msg);
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSolveThreadWithGemini(doubtId: string) {
    if (!user) return onOpenAuth();
    setSolvingThreadId(doubtId);
    try {
      const res = await apiRequest<{ answer: string }>(`/api/ai/doubts/${doubtId}/solve`, {
        method: 'POST',
      });
      setThreadAiAnswers((prev) => ({ ...prev, [doubtId]: res.answer }));
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSolvingThreadId(null);
    }
  }

  async function handlePostDoubt(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setBusy(true);
    try {
      await apiRequest('/api/community/doubts', {
        method: 'POST',
        body: JSON.stringify({ title: dTitle, subject: dSubject, examClass: dExam, body: dBody }),
      });
      setDTitle('');
      setDBody('');
      onToast('success', 'Doubt posted to the community!');
      await loadAll();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePostAnswer(doubtId: string) {
    if (!user) return onOpenAuth();
    const body = (answerDrafts[doubtId] || '').trim();
    if (!body) return;
    setBusy(true);
    try {
      await apiRequest(`/api/community/doubts/${doubtId}/answers`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setAnswerDrafts((p) => ({ ...p, [doubtId]: '' }));
      onToast('success', 'Answer posted!');
      await loadAll();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRewardBest(doubtId: string, answerId: string) {
    if (!user) return onOpenAuth();
    const coins = rewardAmount[doubtId] || 2;
    setBusy(true);
    try {
      const res = await apiRequest<{ coinsBalance: number }>(`/api/community/doubts/${doubtId}/best-answer`, {
        method: 'POST',
        body: JSON.stringify({ answerId, rewardCoins: coins }),
      });
      onCoinsChange(res.coinsBalance, -coins, 'Doubt Reward');
      onToast('success', `Marked Best Answer & rewarded 🪙${coins}!`);
      await loadAll();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return onOpenAuth();
    setBusy(true);
    try {
      await apiRequest('/api/community/gemini-requests', {
        method: 'POST',
        body: JSON.stringify({ topic: reqTopic, subject: reqSubject, examClass: reqExam }),
      });
      setReqTopic('');
      onToast('success', 'Topic added to Gemini Note Requests!');
      await loadAll();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVote(reqId: string) {
    if (!user) return onOpenAuth();
    try {
      await apiRequest(`/api/community/gemini-requests/${reqId}/vote`, { method: 'POST' });
      await loadAll();
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Gemini Tutor &amp; Study Doubts
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ask Gemini any study doubt (text, image, or PDF) or collaborate with peers in the Doubt Forum.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setSection('gemini')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-colors ${
              section === 'gemini'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Brain className="h-4 w-4 text-indigo-500" />
            Ask Gemini Tutor
          </button>
          <button
            type="button"
            onClick={() => setSection('doubts')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-colors ${
              section === 'doubts'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <HelpCircle className="h-4 w-4" />
            Doubt Forum
          </button>
          <button
            type="button"
            onClick={() => setSection('requests')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold transition-colors ${
              section === 'requests'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Sparkles className="h-4 w-4 text-amber-500" />
            Topic Requests
          </button>
        </div>
      </div>

      {section === 'gemini' ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleAskGeminiTutor}
            className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Ask Your Doubt to Gemini
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Type a question or upload a photo/PDF of your problem for a step-by-step explanation.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={aiSubject}
                onChange={(e) => setAiSubject(e.target.value)}
                className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Computer Science', 'General Studies'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <input
                type="text"
                value={aiExam}
                onChange={(e) => setAiExam(e.target.value)}
                placeholder="Exam / Class"
                className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="gemini-doubt-text" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Your Doubt / Question
              </label>
              <textarea
                id="gemini-doubt-text"
                rows={4}
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                placeholder="e.g. Derive the electric field on the axial line of an electric dipole, or solve the attached question..."
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="gemini-doubt-file" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Optional Image or PDF Question (up to 10 MB)
              </label>
              <input
                id="gemini-doubt-file"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setAiFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-indigo-50 file:px-3.5 file:py-2 file:text-xs file:font-semibold file:text-indigo-700 dark:text-slate-300 dark:file:bg-indigo-950 dark:file:text-indigo-300"
              />
              {aiFile && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-950">
                  <span className="truncate font-medium">
                    {aiFile.type === 'application/pdf' ? 'PDF' : 'Image'}: {aiFile.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAiFile(null)}
                    className="ml-2 text-rose-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={aiLoading}
              className={`w-full min-h-[44px] rounded-xl text-sm font-semibold disabled:opacity-50 ${accent.btn}`}
            >
              {!user ? 'Sign in to Ask Gemini' : aiLoading ? 'Solving with Gemini...' : 'Solve with Gemini'}
            </button>
          </form>

          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Gemini Step-by-Step Solution
              </h3>

              {aiLoading ? (
                <div className="py-12 text-center">
                  <Brain className="mx-auto h-8 w-8 animate-pulse text-indigo-600" />
                  <p className="mt-2 text-sm text-slate-500">Gemini is analyzing your study doubt...</p>
                </div>
              ) : aiError ? (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                  <p className="font-semibold">Gemini Tutor Error</p>
                  <p className="mt-1 text-xs">{aiError}</p>
                  {onAskGeminiHelp && (
                    <button
                      type="button"
                      onClick={() => onAskGeminiHelp(aiError, 'Ask Gemini Tutor')}
                      className="mt-3 inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-rose-700 px-3.5 text-xs font-semibold text-white hover:bg-rose-800"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Ask Gemini Error Helper
                    </button>
                  )}
                </div>
              ) : aiAnswer ? (
                <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-line dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-slate-200">
                  {aiAnswer}
                </div>
              ) : (
                <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-14 text-center dark:border-slate-800">
                  <UploadCloud className="h-8 w-8 text-slate-400" />
                  <p className="mt-2 max-w-sm text-xs text-slate-500 dark:text-slate-400">
                    Submit any Physics, Chemistry, Biology, Math, or CS question — including photos or PDFs — to get instant step-by-step explanations.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : section === 'doubts' ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <form
            onSubmit={handlePostDoubt}
            className="h-fit rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Ask a Study Doubt
            </h2>
            <input
              type="text"
              required
              value={dTitle}
              onChange={(e) => setDTitle(e.target.value)}
              placeholder="Short question title..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={dSubject}
                onChange={(e) => setDSubject(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Computer Science'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <input
                type="text"
                value={dExam}
                onChange={(e) => setDExam(e.target.value)}
                placeholder="Class / Exam"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <textarea
              required
              rows={3}
              value={dBody}
              onChange={(e) => setDBody(e.target.value)}
              placeholder="Explain where you are stuck..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={busy}
              className={`w-full min-h-[44px] rounded-xl text-sm font-semibold ${accent.btn}`}
            >
              {user ? 'Post Doubt' : 'Sign in to Ask'}
            </button>
          </form>

          <div className="space-y-4 lg:col-span-2">
            {doubts.map((doubt) => {
              const isAsker = user?.id === doubt.userId;
              const aiThreadReply = threadAiAnswers[doubt.id];
              return (
                <article
                  key={doubt.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {AVATAR_MAP[doubt.authorAvatar] || '🎓'} {doubt.authorName} · {doubt.subject} · {doubt.examClass}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={solvingThreadId === doubt.id}
                        onClick={() => handleSolveThreadWithGemini(doubt.id)}
                        className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300"
                      >
                        <Sparkles className="h-3 w-3" />
                        {solvingThreadId === doubt.id ? 'Solving...' : 'Ask Gemini AI'}
                      </button>
                      <span
                        className={`font-semibold ${
                          doubt.status === 'resolved'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {doubt.status === 'resolved' ? 'Resolved' : 'Open for Answers'}
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-1.5 font-display text-lg font-bold text-slate-900 dark:text-white">
                    {doubt.title}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{doubt.body}</p>

                  {aiThreadReply && (
                    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3.5 text-sm leading-relaxed text-slate-800 whitespace-pre-line dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-slate-200">
                      <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                        <Sparkles className="h-3.5 w-3.5" /> Gemini Tutor Explanation
                      </p>
                      {aiThreadReply}
                    </div>
                  )}

                  {isAsker && doubt.status === 'open' && doubt.answers.length > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <span>Reward amount for Best Answer:</span>
                      <select
                        value={rewardAmount[doubt.id] || 2}
                        onChange={(e) =>
                          setRewardAmount((p) => ({ ...p, [doubt.id]: Number(e.target.value) }))
                        }
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono-num font-bold dark:border-slate-700 dark:bg-slate-950"
                      >
                        {[1, 2, 3, 4, 5].map((c) => (
                          <option key={c} value={c}>
                            🪙{c}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mt-4 space-y-2.5">
                    {doubt.answers.map((ans) => (
                      <div
                        key={ans.id}
                        className={`rounded-xl border p-3.5 ${
                          ans.isBest
                            ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30'
                            : 'border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {AVATAR_MAP[ans.authorAvatar] || '🎓'} {ans.authorName}
                          </span>
                          {ans.isBest ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                              <Award className="h-3.5 w-3.5" /> Best Answer · +🪙{ans.rewardCoins}
                            </span>
                          ) : isAsker && doubt.status === 'open' && ans.userId !== user?.id ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRewardBest(doubt.id, ans.id)}
                              className="min-h-[34px] rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white hover:bg-emerald-700"
                            >
                              Mark Best (+🪙{rewardAmount[doubt.id] || 2})
                            </button>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{ans.body}</p>
                      </div>
                    ))}
                  </div>

                  {doubt.status === 'open' && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={answerDrafts[doubt.id] || ''}
                        onChange={(e) => setAnswerDrafts((p) => ({ ...p, [doubt.id]: e.target.value }))}
                        placeholder="Write a helpful answer to earn Coins..."
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handlePostAnswer(doubt.id)}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
                      >
                        <Send className="h-3.5 w-3.5" /> Reply
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <form
            onSubmit={handleCreateRequest}
            className="h-fit rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Request a Study Topic
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Top-voted topics signal to fellow students which high-demand study notes to upload next.
            </p>
            <input
              type="text"
              required
              value={reqTopic}
              onChange={(e) => setReqTopic(e.target.value)}
              placeholder="e.g., Rotational Motion + Moment of Inertia"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={reqSubject}
                onChange={(e) => setReqSubject(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Computer Science'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <input
                type="text"
                value={reqExam}
                onChange={(e) => setReqExam(e.target.value)}
                placeholder="Class / Exam"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className={`w-full min-h-[44px] rounded-xl text-sm font-semibold ${accent.btn}`}
            >
              Submit Topic Request
            </button>
          </form>

          <div className="space-y-3 lg:col-span-2">
            {requests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                      {req.subject}
                    </span>
                    <span>·</span>
                    <span>{req.examClass}</span>
                    <span>·</span>
                    <span>by {req.requesterName}</span>
                  </div>
                  <p className="mt-1 font-display text-base font-bold text-slate-900 dark:text-white">
                    {req.topic}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {req.status === 'fulfilled' ? (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      Published ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleVote(req.id)}
                      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3.5 text-xs font-bold transition-colors ${
                        req.hasVoted
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                      }`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span className="font-mono-num">{req.votesCount}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
