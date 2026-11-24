import { useEffect, useState } from 'react';
import {
  Moon,
  Sun,
  Globe,
  Bell,
  CalendarClock,
  Shield,
  BookOpen,
  HelpCircle,
  Trophy,
  LogOut,
  Award,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { Language, NavTab, UserProfile } from '../types';
import { AVATAR_MAP, FRAME_CLASS_MAP, getAccentClasses, t } from '../i18n';

interface ProfilePageProps {
  user: UserProfile | null;
  lang: Language;
  darkMode: boolean;
  onToggleDark: () => void;
  onToggleLang: () => void;
  onNavigate: (tab: NavTab) => void;
  onOpenAuth: () => void;
  onUserRefresh: () => void;
  onSignedOut: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  is_read: number;
  created_at: string;
}

export function ProfilePage({
  user,
  lang,
  darkMode,
  onToggleDark,
  onToggleLang,
  onNavigate,
  onOpenAuth,
  onUserRefresh,
  onSignedOut,
  onToast,
}: ProfilePageProps) {
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [isMinor, setIsMinor] = useState(user?.isMinor || false);
  const [examName, setExamName] = useState(user?.examCountdown?.exam_name || 'JEE Main 2027');
  const [examDate, setExamDate] = useState(
    user?.examCountdown?.exam_date ||
      new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
  const [reminderDays, setReminderDays] = useState(user?.examCountdown?.reminder_days || 14);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [saving, setSaving] = useState(false);

  const accent = getAccentClasses(user?.equippedTheme || 'indigo');

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.name);
    setIsMinor(user.isMinor);
    if (user.examCountdown) {
      setExamName(user.examCountdown.exam_name);
      setExamDate(user.examCountdown.exam_date);
      setReminderDays(user.examCountdown.reminder_days);
    }
    apiRequest<{ notifications: NotificationItem[] }>('/api/community/notifications')
      .then((res) => setNotifications(res.notifications))
      .catch(() => {});
  }, [user?.id, user?.name]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ name: displayName, isMinor }),
      });
      onUserRefresh();
      onToast('success', 'Profile preferences saved');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveExam(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest('/api/community/exam-countdown', {
        method: 'PUT',
        body: JSON.stringify({ examName, examDate, reminderDays }),
      });
      onUserRefresh();
      onToast('success', 'Exam countdown updated!');
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkAllRead() {
    try {
      await apiRequest('/api/community/notifications/read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
      onUserRefresh();
    } catch {
      // ignore
    }
  }

  async function handleSignOut() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    onSignedOut();
    onToast('info', 'Signed out');
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-xl space-y-5 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-3xl">🎓</p>
          <h1 className="mt-3 font-display text-2xl font-bold text-slate-900 dark:text-white">
            Your NoteSwap Profile
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Sign in to track your creator level, achievements, exam countdown, and notifications.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-5 min-h-[44px] rounded-xl bg-indigo-600 px-6 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            {t(lang, 'signIn')}
          </button>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Appearance & Language
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onToggleDark}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold dark:border-slate-700 dark:text-slate-200"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {darkMode ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold dark:border-slate-700 dark:text-slate-200"
            >
              <Globe className="h-4 w-4" />
              {lang === 'en' ? 'EN | हिं' : 'हिं | EN'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-3xl dark:bg-slate-800 ${
                FRAME_CLASS_MAP[user.equippedFrame] || FRAME_CLASS_MAP.none
              }`}
            >
              {AVATAR_MAP[user.equippedAvatar] || '🎓'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  {user.name}
                </h1>
                {user.role === 'admin' && (
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Admin
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {user.level} · {user.approvedUploads} approved notes · 🪙{user.coinsBalance} balance
              </p>
              {user.nextLevelTarget && (
                <p className="mt-1 text-[11px] text-slate-500">
                  {user.nextLevelTarget - user.approvedUploads} more approved upload(s) to reach next creator tier
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onToggleDark}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {darkMode ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Globe className="h-4 w-4" />
              {lang === 'en' ? 'EN | हिं' : 'हिं | EN'}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <LogOut className="h-4 w-4" />
              {t(lang, 'signOut')}
            </button>
          </div>
        </div>

        {/* Quick Destination Links */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => onNavigate('library')}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          >
            <BookOpen className="h-4 w-4 text-indigo-500" />
            {t(lang, 'library')}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('doubts')}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          >
            <HelpCircle className="h-4 w-4 text-emerald-500" />
            {t(lang, 'doubts')}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('leaderboard')}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          >
            <Trophy className="h-4 w-4 text-amber-500" />
            {t(lang, 'leaderboard')}
          </button>
          {user.role === 'admin' && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
            >
              <Shield className="h-4 w-4" />
              {t(lang, 'admin')} Console
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Account & Safety Settings */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Profile & Chat Safety
          </h2>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <label className="flex min-h-[42px] items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isMinor}
              onChange={(e) => setIsMinor(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600"
            />
            <span>Under-18 Safety Mode (block stranger DMs until I accept a chat request)</span>
          </label>
          <button
            type="submit"
            disabled={saving}
            className={`min-h-[42px] rounded-xl px-5 text-xs font-semibold ${accent.btn}`}
          >
            Save Preferences
          </button>
        </form>

        {/* Exam Countdown Settings */}
        <form
          onSubmit={handleSaveExam}
          className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-indigo-500" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Exam Countdown & Reminders
              </h2>
            </div>
            {user.examCountdown && (
              <span className="font-mono-num text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {user.examCountdown.daysLeft}d left
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Target Exam
              </label>
              <input
                type="text"
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                placeholder="JEE Main / NEET / Class 12"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Exam Date
              </label>
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
              Remind me (days before): <strong className="font-mono-num">{reminderDays}</strong>
            </label>
            <input
              type="range"
              min={1}
              max={60}
              value={reminderDays}
              onChange={(e) => setReminderDays(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[42px] rounded-xl bg-slate-900 px-5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
          >
            Save Countdown
          </button>
        </form>
      </div>

      {/* Achievements */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-500" />
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Achievements ({user.achievements.length})
          </h2>
        </div>
        {user.achievements.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Unlock your first note, score 4/5+ on a Gemini quiz, or upload a note to earn badges!
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {user.achievements.map((ach, idx) => (
              <div
                key={ach.achievement_key || ach.key || idx}
                className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30"
              >
                <span className="text-2xl">{ach.icon}</span>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{ach.title}</p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">{ach.description}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Notifications */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-indigo-500" />
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Notifications
            </h2>
          </div>
          {notifications.some((n) => !n.is_read) && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {notifications.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {!n.is_read && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-indigo-600" />}
                    {n.title}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{n.message}</p>
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                  {new Date(n.created_at).toLocaleDateString()}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
