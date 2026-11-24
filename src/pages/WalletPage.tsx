import { useEffect, useState } from 'react';
import {
  Flame,
  Gift,
  Ticket,
  Sparkles,
  Copy,
  Check,
  ShoppingBag,
  Info,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import type {
  AchievementItem,
  CoinTransaction,
  Language,
  ShopItem,
  UserProfile,
} from '../types';
import { AVATAR_MAP, getAccentClasses, t } from '../i18n';

interface WalletPageProps {
  user: UserProfile | null;
  lang: Language;
  onOpenAuth: () => void;
  onCoinsChange: (
    newBalance: number,
    delta: number,
    label: string,
    achievements?: AchievementItem[],
  ) => void;
  onConfetti: () => void;
  onUserRefresh: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

const SPIN_VALUES = [0, 1, 2, 3, 4, 5];
const SPIN_COLORS = ['#64748b', '#4f46e5', '#059669', '#d97706', '#e11d48', '#7c3aed'];

export function WalletPage({
  user,
  lang,
  onOpenAuth,
  onCoinsChange,
  onConfetti,
  onUserRefresh,
  onToast,
}: WalletPageProps) {
  const [category, setCategory] = useState<'all' | 'earned' | 'spent' | 'redeemed'>('all');
  const [walletData, setWalletData] = useState<{
    coinsBalance: number;
    coinsEarnedTotal: number;
    streakDays: number;
    canClaimStreak: boolean;
    nextStreakReward: number;
    canSpinWheel: boolean;
    nextSpinAt: string | null;
    referralCode: string;
    referredCount: number;
    transactions: CoinTransaction[];
  } | null>(null);
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [redeemInput, setRedeemInput] = useState('');
  const [copiedRef, setCopiedRef] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const accent = getAccentClasses(user?.equippedTheme || 'indigo');

  async function loadWallet(activeCat = category) {
    if (!user) return;
    try {
      const [wRes, sRes] = await Promise.all([
        apiRequest<{
          coinsBalance: number;
          coinsEarnedTotal: number;
          streakDays: number;
          canClaimStreak: boolean;
          nextStreakReward: number;
          canSpinWheel: boolean;
          nextSpinAt: string | null;
          referralCode: string;
          referredCount: number;
          transactions: CoinTransaction[];
        }>(`/api/wallet?category=${activeCat}`),
        apiRequest<{ items: ShopItem[] }>('/api/wallet/shop'),
      ]);
      setWalletData(wRes);
      setShopItems(sRes.items);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  }

  useEffect(() => {
    loadWallet(category);
  }, [user?.id, category]);

  if (!user) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-3xl">🪙</p>
          <h1 className="mt-3 font-display text-2xl font-bold text-slate-900 dark:text-white">
            Sign in to view your Coin Wallet
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Get 🪙10 Welcome Coins on your first Google sign-in, claim daily streaks, spin the wheel, and unlock notes.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="mt-5 min-h-[44px] rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            {t(lang, 'signIn')}
          </button>
        </div>
      </div>
    );
  }

  async function handleClaimStreak() {
    setBusyAction('streak');
    try {
      const res = await apiRequest<{
        coinsAwarded: number;
        newStreak: number;
        isSevenDayBonus: boolean;
        coinsBalance: number;
        newlyUnlocked?: AchievementItem[];
      }>('/api/wallet/streak', { method: 'POST' });

      onCoinsChange(
        res.coinsBalance,
        res.coinsAwarded,
        res.isSevenDayBonus ? `Day ${res.newStreak} Bonus!` : `Day ${res.newStreak} Streak`,
        res.newlyUnlocked,
      );
      if (res.isSevenDayBonus) onConfetti();
      onToast(
        'success',
        res.isSevenDayBonus
          ? `Day ${res.newStreak} streak! +🪙${res.coinsAwarded} (includes +🪙3 7-day bonus)`
          : `Claimed +🪙${res.coinsAwarded} for Day ${res.newStreak} streak!`,
      );
      await loadWallet();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSpinWheel() {
    if (spinning) return;
    setSpinning(true);
    try {
      const res = await apiRequest<{
        sliceIndex: number;
        coinsAwarded: number;
        coinsBalance: number;
        newlyUnlocked?: AchievementItem[];
      }>('/api/wallet/spin', { method: 'POST' });

      const sliceAngle = 360 / SPIN_VALUES.length;
      const targetOffset = 360 - (res.sliceIndex * sliceAngle + sliceAngle / 2);
      const nextRot = wheelRotation + 360 * 5 + targetOffset - (wheelRotation % 360);
      setWheelRotation(nextRot);

      setTimeout(async () => {
        setSpinning(false);
        if (res.coinsAwarded > 0) {
          onCoinsChange(res.coinsBalance, res.coinsAwarded, 'Spin Wheel', res.newlyUnlocked);
          if (res.coinsAwarded >= 4) onConfetti();
          onToast('success', `Spin Wheel landed on +🪙${res.coinsAwarded}!`);
        } else {
          onToast('info', 'Spin Wheel landed on 🪙0 — try again in 24 hours!');
        }
        await loadWallet();
      }, 2200);
    } catch (err) {
      setSpinning(false);
      onToast('error', (err as Error).message);
    }
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemInput.trim()) return;
    setBusyAction('redeem');
    try {
      const res = await apiRequest<{
        coinsAdded: number;
        note: string;
        coinsBalance: number;
      }>('/api/wallet/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: redeemInput.trim() }),
      });
      setRedeemInput('');
      onConfetti();
      onCoinsChange(res.coinsBalance, res.coinsAdded, 'Code Redeemed');
      onToast('success', `Redeemed +🪙${res.coinsAdded}${res.note ? ` (${res.note})` : ''}!`);
      await loadWallet();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleShopBuy(item: ShopItem) {
    setBusyAction(item.id);
    try {
      const res = await apiRequest<{ coinsBalance: number }>(`/api/wallet/shop/${item.id}/buy`, {
        method: 'POST',
      });
      onCoinsChange(res.coinsBalance, -item.priceCoins, item.name);
      onUserRefresh();
      onToast('success', `Unlocked & equipped ${item.name}!`);
      await loadWallet();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleShopEquip(item: ShopItem) {
    setBusyAction(item.id);
    try {
      await apiRequest(`/api/wallet/shop/${item.id}/equip`, { method: 'POST' });
      onUserRefresh();
      onToast('success', `Equipped ${item.name}`);
      await loadWallet();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function copyReferral() {
    const code = walletData?.referralCode || user?.referralCode || '';
    try {
      await navigator.clipboard.writeText(code);
      setCopiedRef(true);
      onToast('success', `Copied referral code ${code}`);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {
      onToast('info', `Referral code: ${code}`);
    }
  }

  const balance = walletData?.coinsBalance ?? user.coinsBalance;
  const totalEarned = walletData?.coinsEarnedTotal ?? user.coinsEarnedTotal;

  return (
    <div className="space-y-6 pb-8">
      {/* Wallet Hero + Virtual Currency Disclaimer */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Virtual Study Balance
            </p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono-num text-4xl font-extrabold text-slate-900 dark:text-white">
                🪙{balance}
              </span>
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Total earned: <span className="font-mono-num">🪙{totalEarned}</span>
              </span>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 sm:max-w-xs">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <span>{t(lang, 'coinsDisclaimer')}</span>
          </div>
        </div>
      </section>

      {/* Earn Coins Trio: Daily Streak, Spin Wheel, Redeem Code */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Daily Streak */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {t(lang, 'dailyStreak')}
              </h2>
            </div>
            <span className="font-mono-num text-sm font-bold text-amber-600 dark:text-amber-400">
              Day {walletData?.streakDays ?? user.streakDays}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            Claim 🪙1 every day. Hit a 7-day streak for a <strong>+🪙3 bonus</strong> (🪙4 total on Day 7)!
          </p>
          <div className="mt-4 grid grid-cols-7 gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => {
              const current = ((walletData?.streakDays ?? user.streakDays) % 7) || ((walletData?.streakDays ?? 0) > 0 ? 7 : 0);
              const done = day <= current;
              return (
                <div
                  key={day}
                  className={`flex h-9 flex-col items-center justify-center rounded-lg border text-[10px] font-bold ${
                    done
                      ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                      : 'border-slate-200 text-slate-400 dark:border-slate-800'
                  }`}
                >
                  <span>D{day}</span>
                  <span>{day === 7 ? '+3' : '1'}</span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!walletData?.canClaimStreak || busyAction === 'streak'}
            onClick={handleClaimStreak}
            className={`mt-4 w-full min-h-[44px] rounded-xl px-4 text-sm font-semibold transition-colors disabled:opacity-50 ${accent.btn}`}
          >
            {walletData?.canClaimStreak
              ? `${t(lang, 'claimStreak')} (+🪙${walletData.nextStreakReward})`
              : t(lang, 'streakClaimed')}
          </button>
        </div>

        {/* Daily Spin Wheel */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {t(lang, 'spinWheel')}
              </h2>
            </div>
            <span className="text-xs font-medium text-slate-500">Every 24h</span>
          </div>

          <div className="mt-3 flex items-center gap-4">
            <div className="relative h-28 w-28 shrink-0">
              {/* Top pointer */}
              <div
                className="absolute left-1/2 -top-1.5 z-10 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[11px] border-x-transparent border-t-slate-900 dark:border-t-white"
                aria-hidden="true"
              />
              <svg
                viewBox="0 0 100 100"
                className="h-full w-full rounded-full shadow-md"
                style={{
                  transform: `rotate(${wheelRotation}deg)`,
                  transition: spinning ? 'transform 2.1s cubic-bezier(0.18, 0.85, 0.2, 1)' : 'none',
                }}
              >
                {SPIN_VALUES.map((val, idx) => {
                  const angle = 360 / SPIN_VALUES.length;
                  const startDeg = idx * angle - 90;
                  const endDeg = startDeg + angle;
                  const rad = (d: number) => (d * Math.PI) / 180;
                  const x1 = 50 + 48 * Math.cos(rad(startDeg));
                  const y1 = 50 + 48 * Math.sin(rad(startDeg));
                  const x2 = 50 + 48 * Math.cos(rad(endDeg));
                  const y2 = 50 + 48 * Math.sin(rad(endDeg));
                  const midRad = rad(startDeg + angle / 2);
                  const tx = 50 + 30 * Math.cos(midRad);
                  const ty = 50 + 30 * Math.sin(midRad);
                  return (
                    <g key={val}>
                      <path
                        d={`M50,50 L${x1},${y1} A48,48 0 0,1 ${x2},${y2} Z`}
                        fill={SPIN_COLORS[idx]}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                      <text
                        x={tx}
                        y={ty}
                        fill="#ffffff"
                        fontSize="10"
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}
                <circle cx="50" cy="50" r="8" fill="#ffffff" />
              </svg>
            </div>

            <div className="flex-1 space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Server-decided daily spin for 🪙0 to 🪙5 bonus Coins.
              </p>
              <button
                type="button"
                disabled={!walletData?.canSpinWheel || spinning}
                onClick={handleSpinWheel}
                className="w-full min-h-[44px] rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-700"
              >
                {spinning
                  ? 'Spinning...'
                  : walletData?.canSpinWheel
                    ? t(lang, 'spinNow')
                    : 'Cooldown Active'}
              </button>
            </div>
          </div>
        </div>

        {/* Redeem Code + Referral */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-emerald-600" />
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {t(lang, 'redeemCode')}
              </h2>
            </div>
            <form onSubmit={handleRedeem} className="mt-3 flex gap-2">
              <input
                type="text"
                value={redeemInput}
                onChange={(e) => setRedeemInput(e.target.value.toUpperCase())}
                placeholder="DIWALI20 or STUDY10"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono-num text-sm uppercase text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="submit"
                disabled={busyAction === 'redeem' || !redeemInput.trim()}
                className="min-h-[44px] rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {t(lang, 'applyCode')}
              </button>
            </form>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Try sample code <span className="font-mono-num font-semibold">DIWALI20</span> (+🪙20). 5 wrong tries lock for 15 min.
            </p>
          </div>

          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Gift className="h-4 w-4 text-rose-500" />
                <span>Invite Friend (+🪙5 each)</span>
              </div>
              <span className="text-[11px] text-slate-500">
                {walletData?.referredCount ?? 0} joined
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
              <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                {walletData?.referralCode || user.referralCode}
              </span>
              <button
                type="button"
                onClick={copyReferral}
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
              >
                {copiedRef ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedRef ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Coin Shop */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-indigo-600" />
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Coin Shop (Themes, Avatars & Frames)
            </h2>
          </div>
          <span className="text-xs text-slate-500">Customize your profile & chat presence</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shopItems.map((item) => (
            <div
              key={item.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {item.kind}
                  </span>
                  <span className="font-mono-num text-xs font-bold text-amber-600 dark:text-amber-400">
                    🪙{item.priceCoins}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-lg shadow-xs dark:bg-slate-900">
                    {item.kind === 'avatar' ? AVATAR_MAP[item.key] || '🎓' : item.kind === 'theme' ? '🎨' : '🖼️'}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{item.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.description}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                {item.equipped ? (
                  <span className="flex min-h-[40px] w-full items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Equipped
                  </span>
                ) : item.owned ? (
                  <button
                    type="button"
                    disabled={busyAction === item.id}
                    onClick={() => handleShopEquip(item)}
                    className="min-h-[40px] w-full rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    Equip
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyAction === item.id || balance < item.priceCoins}
                    onClick={() => handleShopBuy(item)}
                    className={`min-h-[40px] w-full rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${accent.btn}`}
                  >
                    Unlock · 🪙{item.priceCoins}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Coin History */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
            Coin History
          </h2>
          <div className="flex gap-1.5">
            {(['all', 'earned', 'spent', 'redeemed'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`min-h-[36px] rounded-xl px-3 text-xs font-semibold transition-colors ${
                  category === cat
                    ? 'bg-slate-900 text-white dark:bg-indigo-600'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {t(lang, cat)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {(walletData?.transactions || []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No Coin activity in this category yet.
            </p>
          ) : (
            (walletData?.transactions || []).map((tx) => {
              const positive = tx.amount_coins >= 0;
              return (
                <div key={tx.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        positive
                          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                          : 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400'
                      }`}
                    >
                      {positive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {tx.description}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {tx.category} · {new Date(tx.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`font-mono-num text-sm font-bold whitespace-nowrap ${
                      positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {positive ? `+🪙${tx.amount_coins}` : `-🪙${Math.abs(tx.amount_coins)}`}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
