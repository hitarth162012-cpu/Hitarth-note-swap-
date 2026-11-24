import crypto from 'node:crypto';
import type { Response } from 'express';
import express from 'express';
import { checkAndUnlockAchievements } from '../achievements';
import { db } from '../db';
import {
  calculateExamCountdownDays,
  getCreatorLevel,
  parsePositiveIntCoins,
  validateDoubtRewardCoins,
} from '../domain';
import { createRateLimiter } from '../security';
import { type AuthedRequest, requireAuth } from './auth';

export function createCommunityRouter(): express.Router {
  const router = express.Router();
  const limiter = createRateLimiter('community', 30, 60 * 1000);

  // Weekly & Top Uploaders Leaderboard
  router.get('/leaderboard', (_req, res: Response) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.equipped_avatar, u.equipped_frame, u.coins_earned_total,
         (SELECT COUNT(*) FROM notes n WHERE n.uploader_id = u.id AND n.status = 'approved') as approved_uploads,
         (SELECT COALESCE(SUM(n.sales_count), 0) FROM notes n WHERE n.uploader_id = u.id) as total_sales,
         (SELECT COALESCE(AVG(NULLIF(n.rating_avg, 0)), 0) FROM notes n WHERE n.uploader_id = u.id AND n.rating_count > 0) as avg_rating
         FROM users u
         WHERE u.role = 'student' AND u.is_banned = 0
         ORDER BY u.coins_earned_total DESC, total_sales DESC
         LIMIT 15`,
      )
      .all() as Array<{
      id: string;
      name: string;
      equipped_avatar: string;
      equipped_frame: string;
      coins_earned_total: number;
      approved_uploads: number;
      total_sales: number;
      avg_rating: number;
    }>;

    res.json({
      leaderboard: rows.map((r, idx) => ({
        rank: idx + 1,
        id: r.id,
        name: r.name,
        avatar: r.equipped_avatar,
        frame: r.equipped_frame,
        coinsEarnedTotal: r.coins_earned_total,
        approvedUploads: r.approved_uploads,
        totalSales: r.total_sales,
        avgRating: Number((r.avg_rating || 0).toFixed(1)),
        level: getCreatorLevel(r.approved_uploads).level,
      })),
    });
  });

  // Follow / Unfollow Uploader
  router.post('/users/:id/follow', requireAuth, (req: AuthedRequest, res: Response) => {
    const followerId = req.user!.id;
    const targetId = req.params.id;
    if (followerId === targetId) {
      res.status(400).json({ error: 'You cannot follow yourself' });
      return;
    }
    const existing = db
      .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(followerId, targetId);
    if (existing) {
      db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(followerId, targetId);
      res.json({ following: false });
    } else {
      db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').run(
        followerId,
        targetId,
        new Date().toISOString(),
      );
      res.json({ following: true });
    }
  });

  // Notifications
  router.get('/notifications', requireAuth, (req: AuthedRequest, res: Response) => {
    const items = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(req.user!.id);
    res.json({ notifications: items });
  });

  router.post('/notifications/read', requireAuth, (req: AuthedRequest, res: Response) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
    res.json({ ok: true });
  });

  // Exam Countdown + Reminders
  router.get('/exam-countdown', requireAuth, (req: AuthedRequest, res: Response) => {
    const row = db.prepare('SELECT * FROM user_exams WHERE user_id = ?').get(req.user!.id) as
      | { exam_name: string; exam_date: string; reminder_days: number }
      | undefined;
    if (!row) {
      res.json({ exam: null });
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    res.json({
      exam: {
        examName: row.exam_name,
        examDate: row.exam_date,
        reminderDays: row.reminder_days,
        daysLeft: calculateExamCountdownDays(row.exam_date, todayStr),
      },
    });
  });

  router.put('/exam-countdown', requireAuth, (req: AuthedRequest, res: Response) => {
    const examName = String(req.body?.examName || '').trim().slice(0, 60);
    const examDate = String(req.body?.examDate || '').trim();
    const reminderDays = Math.min(90, Math.max(1, Number(req.body?.reminderDays || 14)));

    if (!examName || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      res.status(400).json({ error: 'Select an exam and valid date (YYYY-MM-DD)' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO user_exams (user_id, exam_name, exam_date, reminder_days, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET exam_name = excluded.exam_name, exam_date = excluded.exam_date, reminder_days = excluded.reminder_days, updated_at = excluded.updated_at`,
    ).run(req.user!.id, examName, examDate, reminderDays, now);

    const todayStr = now.slice(0, 10);
    res.json({
      ok: true,
      exam: {
        examName,
        examDate,
        reminderDays,
        daysLeft: calculateExamCountdownDays(examDate, todayStr),
      },
    });
  });

  // Gemini Note Topic Requests (vote on topics for Admin to publish)
  router.get('/gemini-requests', (req: AuthedRequest, res: Response) => {
    const userId = req.user?.id;
    const rows = db
      .prepare(
        `SELECT gr.*, u.name as requester_name
         FROM gemini_requests gr
         JOIN users u ON u.id = gr.user_id
         ORDER BY gr.status ASC, gr.votes_count DESC, gr.created_at DESC`,
      )
      .all() as Array<{
      id: string;
      topic: string;
      subject: string;
      exam_class: string;
      votes_count: number;
      status: string;
      requester_name: string;
      created_at: string;
    }>;

    const myVotes = userId
      ? new Set(
          (
            db
              .prepare('SELECT request_id FROM gemini_request_votes WHERE user_id = ?')
              .all(userId) as Array<{ request_id: string }>
          ).map((r) => r.request_id),
        )
      : new Set<string>();

    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        topic: r.topic,
        subject: r.subject,
        examClass: r.exam_class,
        votesCount: r.votes_count,
        status: r.status,
        requesterName: r.requester_name,
        hasVoted: myVotes.has(r.id),
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/gemini-requests', requireAuth, limiter, (req: AuthedRequest, res: Response) => {
    const topic = String(req.body?.topic || '').trim().slice(0, 120);
    const subject = String(req.body?.subject || '').trim().slice(0, 40);
    const examClass = String(req.body?.examClass || '').trim().slice(0, 40);
    if (topic.length < 5 || !subject || !examClass) {
      res.status(400).json({ error: 'Topic (5+ chars), subject, and exam are required' });
      return;
    }

    const id = `greq_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO gemini_requests (id, user_id, topic, subject, exam_class, votes_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'open', ?)`,
      ).run(id, req.user!.id, topic, subject, examClass, now);
      db.prepare(
        'INSERT INTO gemini_request_votes (request_id, user_id, created_at) VALUES (?, ?, ?)',
      ).run(id, req.user!.id, now);
    })();
    res.status(201).json({ ok: true, id });
  });

  router.post('/gemini-requests/:id/vote', requireAuth, limiter, (req: AuthedRequest, res: Response) => {
    const reqId = req.params.id;
    const userId = req.user!.id;
    const existing = db
      .prepare('SELECT 1 FROM gemini_request_votes WHERE request_id = ? AND user_id = ?')
      .get(reqId, userId);

    db.transaction(() => {
      if (existing) {
        db.prepare('DELETE FROM gemini_request_votes WHERE request_id = ? AND user_id = ?').run(reqId, userId);
        db.prepare('UPDATE gemini_requests SET votes_count = MAX(0, votes_count - 1) WHERE id = ?').run(reqId);
      } else {
        db.prepare(
          'INSERT INTO gemini_request_votes (request_id, user_id, created_at) VALUES (?, ?, ?)',
        ).run(reqId, userId, new Date().toISOString());
        db.prepare('UPDATE gemini_requests SET votes_count = votes_count + 1 WHERE id = ?').run(reqId);
      }
    })();

    res.json({ voted: !existing });
  });

  // Doubt Forum: list doubts with answers
  router.get('/doubts', (_req, res: Response) => {
    const doubts = db
      .prepare(
        `SELECT d.*, u.name as author_name, u.equipped_avatar as author_avatar
         FROM doubts d
         JOIN users u ON u.id = d.user_id
         ORDER BY d.status DESC, d.created_at DESC
         LIMIT 40`,
      )
      .all() as Array<{
      id: string;
      user_id: string;
      subject: string;
      exam_class: string;
      title: string;
      body: string;
      best_answer_id: string | null;
      status: string;
      created_at: string;
      author_name: string;
      author_avatar: string;
    }>;

    const answersStmt = db.prepare(
      `SELECT da.*, u.name as author_name, u.equipped_avatar as author_avatar
       FROM doubt_answers da
       JOIN users u ON u.id = da.user_id
       WHERE da.doubt_id = ?
       ORDER BY da.is_best DESC, da.created_at ASC`,
    );

    res.json({
      doubts: doubts.map((d) => ({
        id: d.id,
        userId: d.user_id,
        authorName: d.author_name,
        authorAvatar: d.author_avatar,
        subject: d.subject,
        examClass: d.exam_class,
        title: d.title,
        body: d.body,
        bestAnswerId: d.best_answer_id,
        status: d.status,
        createdAt: d.created_at,
        answers: (answersStmt.all(d.id) as Array<{
          id: string;
          user_id: string;
          body: string;
          is_best: number;
          reward_coins: number;
          created_at: string;
          author_name: string;
          author_avatar: string;
        }>).map((a) => ({
          id: a.id,
          userId: a.user_id,
          authorName: a.author_name,
          authorAvatar: a.author_avatar,
          body: a.body,
          isBest: Boolean(a.is_best),
          rewardCoins: a.reward_coins,
          createdAt: a.created_at,
        })),
      })),
    });
  });

  router.post('/doubts', requireAuth, limiter, (req: AuthedRequest, res: Response) => {
    const title = String(req.body?.title || '').trim().slice(0, 140);
    const body = String(req.body?.body || '').trim().slice(0, 1000);
    const subject = String(req.body?.subject || '').trim().slice(0, 40);
    const examClass = String(req.body?.examClass || '').trim().slice(0, 40);
    if (title.length < 6 || body.length < 10 || !subject || !examClass) {
      res.status(400).json({ error: 'Provide a clear question title, details, subject, and exam' });
      return;
    }

    const id = `dbt_${crypto.randomUUID().slice(0, 10)}`;
    db.prepare(
      `INSERT INTO doubts (id, user_id, subject, exam_class, title, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    ).run(id, req.user!.id, subject, examClass, title, body, new Date().toISOString());

    res.status(201).json({ ok: true, id });
  });

  router.post('/doubts/:id/answers', requireAuth, limiter, (req: AuthedRequest, res: Response) => {
    const doubt = db.prepare('SELECT id, user_id FROM doubts WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string }
      | undefined;
    if (!doubt) {
      res.status(404).json({ error: 'Doubt not found' });
      return;
    }
    const body = String(req.body?.body || '').trim().slice(0, 1000);
    if (body.length < 5) {
      res.status(400).json({ error: 'Answer must be at least 5 characters' });
      return;
    }
    const id = `ans_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO doubt_answers (id, doubt_id, user_id, body, is_best, reward_coins, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?)`,
    ).run(id, doubt.id, req.user!.id, body, now);

    if (doubt.user_id !== req.user!.id) {
      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
         VALUES (?, ?, 'New Doubt Answer', ?, 0, ?)`,
      ).run(`ntf_${crypto.randomUUID().slice(0, 10)}`, doubt.user_id, `${req.user!.name} answered your doubt!`, now);
    }

    res.status(201).json({ ok: true, id });
  });

  // Asker marks best answer & rewards 1-5 Coins atomically
  router.post('/doubts/:id/best-answer', requireAuth, limiter, (req: AuthedRequest, res: Response) => {
    const asker = req.user!;
    const answerId = String(req.body?.answerId || '');
    const rewardCoins = parsePositiveIntCoins(req.body?.rewardCoins);
    if (rewardCoins === null) {
      res.status(400).json({ error: 'Enter a valid whole number of Coins (1 to 5)' });
      return;
    }
    const errMsg = validateDoubtRewardCoins(rewardCoins);
    if (errMsg) {
      res.status(400).json({ error: errMsg });
      return;
    }

    try {
      const updatedBalance = db.transaction(() => {
        const doubt = db.prepare('SELECT * FROM doubts WHERE id = ?').get(req.params.id) as
          | { id: string; user_id: string; status: string; title: string }
          | undefined;
        if (!doubt) throw new Error('NOT_FOUND');
        if (doubt.user_id !== asker.id) throw new Error('FORBIDDEN');
        if (doubt.status === 'resolved') throw new Error('ALREADY_RESOLVED');

        const answer = db
          .prepare('SELECT * FROM doubt_answers WHERE id = ? AND doubt_id = ?')
          .get(answerId, doubt.id) as { id: string; user_id: string } | undefined;
        if (!answer) throw new Error('ANSWER_NOT_FOUND');
        if (answer.user_id === asker.id) throw new Error('SELF_REWARD');

        const freshAsker = db
          .prepare('SELECT coins_balance FROM users WHERE id = ?')
          .get(asker.id) as { coins_balance: number };
        if (freshAsker.coins_balance < rewardCoins) throw new Error('INSUFFICIENT_COINS');

        const now = new Date().toISOString();
        db.prepare('UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?').run(rewardCoins, asker.id);
        db.prepare(
          'UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?',
        ).run(rewardCoins, rewardCoins, answer.user_id);

        db.prepare("UPDATE doubts SET best_answer_id = ?, status = 'resolved' WHERE id = ?").run(answer.id, doubt.id);
        db.prepare('UPDATE doubt_answers SET is_best = 1, reward_coins = ? WHERE id = ?').run(rewardCoins, answer.id);

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'doubt_reward_sent', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          asker.id,
          -rewardCoins,
          `Rewarded best answer on "${doubt.title}"`,
          doubt.id,
          now,
        );
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'doubt_reward_received', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          answer.user_id,
          rewardCoins,
          `Best answer reward on "${doubt.title}"`,
          doubt.id,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'doubt_best_answer', 'doubt', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          asker.id,
          doubt.id,
          rewardCoins,
          JSON.stringify({ receiverId: answer.user_id, answerId: answer.id }),
          now,
        );

        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Doubt Reward!', ?, 0, ?)`,
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          answer.user_id,
          `${asker.name} marked your answer as Best and sent +🪙${rewardCoins}!`,
          now,
        );

        return freshAsker.coins_balance - rewardCoins;
      })();

      const helperUserId = (
        db.prepare('SELECT user_id FROM doubt_answers WHERE id = ?').get(answerId) as { user_id: string } | undefined
      )?.user_id;
      if (helperUserId) checkAndUnlockAchievements(helperUserId);

      res.json({ ok: true, coinsBalance: updatedBalance });
    } catch (err) {
      const msg = (err as Error).message;
      const map: Record<string, [number, string]> = {
        NOT_FOUND: [404, 'Doubt not found'],
        FORBIDDEN: [403, 'Only the question author can pick the best answer'],
        ALREADY_RESOLVED: [400, 'Best answer was already rewarded'],
        ANSWER_NOT_FOUND: [404, 'Answer not found'],
        SELF_REWARD: [400, 'You cannot reward your own answer'],
        INSUFFICIENT_COINS: [400, 'Not enough Coins to send that reward'],
      };
      const [status, text] = map[msg] || [500, 'Could not reward answer'];
      res.status(status).json({ error: text });
    }
  });

  return router;
}
