import crypto from 'node:crypto';
import type { Response } from 'express';
import express from 'express';
import { checkAndUnlockAchievements } from '../achievements';
import { db } from '../db';
import {
  normalizeCode,
  parsePositiveIntCoins,
  validateUploadRewardCoins,
} from '../domain';
import { broadcastToRoom } from '../ws';
import { type AuthedRequest, requireAdmin } from './auth';

export function createAdminRouter(): express.Router {
  const router = express.Router();
  router.use(requireAdmin);

  // Dashboard Stats & Rich Analytics (Top Subjects, Peak Hours, Zero-Result Search Keywords)
  router.get('/dashboard', (_req: AuthedRequest, res: Response) => {
    const totalUnlocks = (
      db.prepare('SELECT COUNT(*) as c FROM purchases WHERE refunded = 0').get() as { c: number }
    ).c;
    const totalStudents = (
      db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student'").get() as { c: number }
    ).c;
    const pendingNotes = (
      db.prepare("SELECT COUNT(*) as c FROM notes WHERE status = 'pending'").get() as { c: number }
    ).c;
    const openNoteReports = (
      db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'open'").get() as { c: number }
    ).c;
    const openChatReports = (
      db.prepare("SELECT COUNT(*) as c FROM chat_reports WHERE status = 'open'").get() as { c: number }
    ).c;
    const pendingRefunds = (
      db.prepare("SELECT COUNT(*) as c FROM refund_requests WHERE status = 'pending'").get() as { c: number }
    ).c;
    const coinsBurnedTotal = Number(
      (db.prepare("SELECT value FROM app_settings WHERE key = 'coins_burned_total'").get() as { value: string } | undefined)
        ?.value || 0,
    );
    const coinsCirculating = (
      db.prepare('SELECT COALESCE(SUM(coins_balance), 0) as s FROM users').get() as { s: number }
    ).s;

    const topSubjects = db
      .prepare(
        `SELECT subject, COUNT(*) as noteCount, COALESCE(SUM(sales_count), 0) as totalUnlocks
         FROM notes
         WHERE status = 'approved'
         GROUP BY subject
         ORDER BY totalUnlocks DESC, noteCount DESC
         LIMIT 6`,
      )
      .all() as Array<{ subject: string; noteCount: number; totalUnlocks: number }>;

    const zeroResultSearches = db
      .prepare(
        `SELECT query, COUNT(*) as searchCount
         FROM search_logs
         WHERE results_count = 0
         GROUP BY query
         ORDER BY searchCount DESC
         LIMIT 8`,
      )
      .all() as Array<{ query: string; searchCount: number }>;

    // Peak hours breakdown across purchases, searches, and chat messages (0..23 UTC)
    const hourRows = db
      .prepare(
        `SELECT CAST(strftime('%H', created_at) AS INTEGER) as hr, COUNT(*) as cnt
         FROM (
           SELECT created_at FROM purchases
           UNION ALL SELECT created_at FROM search_logs
           UNION ALL SELECT created_at FROM chat_messages
         )
         GROUP BY hr
         ORDER BY hr ASC`,
      )
      .all() as Array<{ hr: number; cnt: number }>;

    const peakHours = Array.from({ length: 24 }, (_, hr) => ({
      hour: hr,
      count: hourRows.find((r) => r.hr === hr)?.cnt || 0,
    }));

    res.json({
      stats: {
        totalUnlocks,
        totalStudents,
        pendingNotes,
        openNoteReports,
        openChatReports,
        pendingRefunds,
        coinsBurnedTotal,
        coinsCirculating,
      },
      analytics: {
        topSubjects,
        zeroResultSearches,
        peakHours,
      },
    });
  });

  // Review Queue (pending + auto-hidden notes)
  router.get('/queue', (_req: AuthedRequest, res: Response) => {
    const notes = db
      .prepare(
        `SELECT n.*, u.name as uploader_name, u.email as uploader_email
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE n.status IN ('pending', 'hidden_review')
         ORDER BY n.created_at ASC`,
      )
      .all();
    res.json({ queue: notes });
  });

  router.post('/notes/:id/review', (req: AuthedRequest, res: Response) => {
    const decision = req.body?.decision === 'approve' ? 'approved' : 'rejected';
    const rejectionReason = String(req.body?.rejectionReason || '').trim().slice(0, 300);
    const rewardCoins = parsePositiveIntCoins(req.body?.uploadRewardCoins ?? 2);

    if (decision === 'approved') {
      if (rewardCoins === null) {
        res.status(400).json({ error: 'Invalid upload reward amount' });
        return;
      }
      const err = validateUploadRewardCoins(rewardCoins);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    } else if (rejectionReason.length < 5) {
      res.status(400).json({ error: 'Provide a clear rejection reason (5+ characters)' });
      return;
    }

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as
      | { id: string; uploader_id: string; title: string; status: string }
      | undefined;
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    const now = new Date().toISOString();
    db.transaction(() => {
      if (decision === 'approved') {
        const appliedReward = note.status === 'pending' ? rewardCoins! : 0;
        db.prepare(
          "UPDATE notes SET status = 'approved', rejection_reason = '', upload_reward_coins = ? WHERE id = ?",
        ).run(appliedReward, note.id);

        if (appliedReward > 0) {
          db.prepare(
            'UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?',
          ).run(appliedReward, appliedReward, note.uploader_id);

          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'upload_reward', ?, ?, ?, ?)`,
          ).run(
            `tx_${crypto.randomUUID().slice(0, 10)}`,
            note.uploader_id,
            appliedReward,
            `Upload reward for "${note.title}"`,
            note.id,
            now,
          );
        }

        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Note Approved!', ?, 0, ?)`,
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          note.uploader_id,
          `Your note "${note.title}" is now live${appliedReward > 0 ? ` (+🪙${appliedReward} reward!)` : '.'}`,
          now,
        );
      } else {
        db.prepare("UPDATE notes SET status = 'rejected', rejection_reason = ? WHERE id = ?").run(
          rejectionReason,
          note.id,
        );
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Note Rejected', ?, 0, ?)`,
        ).run(
          `ntf_${crypto.randomUUID().slice(0, 10)}`,
          note.uploader_id,
          `"${note.title}" was rejected: ${rejectionReason}`,
          now,
        );
      }

      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
         VALUES (?, ?, ?, 'note', ?, ?, ?, ?)`,
      ).run(
        `aud_${crypto.randomUUID().slice(0, 10)}`,
        req.user!.id,
        `admin_note_${decision}`,
        note.id,
        decision === 'approved' ? rewardCoins : 0,
        JSON.stringify({ rejectionReason }),
        now,
      );
    })();

    if (decision === 'approved') {
      checkAndUnlockAchievements(note.uploader_id);
    }

    res.json({ ok: true, status: decision });
  });

  // Redeem Codes Manager
  router.get('/redeem-codes', (_req: AuthedRequest, res: Response) => {
    const codes = db.prepare('SELECT * FROM redeem_codes ORDER BY created_at DESC').all();
    res.json({ codes });
  });

  router.post('/redeem-codes', (req: AuthedRequest, res: Response) => {
    const code = normalizeCode(String(req.body?.code || ''));
    const valueCoins = parsePositiveIntCoins(req.body?.valueCoins);
    const usageLimit = parsePositiveIntCoins(req.body?.usageLimit);
    const expiresAt = String(req.body?.expiresAt || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 80);

    if (code.length < 3 || !valueCoins || valueCoins < 1 || !usageLimit || usageLimit < 1 || !expiresAt) {
      res.status(400).json({ error: 'Provide a valid code, coin value (>=1), usage limit, and expiry date' });
      return;
    }

    try {
      const id = `rc_${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO redeem_codes (id, code, value_coins, usage_limit, used_count, per_user_limit, expires_at, note, is_active, created_at)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, 1, ?)`,
      ).run(id, code, valueCoins, usageLimit, new Date(expiresAt).toISOString(), note, new Date().toISOString());
      res.status(201).json({ ok: true, id });
    } catch {
      res.status(409).json({ error: 'A redeem code with this name already exists' });
    }
  });

  router.post('/redeem-codes/:id/toggle', (req: AuthedRequest, res: Response) => {
    db.prepare('UPDATE redeem_codes SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(
      req.params.id,
    );
    res.json({ ok: true });
  });

  // Gemini Bundles Creator & Requests Fulfillment
  router.post('/bundles', (req: AuthedRequest, res: Response) => {
    const title = String(req.body?.title || '').trim().slice(0, 100);
    const description = String(req.body?.description || '').trim().slice(0, 240);
    const bundlePriceCoins = parsePositiveIntCoins(req.body?.bundlePriceCoins);
    const noteIds = Array.isArray(req.body?.noteIds) ? (req.body.noteIds as string[]) : [];

    if (title.length < 4 || !bundlePriceCoins || bundlePriceCoins < 5 || noteIds.length < 2) {
      res.status(400).json({ error: 'Bundle requires a title, >= 5 Coins price, and at least 2 Gemini Notes' });
      return;
    }

    const id = `bnd_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO gemini_bundles (id, title, description, bundle_price_coins, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
      ).run(id, title, description || 'Discounted Official Gemini Bundle', bundlePriceCoins, now);
      const ins = db.prepare('INSERT OR IGNORE INTO gemini_bundle_items (bundle_id, note_id) VALUES (?, ?)');
      for (const nid of noteIds) {
        ins.run(id, nid);
      }
    })();

    res.status(201).json({ ok: true, id });
  });

  router.post('/gemini-requests/:id/fulfill', (req: AuthedRequest, res: Response) => {
    db.prepare("UPDATE gemini_requests SET status = 'fulfilled' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // 24h Coin Refund Requests Queue
  router.get('/refunds', (_req: AuthedRequest, res: Response) => {
    const refunds = db
      .prepare(
        `SELECT rr.*, n.title as note_title, p.price_coins, p.uploader_coins, u.name as buyer_name
         FROM refund_requests rr
         JOIN purchases p ON p.id = rr.purchase_id
         JOIN notes n ON n.id = rr.note_id
         JOIN users u ON u.id = rr.buyer_id
         ORDER BY rr.status ASC, rr.created_at DESC`,
      )
      .all();
    res.json({ refunds });
  });

  router.post('/refunds/:id/process', (req: AuthedRequest, res: Response) => {
    const approve = req.body?.approve === true;
    const adminNote = String(req.body?.adminNote || '').trim().slice(0, 200);
    const rfd = db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(req.params.id) as
      | { id: string; purchase_id: string; note_id: string; buyer_id: string; status: string }
      | undefined;

    if (!rfd || rfd.status !== 'pending') {
      res.status(404).json({ error: 'Pending refund request not found' });
      return;
    }

    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(rfd.purchase_id) as {
      id: string;
      price_coins: number;
      uploader_coins: number;
    };
    const note = db.prepare('SELECT uploader_id, title FROM notes WHERE id = ?').get(rfd.note_id) as {
      uploader_id: string;
      title: string;
    };
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare('UPDATE refund_requests SET status = ?, admin_note = ?, processed_at = ? WHERE id = ?').run(
        approve ? 'approved' : 'rejected',
        adminNote,
        now,
        rfd.id,
      );

      if (approve) {
        db.prepare('UPDATE purchases SET refunded = 1 WHERE id = ?').run(purchase.id);
        db.prepare('UPDATE users SET coins_balance = coins_balance + ? WHERE id = ?').run(
          purchase.price_coins,
          rfd.buyer_id,
        );
        if (purchase.uploader_coins > 0) {
          db.prepare('UPDATE users SET coins_balance = MAX(0, coins_balance - ?) WHERE id = ?').run(
            purchase.uploader_coins,
            note.uploader_id,
          );
        }

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'coin_refund', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          rfd.buyer_id,
          purchase.price_coins,
          `24h Coin refund approved for "${note.title}"`,
          rfd.id,
          now,
        );
      }

      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      ).run(
        `ntf_${crypto.randomUUID().slice(0, 10)}`,
        rfd.buyer_id,
        approve ? 'Coin Refund Approved' : 'Refund Request Declined',
        approve
          ? `+🪙${purchase.price_coins} returned to your balance for "${note.title}".`
          : `Your refund request for "${note.title}" was declined.${adminNote ? ` Note: ${adminNote}` : ''}`,
        now,
      );

      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
         VALUES (?, ?, ?, 'refund_request', ?, ?, ?, ?)`,
      ).run(
        `aud_${crypto.randomUUID().slice(0, 10)}`,
        req.user!.id,
        approve ? 'refund_approved' : 'refund_rejected',
        rfd.id,
        approve ? purchase.price_coins : 0,
        JSON.stringify({ adminNote }),
        now,
      );
    })();

    res.json({ ok: true });
  });

  // Reports: Note Reports + REPORTED Chat Messages ONLY (privacy-preserving)
  router.get('/reports', (_req: AuthedRequest, res: Response) => {
    const noteReports = db
      .prepare(
        `SELECT r.*, n.title as note_title, n.status as note_status, u.name as reporter_name
         FROM reports r
         JOIN notes n ON n.id = r.note_id
         JOIN users u ON u.id = r.reporter_id
         ORDER BY r.status ASC, r.created_at DESC`,
      )
      .all();

    const chatReports = db
      .prepare(
        `SELECT cr.*, cm.body as message_body, cm.is_deleted,
         ru.name as reported_user_name, ru.is_chat_muted, ru.is_banned,
         rep.name as reporter_name
         FROM chat_reports cr
         JOIN chat_messages cm ON cm.id = cr.message_id
         JOIN users ru ON ru.id = cr.reported_user_id
         JOIN users rep ON rep.id = cr.reporter_id
         ORDER BY cr.status ASC, cr.created_at DESC`,
      )
      .all();

    const suspiciousTransfers = db
      .prepare(
        `SELECT ct.*, su.name as sender_name, ru.name as receiver_name
         FROM coin_transfers ct
         JOIN users su ON su.id = ct.sender_id
         JOIN users ru ON ru.id = ct.receiver_id
         WHERE ct.flagged_suspicious = 1
         ORDER BY ct.created_at DESC
         LIMIT 30`,
      )
      .all();

    res.json({ noteReports, chatReports, suspiciousTransfers });
  });

  router.post('/reports/note/:id/resolve', (req: AuthedRequest, res: Response) => {
    const action = String(req.body?.action || 'dismiss'); // 'dismiss' | 'remove_note'
    const rep = db.prepare('SELECT note_id FROM reports WHERE id = ?').get(req.params.id) as
      | { note_id: string }
      | undefined;
    if (!rep) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    db.transaction(() => {
      db.prepare("UPDATE reports SET status = 'resolved' WHERE note_id = ?").run(rep.note_id);
      if (action === 'remove_note') {
        db.prepare("UPDATE notes SET status = 'rejected', rejection_reason = 'Removed after moderation review' WHERE id = ?").run(
          rep.note_id,
        );
      } else {
        db.prepare("UPDATE notes SET status = 'approved', report_count = 0 WHERE id = ?").run(rep.note_id);
      }
    })();

    res.json({ ok: true });
  });

  router.post('/reports/chat/:id/resolve', (req: AuthedRequest, res: Response) => {
    const action = String(req.body?.action || 'dismiss'); // 'dismiss' | 'delete_msg' | 'mute_user' | 'ban_user'
    const crep = db.prepare('SELECT * FROM chat_reports WHERE id = ?').get(req.params.id) as
      | { id: string; message_id: string; room_id: string; reported_user_id: string }
      | undefined;
    if (!crep) {
      res.status(404).json({ error: 'Chat report not found' });
      return;
    }

    db.transaction(() => {
      db.prepare("UPDATE chat_reports SET status = 'resolved' WHERE id = ?").run(crep.id);
      if (action === 'delete_msg' || action === 'mute_user' || action === 'ban_user') {
        db.prepare('UPDATE chat_messages SET is_deleted = 1 WHERE id = ?').run(crep.message_id);
      }
      if (action === 'mute_user') {
        db.prepare('UPDATE users SET is_chat_muted = 1 WHERE id = ?').run(crep.reported_user_id);
      }
      if (action === 'ban_user') {
        db.prepare('UPDATE users SET is_banned = 1, is_chat_muted = 1 WHERE id = ?').run(crep.reported_user_id);
      }
    })();

    if (action !== 'dismiss') {
      broadcastToRoom(crep.room_id, { type: 'chat:deleted', messageId: crep.message_id });
    }
    res.json({ ok: true });
  });

  // Users Management (Ban/Unban, Mute/Unmute) + Audit Log preview
  router.get('/users', (_req: AuthedRequest, res: Response) => {
    const users = db
      .prepare(
        `SELECT id, name, email, role, auth_provider, is_minor, is_banned, is_chat_muted,
         coins_balance, coins_earned_total, streak_days, created_at
         FROM users
         ORDER BY created_at DESC`,
      )
      .all();
    const auditLogs = db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 40')
      .all();
    res.json({ users, auditLogs });
  });

  router.post('/users/:id/status', (req: AuthedRequest, res: Response) => {
    const targetId = req.params.id;
    if (targetId === req.user!.id) {
      res.status(400).json({ error: 'You cannot ban or mute yourself' });
      return;
    }
    const action = String(req.body?.action || '');
    if (action === 'ban') db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(targetId);
    if (action === 'unban') db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(targetId);
    if (action === 'mute') db.prepare('UPDATE users SET is_chat_muted = 1 WHERE id = ?').run(targetId);
    if (action === 'unmute') db.prepare('UPDATE users SET is_chat_muted = 0, chat_report_count = 0 WHERE id = ?').run(targetId);
    res.json({ ok: true });
  });

  return router;
}
