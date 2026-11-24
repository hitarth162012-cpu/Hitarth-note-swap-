import { useCallback, useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { BottomNav } from './components/BottomNav';
import {
  AchievementUnlockBanner,
  CoinDeltaFloating,
  ConfettiBurst,
} from './components/CoinEffects';
import { Header } from './components/Header';
import { GeminiErrorHelperModal } from './components/GeminiErrorHelperModal';
import { ToastStack, type ToastMessage } from './components/Toast';
import { t } from './i18n';
import { apiRequest } from './lib/api';
import { testFirestoreConnection } from './lib/firebase';
import { AdminPage } from './pages/AdminPage';
import { ChatPage } from './pages/ChatPage';
import { DoubtsPage } from './pages/DoubtsPage';
import { HomePage } from './pages/HomePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LibraryPage } from './pages/LibraryPage';
import { NoteDetailPage } from './pages/NoteDetailPage';
import { ProfilePage } from './pages/ProfilePage';
import { SearchPage } from './pages/SearchPage';
import { UploadPage } from './pages/UploadPage';
import { WalletPage } from './pages/WalletPage';
import type {
  AchievementItem,
  Language,
  NavTab,
  NoteSummary,
  UserProfile,
} from './types';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [adminSetupRequired, setAdminSetupRequired] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingShareNote, setPendingShareNote] = useState<NoteSummary | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ns_dark') === '1';
    } catch {
      return false;
    }
  });
  const [lang, setLang] = useState<Language>(() => {
    try {
      return localStorage.getItem('ns_lang') === 'hi' ? 'hi' : 'en';
    } catch {
      return 'en';
    }
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [coinDelta, setCoinDelta] = useState<{ id: number; amount: number; label?: string } | null>(null);
  const [confettiActive, setConfettiActive] = useState(false);
  const [unlockedAchievement, setUnlockedAchievement] = useState<AchievementItem | null>(null);
  const [geminiHelp, setGeminiHelp] = useState<{
    open: boolean;
    errorMessage: string;
    contextPage: string;
  }>({ open: false, errorMessage: '', contextPage: 'app' });

  const openGeminiHelp = useCallback(
    (errorMessage: string, contextPage = 'NoteSwap') => {
      setGeminiHelp({ open: true, errorMessage, contextPage });
    },
    [],
  );

  const addToast = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 5500);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const res = await apiRequest<{
        user: UserProfile | null;
        googleConfigured: boolean;
        adminSetupRequired: boolean;
      }>('/api/auth/me');
      setUser(res.user);
      setGoogleConfigured(res.googleConfigured);
      setAdminSetupRequired(res.adminSetupRequired);
      if (res.user?.pendingDmRequests) {
        setUnreadChatCount((prev) => Math.max(prev, res.user!.pendingDmRequests));
      }
    } catch {
      // ignore initial boot failure
    }
  }, []);

  useEffect(() => {
    refreshMe();
    testFirestoreConnection();
  }, [refreshMe]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('ns_dark', darkMode ? '1' : '0');
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('ns_lang', lang);
    } catch {
      // ignore
    }
  }, [lang]);

  // Background notification WebSocket when user is signed in via Google or Firebase Email and not on Chat tab
  useEffect(() => {
    if (!user || !['google', 'firebase_email'].includes(user.authProvider) || activeTab === 'chat') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'chat:unread') {
          setUnreadChatCount((c) => c + 1);
          addToast('info', `New message from ${data.fromName}`);
        } else if (data.type === 'dm:request') {
          setUnreadChatCount((c) => c + 1);
          addToast('info', `${data.fromName} sent a chat request`);
        } else if (data.type === 'note:gifted') {
          addToast('success', `${data.fromName} gifted you "${data.noteTitle}"!`);
          refreshMe();
        } else if (data.type === 'coin:received') {
          addToast('success', `${data.fromName} sent you 🪙${data.amountCoins}!`);
          refreshMe();
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [user?.id, user?.authProvider, activeTab, addToast, refreshMe]);

  function handleCoinsChange(
    newBalance: number,
    delta: number,
    label: string,
    achievements?: AchievementItem[],
  ) {
    setUser((prev) => (prev ? { ...prev, coinsBalance: newBalance } : prev));
    if (delta !== 0) {
      setCoinDelta({ id: Date.now(), amount: delta, label });
      window.setTimeout(() => setCoinDelta(null), 2400);
    }
    if (achievements && achievements.length > 0) {
      setUnlockedAchievement(achievements[0]);
      window.setTimeout(() => setUnlockedAchievement(null), 5000);
    }
    refreshMe();
  }

  function handleNavigate(tab: NavTab) {
    setActiveTab(tab);
    if (tab !== 'note') setSelectedNoteId(null);
    if (tab === 'chat') setUnreadChatCount(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleOpenNote(noteId: string) {
    setSelectedNoteId(noteId);
    setActiveTab('note');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleShareInChat(noteId: string) {
    try {
      const res = await apiRequest<{ note: NoteSummary }>(`/api/notes/${noteId}`);
      setPendingShareNote(res.note);
      handleNavigate('chat');
    } catch (err) {
      addToast('error', (err as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <Header
        user={user}
        activeTab={activeTab}
        lang={lang}
        unreadChatCount={unreadChatCount}
        onNavigate={handleNavigate}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      <main className="mx-auto max-w-7xl px-4 pt-5 pb-24 md:px-6 md:pb-12">
        {activeTab === 'home' && (
          <HomePage
            user={user}
            lang={lang}
            onOpenNote={handleOpenNote}
            onNavigate={handleNavigate}
            onSearchSubmit={(q) => {
              setSearchQuery(q);
              handleNavigate('search');
            }}
            onOpenAuth={() => setAuthModalOpen(true)}
            onCoinsChange={handleCoinsChange}
            onToast={addToast}
          />
        )}

        {activeTab === 'search' && (
          <SearchPage
            initialQuery={searchQuery}
            user={user}
            lang={lang}
            onOpenNote={handleOpenNote}
            onOpenAuth={() => setAuthModalOpen(true)}
            onToast={addToast}
          />
        )}

        {activeTab === 'note' && selectedNoteId && (
          <NoteDetailPage
            noteId={selectedNoteId}
            user={user}
            lang={lang}
            onBack={() => handleNavigate('home')}
            onOpenAuth={() => setAuthModalOpen(true)}
            onShareInChat={handleShareInChat}
            onCoinsChange={handleCoinsChange}
            onToast={addToast}
            onAskGeminiHelp={openGeminiHelp}
          />
        )}

        {activeTab === 'upload' && (
          <UploadPage
            user={user}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenNote={handleOpenNote}
            onToast={addToast}
          />
        )}

        {activeTab === 'wallet' && (
          <WalletPage
            user={user}
            lang={lang}
            onOpenAuth={() => setAuthModalOpen(true)}
            onCoinsChange={handleCoinsChange}
            onConfetti={() => setConfettiActive(true)}
            onUserRefresh={refreshMe}
            onToast={addToast}
          />
        )}

        {activeTab === 'library' && (
          <LibraryPage
            user={user}
            lang={lang}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenNote={handleOpenNote}
            onToast={addToast}
          />
        )}

        {activeTab === 'doubts' && (
          <DoubtsPage
            user={user}
            onOpenAuth={() => setAuthModalOpen(true)}
            onCoinsChange={handleCoinsChange}
            onToast={addToast}
            onAskGeminiHelp={openGeminiHelp}
          />
        )}

        {activeTab === 'leaderboard' && <LeaderboardPage onToast={addToast} />}

        {activeTab === 'chat' && (
          <ChatPage
            user={user}
            pendingShareNote={pendingShareNote}
            onClearPendingShare={() => setPendingShareNote(null)}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenNote={handleOpenNote}
            onCoinsChange={handleCoinsChange}
            onUnreadReset={() => setUnreadChatCount(0)}
            onToast={addToast}
          />
        )}

        {activeTab === 'profile' && (
          <ProfilePage
            user={user}
            lang={lang}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode((d) => !d)}
            onToggleLang={() => setLang((l) => (l === 'en' ? 'hi' : 'en'))}
            onNavigate={handleNavigate}
            onOpenAuth={() => setAuthModalOpen(true)}
            onUserRefresh={refreshMe}
            onSignedOut={() => {
              setUser(null);
              handleNavigate('home');
            }}
            onToast={addToast}
          />
        )}

        {activeTab === 'admin' && (
          <AdminPage
            user={user}
            onOpenAuth={() => setAuthModalOpen(true)}
            onToast={addToast}
          />
        )}

        <footer className="mt-10 border-t border-slate-200 pt-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <p>{t(lang, 'coinsDisclaimer')}</p>
          <p className="mt-1">
            NoteSwap Study Exchange · English &amp; हिन्दी · Virtual Coins Only (🪙)
          </p>
        </footer>
      </main>

      <BottomNav
        activeTab={activeTab}
        lang={lang}
        unreadChatCount={unreadChatCount}
        onNavigate={handleNavigate}
      />

      <AuthModal
        open={authModalOpen}
        googleConfigured={googleConfigured}
        adminSetupRequired={adminSetupRequired}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(loggedInUser, welcomeBonus) => {
          setUser(loggedInUser);
          refreshMe();
          if (welcomeBonus) {
            setConfettiActive(true);
            setCoinDelta({ id: Date.now(), amount: welcomeBonus, label: 'Welcome Bonus' });
            window.setTimeout(() => setCoinDelta(null), 2400);
          }
        }}
        onToast={addToast}
        onAskGeminiHelp={openGeminiHelp}
      />

      <GeminiErrorHelperModal
        open={geminiHelp.open}
        errorMessage={geminiHelp.errorMessage}
        contextPage={geminiHelp.contextPage}
        onClose={() => setGeminiHelp((prev) => ({ ...prev, open: false }))}
      />

      <ToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((item) => item.id !== id))}
        onAskGeminiHelp={(errText) => openGeminiHelp(errText, activeTab)}
      />
      <CoinDeltaFloating delta={coinDelta} />
      <ConfettiBurst active={confettiActive} onDone={() => setConfettiActive(false)} />
      <AchievementUnlockBanner
        achievement={unlockedAchievement}
        onClose={() => setUnlockedAchievement(null)}
      />
    </div>
  );
}
