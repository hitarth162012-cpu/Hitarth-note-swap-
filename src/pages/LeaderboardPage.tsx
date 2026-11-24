import { useEffect, useState } from 'react';
import { Trophy, Star } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { AVATAR_MAP, FRAME_CLASS_MAP } from '../i18n';

interface LeaderboardRow {
  rank: number;
  id: string;
  name: string;
  avatar: string;
  frame: string;
  coinsEarnedTotal: number;
  approvedUploads: number;
  totalSales: number;
  avgRating: number;
  level: string;
}

export function LeaderboardPage({ onToast }: { onToast: (type: 'success' | 'error' | 'info', text: string) => void }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ leaderboard: LeaderboardRow[] }>('/api/community/leaderboard')
      .then((res) => setRows(res.leaderboard))
      .catch((err) => onToast('error', (err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
          <Trophy className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Top Uploaders Leaderboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ranked by total Coins earned from note unlocks, upload rewards, and community help.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading leaderboard...</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono-num text-sm font-extrabold ${
                      r.rank === 1
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        : r.rank === 2
                          ? 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                          : r.rank === 3
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
                            : 'text-slate-500'
                    }`}
                  >
                    #{r.rank}
                  </span>
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg dark:bg-slate-800 ${
                      FRAME_CLASS_MAP[r.frame] || FRAME_CLASS_MAP.none
                    }`}
                  >
                    {AVATAR_MAP[r.avatar] || '🎓'}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-bold text-slate-900 dark:text-white">
                      {r.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {r.level} · {r.approvedUploads} notes · {r.totalSales} unlocks
                      {r.avgRating > 0 && (
                        <span className="inline-flex items-center gap-0.5 ml-1.5 text-amber-600 dark:text-amber-400">
                          · <Star className="h-3 w-3 fill-current" /> {r.avgRating}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <span className="font-mono-num text-base font-extrabold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                  🪙{r.coinsEarnedTotal}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
