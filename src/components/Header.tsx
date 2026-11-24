import type { Language, NavTab, UserProfile } from '../types';
import { AVATAR_MAP, getAccentClasses, t } from '../i18n';

interface HeaderProps {
  user: UserProfile | null;
  activeTab: NavTab;
  lang: Language;
  unreadChatCount: number;
  onNavigate: (tab: NavTab) => void;
  onOpenAuth: () => void;
}

export function Header({
  user,
  activeTab,
  lang,
  unreadChatCount,
  onNavigate,
  onOpenAuth,
}: HeaderProps) {
  const accent = getAccentClasses(user?.equippedTheme || 'indigo');

  const navItems: Array<{ id: NavTab; label: string; badge?: number }> = [
    { id: 'home', label: t(lang, 'home') },
    { id: 'search', label: t(lang, 'search') },
    { id: 'chat', label: t(lang, 'chat'), badge: unreadChatCount },
    { id: 'upload', label: t(lang, 'upload') },
    { id: 'wallet', label: t(lang, 'wallet') },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
      {/* Desktop 3-Zone Top Bar Contract */}
      <div className="mx-auto flex h-[52px] max-w-7xl items-center justify-between gap-8 px-4 md:h-16 md:px-6">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="font-display text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-white"
        >
          {t(lang, 'brand')}
        </button>

        {/* Zone 2: 5 concise single-line nav links (desktop) */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`min-h-[40px] whitespace-nowrap shrink-0 border-b-2 px-1 transition-colors ${
                  isActive
                    ? 'border-indigo-600 font-semibold text-slate-900 dark:border-indigo-400 dark:text-white'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
                {item.badge && item.badge > 0 ? ` (${item.badge})` : ''}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className={`flex min-h-[40px] items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${accent.btn}`}
              aria-label={`Open profile for ${user.name}`}
            >
              <span aria-hidden="true">{AVATAR_MAP[user.equippedAvatar] || '🎓'}</span>
              <span className="font-mono-num">🪙{user.coinsBalance}</span>
              <span className="hidden sm:inline max-w-[110px] truncate">· {user.name.split(' ')[0]}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className={`min-h-[40px] rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${accent.btn}`}
            >
              {t(lang, 'signIn')}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
