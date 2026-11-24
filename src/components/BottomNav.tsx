import { Home, Search, MessageCircle, UploadCloud, Wallet, User } from 'lucide-react';
import type { Language, NavTab } from '../types';
import { t } from '../i18n';

interface BottomNavProps {
  activeTab: NavTab;
  lang: Language;
  unreadChatCount: number;
  onNavigate: (tab: NavTab) => void;
}

export function BottomNav({ activeTab, lang, unreadChatCount, onNavigate }: BottomNavProps) {
  const tabs: Array<{
    id: NavTab;
    label: string;
    icon: typeof Home;
    badge?: number;
  }> = [
    { id: 'home', label: t(lang, 'home'), icon: Home },
    { id: 'search', label: t(lang, 'search'), icon: Search },
    { id: 'chat', label: t(lang, 'chat'), icon: MessageCircle, badge: unreadChatCount },
    { id: 'upload', label: t(lang, 'upload'), icon: UploadCloud },
    { id: 'wallet', label: t(lang, 'wallet'), icon: Wallet },
    { id: 'profile', label: t(lang, 'profile'), icon: User },
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/90 bg-white/95 backdrop-blur-md pb-safe dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
    >
      <div className="grid h-16 grid-cols-6 items-center">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigate(tab.id)}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 1.8} />
                {tab.badge && tab.badge > 0 ? (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 font-mono-num text-[10px] font-bold text-white">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] font-medium tracking-tight whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
