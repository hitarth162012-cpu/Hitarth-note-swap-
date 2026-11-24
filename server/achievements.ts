import { db } from './db';

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: 'first_unlock',
    title: 'First Note Unlocked',
    description: 'Unlocked your very first study note on NoteSwap.',
    icon: '📖',
  },
  {
    key: 'first_upload',
    title: 'Knowledge Sharer',
    description: 'Had your first uploaded study note approved.',
    icon: '📝',
  },
  {
    key: 'streak_7',
    title: '7-Day Scholar Streak',
    description: 'Claimed daily study Coins for 7 consecutive days.',
    icon: '🔥',
  },
  {
    key: 'quiz_master',
    title: 'Quiz Ace',
    description: 'Scored 4/5 or higher on an AI Note Quiz.',
    icon: '🧠',
  },
  {
    key: 'doubt_helper',
    title: 'Doubt Buster',
    description: 'Earned a best-answer Coin reward in the Doubt Forum.',
    icon: '💡',
  },
  {
    key: 'collector_5',
    title: 'Library Builder',
    description: 'Collected 5 or more notes in your Library.',
    icon: '🏛️',
  },
  {
    key: 'top_earner_50',
    title: '50+ Coins Earned',
    description: 'Earned 50+ lifetime Coins from notes, quizzes, and streaks.',
    icon: '🪙',
  },
];

export function checkAndUnlockAchievements(userId: string): AchievementDef[] {
  const existing = new Set(
    (
      db
        .prepare('SELECT achievement_key FROM user_achievements WHERE user_id = ?')
        .all(userId) as Array<{ achievement_key: string }>
    ).map((r) => r.achievement_key),
  );

  const user = db
    .prepare('SELECT streak_days, coins_earned_total FROM users WHERE id = ?')
    .get(userId) as { streak_days: number; coins_earned_total: number } | undefined;
  if (!user) return [];

  const unlockCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM purchases WHERE buyer_id = ? AND refunded = 0')
      .get(userId) as { c: number }
  ).c;
  const approvedUploads = (
    db
      .prepare("SELECT COUNT(*) as c FROM notes WHERE uploader_id = ? AND status = 'approved'")
      .get(userId) as { c: number }
  ).c;
  const quizWins = (
    db
      .prepare('SELECT COUNT(*) as c FROM quiz_attempts WHERE user_id = ? AND reward_coins > 0')
      .get(userId) as { c: number }
  ).c;
  const bestAnswers = (
    db
      .prepare('SELECT COUNT(*) as c FROM doubt_answers WHERE user_id = ? AND is_best = 1')
      .get(userId) as { c: number }
  ).c;

  const checks: Record<string, boolean> = {
    first_unlock: unlockCount >= 1,
    first_upload: approvedUploads >= 1,
    streak_7: user.streak_days >= 7,
    quiz_master: quizWins >= 1,
    doubt_helper: bestAnswers >= 1,
    collector_5: unlockCount >= 5,
    top_earner_50: user.coins_earned_total >= 50,
  };

  const newlyUnlocked: AchievementDef[] = [];
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO user_achievements (user_id, achievement_key, unlocked_at) VALUES (?, ?, ?)',
  );

  for (const def of ACHIEVEMENTS) {
    if (!existing.has(def.key) && checks[def.key]) {
      insert.run(userId, def.key, now);
      newlyUnlocked.push(def);
    }
  }

  return newlyUnlocked;
}
