import crypto from 'node:crypto';
import type { Response } from 'express';
import express from 'express';
import { checkAndUnlockAchievements } from '../achievements';
import { db } from '../db';
import {
  calculateDailyStreakReward,
  isRedeemLocked,
  isSpinEligible,
  normalizeCode,
  pickSpinWheelSlice,
  REDEEM_LOCK_MINUTES,
  REDEEM_MAX_ATTEMPTS,
} from '../domain';
import { createRateLimiter } from '../security';
import { type AuthedRequest, requireAuth } from './auth';

export function createWalletRouter(): express.Router {
  const router = express.Router();
  const redeemLimiter = createRateLimiter('redeem', 10, 5 * 60 * 1000);
  const actionLimiter = createRateLimiter('wallet_action', 25, 60 * 1000);

  router.get('/', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const category = String(req.query.category || 'all');

    let where = 'user_id = ?';
    const params: unknown[] = [user.id];
    if (['earned', 'spent', 'redeemed'].includes(category)) {
      where += ' AND category = ?';
      params.push(category);
    }

    const transactions = db
      .prepare(
        `SELECT id, category, type, amount_coins, description, ref_id, created_at
         FROM coin_transactions
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT 80`,
      )
      .all(...params);

    const todayStr = new Date().toISOString().slice(0, 10);
    const streakInfo = calculateDailyStreakReward(user.streak_days, user.last_streak_date, todayStr);
    const spinInfo = isSpinEligible(user.last_spin_at);

    const referredCount = (
      db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by = ?').get(user.id) as { c: number }
    ).c;

    res.json({
      coinsBalance: user.coins_balance,
      coinsEarnedTotal: user.coins_earned_total,
      streakDays: user.streak_days,
      canClaimStreak: streakInfo.eligible,
      nextStreakReward: streakInfo.coinsAwarded,
      canSpinWheel: spinInfo.eligible,
      nextSpinAt: spinInfo.nextSpinAt,
      referralCode: user.referral_code,
      referredCount,
      transactions,
    });
  });

  // Claim Daily Login Streak (+1 Coin/day, +3 bonus on Day 7)
  router.post('/streak', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    try {
      const result = db.transaction(() => {
        const fresh = db
          .prepare('SELECT streak_days, last_streak_date, coins_balance FROM users WHERE id = ?')
          .get(user.id) as { streak_days: number; last_streak_date: string | null; coins_balance: number };

        const reward = calculateDailyStreakReward(fresh.streak_days, fresh.last_streak_date, todayStr);
        if (!reward.eligible) {
          throw new Error('ALREADY_CLAIMED');
        }

        db.prepare(
          `UPDATE users SET streak_days = ?, last_streak_date = ?, coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ?
           WHERE id = ?`,
        ).run(reward.newStreak, todayStr, reward.coinsAwarded, reward.coinsAwarded, user.id);

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'daily_streak', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          reward.coinsAwarded,
          reward.isSevenDayBonus
            ? `Day ${reward.newStreak} Streak (+1 daily + 3 7-day bonus!)`
            : `Day ${reward.newStreak} Daily Streak`,
          todayStr,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'daily_streak', 'user', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          user.id,
          reward.coinsAwarded,
          JSON.stringify({ streak: reward.newStreak, isSevenDayBonus: reward.isSevenDayBonus }),
          now,
        );

        return {
          ...reward,
          coinsBalance: fresh.coins_balance + reward.coinsAwarded,
        };
      })();

      const newlyUnlocked = checkAndUnlockAchievements(user.id);
      res.json({ ok: true, ...result, newlyUnlocked });
    } catch (err) {
      if ((err as Error).message === 'ALREADY_CLAIMED') {
        res.status(400).json({ error: 'Today’s daily streak Coins are already claimed. Come back tomorrow!' });
        return;
      }
      res.status(500).json({ error: 'Failed to claim streak' });
    }
  });

  // Daily Spin Wheel (0-5 Coins, once per 24 hours, decided strictly on server)
  router.post('/spin', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const now = new Date().toISOString();

    try {
      const result = db.transaction(() => {
        const fresh = db
          .prepare('SELECT last_spin_at, coins_balance FROM users WHERE id = ?')
          .get(user.id) as { last_spin_at: string | null; coins_balance: number };

        const eligibility = isSpinEligible(fresh.last_spin_at);
        if (!eligibility.eligible) {
          throw new Error(`COOLDOWN:${eligibility.nextSpinAt}`);
        }

        const pick = pickSpinWheelSlice();
        db.prepare(
          'UPDATE users SET last_spin_at = ?, coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?',
        ).run(now, pick.coins, pick.coins, user.id);

        if (pick.coins > 0) {
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'daily_spin', ?, ?, 'spin_wheel', ?)`,
          ).run(
            `tx_${crypto.randomUUID().slice(0, 10)}`,
            user.id,
            pick.coins,
            `Daily Spin Wheel reward (+${pick.coins} Coins)`,
            now,
          );
        }

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'daily_spin', 'user', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          user.id,
          pick.coins,
          JSON.stringify({ sliceIndex: pick.sliceIndex }),
          now,
        );

        return {
          sliceIndex: pick.sliceIndex,
          coinsAwarded: pick.coins,
          coinsBalance: fresh.coins_balance + pick.coins,
          nextSpinAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        };
      })();

      const newlyUnlocked = checkAndUnlockAchievements(user.id);
      res.json({ ok: true, ...result, newlyUnlocked });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('COOLDOWN:')) {
        res.status(400).json({ error: 'Spin wheel available once every 24 hours. Try again later!' });
        return;
      }
      res.status(500).json({ error: 'Could not spin wheel' });
    }
  });

  // Redeem Code with server validation, per-user limit 1, and 5-attempt lockout
  router.post('/redeem', requireAuth, redeemLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const code = normalizeCode(String(req.body?.code || ''));
    if (!code || code.length < 3) {
      res.status(400).json({ error: 'Enter a valid redeem code' });
      return;
    }

    const freshUser = db
      .prepare('SELECT redeem_failed_attempts, redeem_locked_until, coins_balance FROM users WHERE id = ?')
      .get(user.id) as {
      redeem_failed_attempts: number;
      redeem_locked_until: string | null;
      coins_balance: number;
    };

    if (isRedeemLocked(freshUser.redeem_failed_attempts, freshUser.redeem_locked_until)) {
      res.status(429).json({
        error: `Too many wrong attempts. Redeem codes are locked for ${REDEEM_LOCK_MINUTES} minutes.`,
      });
      return;
    }

    const codeRow = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code) as
      | {
          id: string;
          code: string;
          value_coins: number;
          usage_limit: number;
          used_count: number;
          per_user_limit: number;
          expires_at: string;
          note: string;
          is_active: number;
        }
      | undefined;

    if (!codeRow || !codeRow.is_active || Date.parse(codeRow.expires_at) < Date.now()) {
      const nextAttempts = freshUser.redeem_failed_attempts + 1;
      const lockedUntil =
        nextAttempts >= REDEEM_MAX_ATTEMPTS
          ? new Date(Date.now() + REDEEM_LOCK_MINUTES * 60 * 1000).toISOString()
          : null;
      db.prepare('UPDATE users SET redeem_failed_attempts = ?, redeem_locked_until = ? WHERE id = ?').run(
        nextAttempts,
        lockedUntil,
        user.id,
      );
      const remaining = Math.max(0, REDEEM_MAX_ATTEMPTS - nextAttempts);
      res.status(400).json({
        error:
          remaining === 0
            ? `Code invalid or expired. Locked for ${REDEEM_LOCK_MINUTES} minutes.`
            : `Invalid or expired code (${remaining} attempts remaining).`,
      });
      return;
    }

    if (codeRow.used_count >= codeRow.usage_limit) {
      res.status(400).json({ error: 'This redeem code has reached its usage limit' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const alreadyUsed = db
          .prepare('SELECT 1 FROM redeem_usages WHERE code_id = ? AND user_id = ?')
          .get(codeRow.id, user.id);
        if (alreadyUsed) {
          throw new Error('ALREADY_REDEEMED');
        }

        const now = new Date().toISOString();
        db.prepare('INSERT INTO redeem_usages (id, code_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(
          `ru_${crypto.randomUUID().slice(0, 10)}`,
          codeRow.id,
          user.id,
          now,
        );
        db.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?').run(codeRow.id);
        db.prepare(
          'UPDATE users SET coins_balance = coins_balance + ?, redeem_failed_attempts = 0, redeem_locked_until = NULL WHERE id = ?',
        ).run(codeRow.value_coins, user.id);

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'redeemed', 'redeem_code', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          codeRow.value_coins,
          `Redeemed code ${codeRow.code}${codeRow.note ? ` (${codeRow.note})` : ''}`,
          codeRow.id,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'redeem_code', 'redeem_code', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          codeRow.id,
          codeRow.value_coins,
          JSON.stringify({ code: codeRow.code }),
          now,
        );

        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Code Redeemed!', ?, 0, ?)`,
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          `Code ${codeRow.code} added +🪙${codeRow.value_coins} to your balance.`,
          now,
        );

        const updatedBalance = (
          db.prepare('SELECT coins_balance FROM users WHERE id = ?').get(user.id) as { coins_balance: number }
        ).coins_balance;
        return { updatedBalance };
      })();

      res.json({
        ok: true,
        coinsAdded: codeRow.value_coins,
        note: codeRow.note,
        coinsBalance: result.updatedBalance,
      });
    } catch (err) {
      if ((err as Error).message === 'ALREADY_REDEEMED') {
        res.status(409).json({ error: 'You have already redeemed this code' });
        return;
      }
      res.status(500).json({ error: 'Could not redeem code' });
    }
  });

  // Coin Shop: list items & user inventory
  router.get('/shop', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const items = db.prepare('SELECT * FROM shop_items ORDER BY kind, price_coins').all() as Array<{
      id: string;
      kind: string;
      key: string;
      name: string;
      description: string;
      price_coins: number;
      preview_value: string;
    }>;
    const ownedIds = new Set(
      (
        db.prepare('SELECT item_id FROM user_inventory WHERE user_id = ?').all(user.id) as Array<{ item_id: string }>
      ).map((r) => r.item_id),
    );

    res.json({
      items: items.map((it) => ({
        id: it.id,
        kind: it.kind,
        key: it.key,
        name: it.name,
        description: it.description,
        priceCoins: it.price_coins,
        previewValue: it.preview_value,
        owned: ownedIds.has(it.id),
        equipped:
          (it.kind === 'theme' && user.equipped_theme === it.key) ||
          (it.kind === 'avatar' && user.equipped_avatar === it.key) ||
          (it.kind === 'frame' && user.equipped_frame === it.key),
      })),
    });
  });

  router.post('/shop/:id/buy', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(req.params.id) as
      | { id: string; kind: string; key: string; name: string; price_coins: number }
      | undefined;
    if (!item) {
      res.status(404).json({ error: 'Shop item not found' });
      return;
    }

    try {
      const updatedBalance = db.transaction(() => {
        const owned = db
          .prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?')
          .get(user.id, item.id);
        if (owned) throw new Error('ALREADY_OWNED');

        const fresh = db
          .prepare('SELECT coins_balance FROM users WHERE id = ?')
          .get(user.id) as { coins_balance: number };
        if (fresh.coins_balance < item.price_coins) throw new Error('INSUFFICIENT_COINS');

        const now = new Date().toISOString();
        db.prepare('UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?').run(item.price_coins, user.id);
        db.prepare('INSERT INTO user_inventory (user_id, item_id, purchased_at) VALUES (?, ?, ?)').run(
          user.id,
          item.id,
          now,
        );

        const col =
          item.kind === 'theme'
            ? 'equipped_theme'
            : item.kind === 'avatar'
              ? 'equipped_avatar'
              : 'equipped_frame';
        db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(item.key, user.id);

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'shop_purchase', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          -item.price_coins,
          `Bought ${item.name} in Coin Shop`,
          item.id,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'shop_purchase', 'shop_item', ?, ?, '{}', ?)`,
        ).run(`aud_${crypto.randomUUID().slice(0, 10)}`, user.id, item.id, item.price_coins, now);

        return fresh.coins_balance - item.price_coins;
      })();

      res.json({ ok: true, coinsBalance: updatedBalance });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'ALREADY_OWNED') {
        res.status(409).json({ error: 'You already own this item' });
        return;
      }
      if (msg === 'INSUFFICIENT_COINS') {
        res.status(400).json({ error: 'Not enough Coins for this item' });
        return;
      }
      res.status(500).json({ error: 'Purchase failed' });
    }
  });

  router.post('/shop/:id/equip', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(req.params.id) as
      | { id: string; kind: string; key: string }
      | undefined;
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    const owned = db
      .prepare('SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?')
      .get(user.id, item.id);
    if (!owned) {
      res.status(403).json({ error: 'Unlock this item in the Coin Shop first' });
      return;
    }
    const col =
      item.kind === 'theme'
        ? 'equipped_theme'
        : item.kind === 'avatar'
          ? 'equipped_avatar'
          : 'equipped_frame';
    db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(item.key, user.id);
    res.json({ ok: true });
  });

  return router;
}
