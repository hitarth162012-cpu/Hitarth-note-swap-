import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import express from 'express';
import multer from 'multer';
import { checkAndUnlockAchievements } from '../achievements';
import { db } from '../db';
import {
  AUTO_HIDE_REPORT_THRESHOLD,
  calculateCoinUnlockSplit,
  computeSha256,
  GEMINI_NOTE_PRICE_COINS,
  getCreatorLevel,
  isWithinRefundWindow,
  parsePositiveIntCoins,
  REFERRAL_BONUS_COINS,
  signViewerToken,
  validateNoteUploadPriceCoins,
  verifyViewerToken,
} from '../domain';
import {
  ensurePrivateStorageDir,
  renderBlurredPreviewSvg,
  renderStructuredPageSvg,
  resolveSafePrivatePath,
  type StructuredPage,
} from '../noteRenderer';
import { createRateLimiter, SERVER_SECRET } from '../security';
import { type AuthedRequest, requireAuth } from './auth';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per file
    files: 10,
  },
});

interface NoteRow {
  id: string;
  uploader_id: string;
  title: string;
  subject: string;
  exam_class: string;
  description: string;
  tags: string;
  price_coins: number;
  is_free_sample: number;
  is_gemini_note: number;
  is_pyq: number;
  pyq_year: string;
  preview_pages_count: number;
  page_count: number;
  file_type: string;
  file_path: string;
  file_hash: string;
  cover_image: string;
  status: string;
  rejection_reason: string;
  upload_reward_coins: number;
  sales_count: number;
  total_earned_coins: number;
  rating_avg: number;
  rating_count: number;
  copyright_declared: number;
  report_count: number;
  created_at: string;
}

function formatNoteSummary(row: NoteRow & { uploader_name?: string; uploader_avatar?: string; uploader_frame?: string; uploader_approved_count?: number }) {
  const approvedCount = row.uploader_approved_count ?? 0;
  return {
    id: row.id,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name || 'Student Creator',
    uploaderAvatar: row.uploader_avatar || 'scholar',
    uploaderFrame: row.uploader_frame || 'none',
    uploaderLevel: getCreatorLevel(approvedCount).level,
    title: row.title,
    subject: row.subject,
    examClass: row.exam_class,
    description: row.description,
    tags: (() => {
      try {
        return JSON.parse(row.tags);
      } catch {
        return [];
      }
    })(),
    priceCoins: row.price_coins,
    isFreeSample: Boolean(row.is_free_sample),
    isGeminiNote: Boolean(row.is_gemini_note),
    isPyq: Boolean(row.is_pyq),
    pyqYear: row.pyq_year || '',
    previewPagesCount: row.preview_pages_count,
    pageCount: row.page_count,
    fileType: row.file_type,
    coverImage: row.cover_image || `/api/notes/${row.id}/preview`,
    status: row.status,
    rejectionReason: row.rejection_reason || '',
    uploadRewardCoins: row.upload_reward_coins,
    salesCount: row.sales_count,
    totalEarnedCoins: row.total_earned_coins,
    ratingAvg: Number((row.rating_avg || 0).toFixed(1)),
    ratingCount: row.rating_count,
    createdAt: row.created_at,
  };
}

export function extractNotePlainText(note: NoteRow): string {
  const fullPath = resolveSafePrivatePath(note.file_path);
  if (note.file_type === 'structured') {
    const pages = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as StructuredPage[];
    return pages
      .map(
        (p, idx) =>
          `Page ${idx + 1}: ${p.heading}\n${p.subheading || ''}\n${p.bullets.join('\n')}\nFormula: ${p.formula || ''}\nTip: ${p.tip || ''}`,
      )
      .join('\n\n');
  }
  return `Title: ${note.title}\nSubject: ${note.subject}\nExam: ${note.exam_class}\nDescription: ${note.description}`;
}

export function userHasFullAccess(userId: string | undefined, note: NoteRow): boolean {
  if (note.is_free_sample === 1) return true;
  if (!userId) return false;
  if (note.uploader_id === userId) return true;
  const userRow = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (userRow?.role === 'admin') return true;
  const purchase = db
    .prepare('SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0')
    .get(userId, note.id);
  return Boolean(purchase);
}

export function createNotesRouter(): express.Router {
  const router = express.Router();
  const actionLimiter = createRateLimiter('notes_action', 30, 60 * 1000);

  // List / Search approved notes
  router.get('/', (req: AuthedRequest, res: Response) => {
    const q = String(req.query.q || '').trim();
    const subject = String(req.query.subject || '').trim();
    const examClass = String(req.query.exam || '').trim();
    const section = String(req.query.section || 'all').trim();

    let where = "n.status = 'approved'";
    const params: unknown[] = [];

    if (q) {
      where += ' AND (n.title LIKE ? OR n.subject LIKE ? OR n.exam_class LIKE ? OR n.description LIKE ? OR n.tags LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    if (subject && subject !== 'All') {
      where += ' AND n.subject = ?';
      params.push(subject);
    }
    if (examClass && examClass !== 'All') {
      where += ' AND n.exam_class LIKE ?';
      params.push(`%${examClass}%`);
    }
    if (section === 'free') where += ' AND n.is_free_sample = 1';
    if (section === 'gemini') where += ' AND n.is_gemini_note = 1';
    if (section === 'pyq') where += ' AND n.is_pyq = 1';

    let orderBy = 'n.created_at DESC';
    if (section === 'trending') orderBy = 'n.sales_count DESC, n.rating_avg DESC';
    if (section === 'top_rated') orderBy = 'n.rating_avg DESC, n.rating_count DESC';

    const rows = db
      .prepare(
        `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT 60`,
      )
      .all(...params) as Array<NoteRow & { uploader_name: string; uploader_avatar: string; uploader_frame: string; uploader_approved_count: number }>;

    // Log non-empty search queries for Admin zero-result analytics
    if (q.length >= 2) {
      db.prepare(
        'INSERT INTO search_logs (id, query, results_count, created_at) VALUES (?, ?, ?, ?)',
      ).run(`sl_${crypto.randomUUID().slice(0, 10)}`, q.toLowerCase().slice(0, 80), rows.length, new Date().toISOString());
    }

    const userId = req.user?.id;
    const bookmarkedIds = userId
      ? new Set(
          (
            db.prepare('SELECT note_id FROM bookmarks WHERE user_id = ?').all(userId) as Array<{ note_id: string }>
          ).map((r) => r.note_id),
        )
      : new Set<string>();

    const unlockedIds = userId
      ? new Set(
          (
            db
              .prepare('SELECT note_id FROM purchases WHERE buyer_id = ? AND refunded = 0')
              .all(userId) as Array<{ note_id: string }>
          ).map((r) => r.note_id),
        )
      : new Set<string>();

    res.json({
      notes: rows.map((r) => ({
        ...formatNoteSummary(r),
        isBookmarked: bookmarkedIds.has(r.id),
        isUnlocked: r.is_free_sample === 1 || r.uploader_id === userId || unlockedIds.has(r.id),
      })),
    });
  });

  // Gemini discounted bundles
  router.get('/bundles', (req: AuthedRequest, res: Response) => {
    const bundles = db
      .prepare('SELECT * FROM gemini_bundles WHERE is_active = 1 ORDER BY created_at DESC')
      .all() as Array<{ id: string; title: string; description: string; bundle_price_coins: number; created_at: string }>;

    const userId = req.user?.id;
    const unlockedIds = userId
      ? new Set(
          (
            db
              .prepare('SELECT note_id FROM purchases WHERE buyer_id = ? AND refunded = 0')
              .all(userId) as Array<{ note_id: string }>
          ).map((r) => r.note_id),
        )
      : new Set<string>();

    const hydrated = bundles.map((b) => {
      const items = db
        .prepare(
          `SELECT n.* FROM notes n
           JOIN gemini_bundle_items bi ON bi.note_id = n.id
           WHERE bi.bundle_id = ?`,
        )
        .all(b.id) as NoteRow[];
      const regularTotal = items.reduce((acc, i) => acc + i.price_coins, 0);
      const allUnlocked = items.length > 0 && items.every((i) => unlockedIds.has(i.id));
      return {
        id: b.id,
        title: b.title,
        description: b.description,
        bundlePriceCoins: b.bundle_price_coins,
        regularTotalCoins: regularTotal,
        savingsCoins: Math.max(0, regularTotal - b.bundle_price_coins),
        allUnlocked,
        notes: items.map((i) => ({ id: i.id, title: i.title, subject: i.subject, priceCoins: i.price_coins })),
      };
    });

    res.json({ bundles: hydrated });
  });

  // Unlock a discounted Gemini Bundle atomically
  router.post('/bundles/:bundleId/unlock', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const bundle = db
      .prepare('SELECT * FROM gemini_bundles WHERE id = ? AND is_active = 1')
      .get(req.params.bundleId) as { id: string; title: string; bundle_price_coins: number } | undefined;
    if (!bundle) {
      res.status(404).json({ error: 'Bundle not found' });
      return;
    }

    const items = db
      .prepare(
        `SELECT n.* FROM notes n
         JOIN gemini_bundle_items bi ON bi.note_id = n.id
         WHERE bi.bundle_id = ?`,
      )
      .all(bundle.id) as NoteRow[];
    if (items.length === 0) {
      res.status(400).json({ error: 'Bundle has no notes' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const freshUser = db
          .prepare('SELECT coins_balance FROM users WHERE id = ?')
          .get(user.id) as { coins_balance: number };
        if (freshUser.coins_balance < bundle.bundle_price_coins) {
          throw new Error('INSUFFICIENT_COINS');
        }

        const missing = items.filter(
          (it) =>
            !db
              .prepare('SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0')
              .get(user.id, it.id),
        );
        if (missing.length === 0) {
          throw new Error('ALREADY_OWNED');
        }

        const now = new Date().toISOString();
        db.prepare('UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?').run(
          bundle.bundle_price_coins,
          user.id,
        );

        for (const it of missing) {
          db.prepare(
            `INSERT INTO purchases (id, buyer_id, note_id, price_coins, uploader_coins, burned_coins, refunded, created_at)
             VALUES (?, ?, ?, ?, 0, ?, 0, ?)
             ON CONFLICT(buyer_id, note_id) DO UPDATE SET refunded = 0`,
          ).run(
            `pur_${crypto.randomUUID().slice(0, 10)}`,
            user.id,
            it.id,
            Math.round(bundle.bundle_price_coins / missing.length),
            Math.round(bundle.bundle_price_coins / missing.length),
            now,
          );
          db.prepare('UPDATE notes SET sales_count = sales_count + 1 WHERE id = ?').run(it.id);
        }

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'bundle_debit', ?, ?, ?, ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          -bundle.bundle_price_coins,
          `Unlocked Gemini Bundle: ${bundle.title}`,
          bundle.id,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'bundle_unlock', 'bundle', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          user.id,
          bundle.id,
          bundle.bundle_price_coins,
          JSON.stringify({ noteIds: missing.map((m) => m.id) }),
          now,
        );

        const updatedBalance = (
          db.prepare('SELECT coins_balance FROM users WHERE id = ?').get(user.id) as { coins_balance: number }
        ).coins_balance;
        return { updatedBalance };
      })();

      const newlyUnlocked = checkAndUnlockAchievements(user.id);
      res.json({ ok: true, coinsBalance: result.updatedBalance, newlyUnlocked });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'INSUFFICIENT_COINS') {
        res.status(400).json({ error: 'Not enough Coins to unlock this bundle' });
        return;
      }
      if (msg === 'ALREADY_OWNED') {
        res.status(400).json({ error: 'You already unlocked all notes in this bundle' });
        return;
      }
      res.status(500).json({ error: 'Could not complete bundle unlock' });
    }
  });

  // My Library & Bookmarks
  router.get('/my/library', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id;
    const purchased = db
      .prepare(
        `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         p.created_at as unlocked_at, p.price_coins as paid_coins,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM purchases p
         JOIN notes n ON n.id = p.note_id
         JOIN users u ON u.id = n.uploader_id
         WHERE p.buyer_id = ? AND p.refunded = 0
         ORDER BY p.created_at DESC`,
      )
      .all(userId) as Array<
      NoteRow & {
        uploader_name: string;
        uploader_avatar: string;
        uploader_frame: string;
        unlocked_at: string;
        paid_coins: number;
        uploader_approved_count: number;
      }
    >;

    const bookmarks = db
      .prepare(
        `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM bookmarks b
         JOIN notes n ON n.id = b.note_id
         JOIN users u ON u.id = n.uploader_id
         WHERE b.user_id = ? AND n.status = 'approved'
         ORDER BY b.created_at DESC`,
      )
      .all(userId) as Array<
      NoteRow & {
        uploader_name: string;
        uploader_avatar: string;
        uploader_frame: string;
        uploader_approved_count: number;
      }
    >;

    res.json({
      library: purchased.map((r) => ({
        ...formatNoteSummary(r),
        unlockedAt: r.unlocked_at,
        paidCoins: r.paid_coins,
        isUnlocked: true,
      })),
      bookmarks: bookmarks.map((r) => ({
        ...formatNoteSummary(r),
        isBookmarked: true,
      })),
    });
  });

  // My Uploads + stats
  router.get('/my/uploads', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id;
    const rows = db
      .prepare(
        `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE n.uploader_id = ?
         ORDER BY n.created_at DESC`,
      )
      .all(userId) as Array<
      NoteRow & {
        uploader_name: string;
        uploader_avatar: string;
        uploader_frame: string;
        uploader_approved_count: number;
      }
    >;

    const totalSales = rows.reduce((a, r) => a + r.sales_count, 0);
    const totalEarnedCoins = rows.reduce((a, r) => a + r.total_earned_coins + r.upload_reward_coins, 0);

    res.json({
      uploads: rows.map((r) => ({ ...formatNoteSummary(r), isUnlocked: true })),
      stats: { totalUploads: rows.length, totalSales, totalEarnedCoins },
    });
  });

  // Public blurred preview SVG (never exposes private note content)
  router.get('/:id/preview', (req, res: Response) => {
    const note = db.prepare('SELECT id, title, subject, page_count FROM notes WHERE id = ?').get(req.params.id) as
      | { id: string; title: string; subject: string; page_count: number }
      | undefined;
    if (!note) {
      res.status(404).send('Not found');
      return;
    }
    const svg = renderBlurredPreviewSvg(note.title, note.subject, note.page_count);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  });

  // Note detail page
  router.get('/:id', (req: AuthedRequest, res: Response) => {
    const note = db
      .prepare(
        `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE n.id = ?`,
      )
      .get(req.params.id) as
      | (NoteRow & {
          uploader_name: string;
          uploader_avatar: string;
          uploader_frame: string;
          uploader_approved_count: number;
        })
      | undefined;

    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'admin';
    if (note.status !== 'approved' && note.uploader_id !== userId && !isAdmin) {
      res.status(404).json({ error: 'Note is unavailable or pending review' });
      return;
    }

    const unlocked = userHasFullAccess(userId, note);
    const purchase = userId
      ? (db
          .prepare('SELECT id, created_at, price_coins FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0')
          .get(userId, note.id) as { id: string; created_at: string; price_coins: number } | undefined)
      : undefined;

    const existingRefund = purchase
      ? (db
          .prepare('SELECT id, status FROM refund_requests WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(purchase.id) as { id: string; status: string } | undefined)
      : undefined;

    const canRequestRefund = Boolean(
      purchase &&
        purchase.price_coins > 0 &&
        !existingRefund &&
        isWithinRefundWindow(purchase.created_at),
    );

    const isBookmarked = userId
      ? Boolean(db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND note_id = ?').get(userId, note.id))
      : false;
    const isFollowingUploader = userId
      ? Boolean(
          db
            .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
            .get(userId, note.uploader_id),
        )
      : false;

    const reviews = db
      .prepare(
        `SELECT r.id, r.rating, r.comment, r.created_at, u.name as buyer_name, u.equipped_avatar as buyer_avatar
         FROM reviews r
         JOIN users u ON u.id = r.buyer_id
         WHERE r.note_id = ?
         ORDER BY r.created_at DESC`,
      )
      .all(note.id) as Array<{
      id: string;
      rating: number;
      comment: string;
      created_at: string;
      buyer_name: string;
      buyer_avatar: string;
    }>;

    const hasReviewed = userId
      ? Boolean(db.prepare('SELECT 1 FROM reviews WHERE note_id = ? AND buyer_id = ?').get(note.id, userId))
      : false;

    res.json({
      note: {
        ...formatNoteSummary(note),
        isUnlocked: unlocked,
        isBookmarked,
        isFollowingUploader,
        canReview: Boolean(purchase && !hasReviewed),
        canRequestRefund,
        refundStatus: existingRefund?.status || null,
        hasPreviewPages: note.preview_pages_count > 0,
      },
      reviews: reviews.map((rv) => ({
        id: rv.id,
        rating: rv.rating,
        comment: rv.comment,
        createdAt: rv.created_at,
        buyerName: rv.buyer_name,
        buyerAvatar: rv.buyer_avatar,
      })),
    });
  });

  // Issue short-lived signed viewer URLs (supports Gemini 1-2 free preview pages before unlock, or full pack after unlock)
  router.get('/:id/viewer-urls', (req: AuthedRequest, res: Response) => {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as NoteRow | undefined;
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    const userId = req.user?.id || 'guest';
    const fullAccess = userHasFullAccess(req.user?.id, note);
    const allowedPages = fullAccess ? note.page_count : note.preview_pages_count;

    if (allowedPages <= 0) {
      res.status(403).json({ error: 'Unlock this note with Coins to view pages' });
      return;
    }

    const exp = Math.floor(Date.now() / 1000) + 5 * 60; // 5-minute short-lived URL
    const token = signViewerToken({ noteId: note.id, userId, exp }, SERVER_SECRET);

    const pages: Array<{ page: number; url: string; isPreviewOnly: boolean }> = [];
    for (let p = 1; p <= allowedPages; p++) {
      pages.push({
        page: p,
        url: `/api/notes/${note.id}/page/${p}?token=${encodeURIComponent(token)}`,
        isPreviewOnly: !fullAccess,
      });
    }

    res.json({
      fullAccess,
      totalPages: note.page_count,
      allowedPages,
      fileType: note.file_type,
      watermarkLabel: req.user ? `${req.user.name} · NoteSwap` : 'Free Preview · NoteSwap',
      pages,
    });
  });

  // Protected private page endpoint (verifies short-lived signed HMAC token on every request)
  router.get('/:id/page/:page', (req, res: Response) => {
    const token = String(req.query.token || '');
    const verified = verifyViewerToken(token, SERVER_SECRET);
    if (!verified || verified.noteId !== req.params.id) {
      res.status(403).json({ error: 'Viewer link expired or invalid' });
      return;
    }

    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as NoteRow | undefined;
    if (!note) {
      res.status(404).send('Not found');
      return;
    }

    const pageNum = Number(req.params.page);
    const fullAccess =
      verified.userId !== 'guest' ? userHasFullAccess(verified.userId, note) : note.is_free_sample === 1;
    const maxAllowed = fullAccess ? note.page_count : note.preview_pages_count;

    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > maxAllowed) {
      res.status(403).send('Page locked');
      return;
    }

    const userRow =
      verified.userId !== 'guest'
        ? (db.prepare('SELECT name FROM users WHERE id = ?').get(verified.userId) as { name: string } | undefined)
        : undefined;
    const watermarkText = userRow
      ? `${userRow.name} · ${new Date().toISOString().slice(0, 10)}`
      : 'NoteSwap Free Preview';

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const safePath = resolveSafePrivatePath(note.file_path);

    if (note.file_type === 'structured') {
      const pages = JSON.parse(fs.readFileSync(safePath, 'utf8')) as StructuredPage[];
      const pageData = pages[pageNum - 1];
      if (!pageData) {
        res.status(404).send('Page not found');
        return;
      }
      const svg = renderStructuredPageSvg(
        note.title,
        note.subject,
        pageNum,
        note.page_count,
        pageData,
        watermarkText,
      );
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
      return;
    }

    if (note.file_type === 'image') {
      const files = JSON.parse(fs.readFileSync(safePath, 'utf8')) as string[];
      const targetRel = files[pageNum - 1];
      if (!targetRel) {
        res.status(404).send('Page image not found');
        return;
      }
      const imgPath = resolveSafePrivatePath(targetRel);
      const ext = path.extname(imgPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline');
      fs.createReadStream(imgPath).pipe(res);
      return;
    }

    if (note.file_type === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="protected-note.pdf"');
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    res.status(400).send('Unsupported note format');
  });

  // Upload Note (PDF or images) with SHA-256 duplicate detection and copyright checkbox
  router.post(
    '/upload',
    requireAuth,
    actionLimiter,
    upload.array('files', 10),
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      if (user.role !== 'student') {
        res.status(403).json({ error: 'Only student accounts can upload study notes.' });
        return;
      }

      const title = String(req.body?.title || '').trim();
      const subject = String(req.body?.subject || '').trim();
      const examClass = String(req.body?.examClass || '').trim();
      const description = String(req.body?.description || '').trim();
      const tagsRaw = String(req.body?.tags || '').trim();
      const copyrightDeclared = req.body?.copyrightDeclared === 'true' || req.body?.copyrightDeclared === true;

      if (title.length < 4 || title.length > 120) {
        res.status(400).json({ error: 'Title must be between 4 and 120 characters' });
        return;
      }
      if (!subject || !examClass || description.length < 15) {
        res.status(400).json({ error: 'Subject, class/exam, and description (15+ chars) are required' });
        return;
      }
      if (!copyrightDeclared) {
        res.status(400).json({ error: 'You must confirm the copyright declaration checkbox' });
        return;
      }

      const priceCoins = parsePositiveIntCoins(req.body?.priceCoins);
      if (priceCoins === null) {
        res.status(400).json({ error: 'Enter a valid whole-number Coin price' });
        return;
      }
      const priceErr = validateNoteUploadPriceCoins(priceCoins);
      if (priceErr) {
        res.status(400).json({ error: priceErr });
        return;
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Attach at least 1 PDF or image file' });
        return;
      }

      // Compute combined SHA-256 hash to prevent duplicate uploads
      const combinedBuffer = Buffer.concat(files.map((f) => f.buffer));
      const fileHash = computeSha256(combinedBuffer);
      const duplicate = db.prepare('SELECT id, title FROM notes WHERE file_hash = ?').get(fileHash) as
        | { id: string; title: string }
        | undefined;
      if (duplicate) {
        res.status(409).json({
          error: `Duplicate file detected: this content already exists ("${duplicate.title}").`,
        });
        return;
      }

      const isPdf = files[0].mimetype === 'application/pdf';
      if (isPdf && files.length > 1) {
        res.status(400).json({ error: 'Upload a single PDF or up to 10 page images' });
        return;
      }
      const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
      if (!isPdf && files.some((f) => !allowedImageTypes.has(f.mimetype))) {
        res.status(400).json({ error: 'Only PDF, PNG, JPG, or WebP files are accepted' });
        return;
      }

      const noteId = `note_${crypto.randomUUID().slice(0, 10)}`;
      const baseDir = ensurePrivateStorageDir();
      const noteDir = path.join(baseDir, noteId);
      fs.mkdirSync(noteDir, { recursive: true });

      let fileType = 'image';
      let relFilePath = '';
      let pageCount = files.length;

      if (isPdf) {
        fileType = 'pdf';
        fs.writeFileSync(path.join(noteDir, 'document.pdf'), files[0].buffer);
        relFilePath = `${noteId}/document.pdf`;
        const pdfText = files[0].buffer.toString('latin1');
        const matches = pdfText.match(/\/Type\s*\/Page\b(?!s)/g);
        pageCount = Math.max(1, matches ? matches.length : Number(req.body?.pageCount || 1));
      } else {
        const savedImages: string[] = [];
        files.forEach((f, idx) => {
          const ext = f.mimetype === 'image/png' ? '.png' : f.mimetype === 'image/webp' ? '.webp' : '.jpg';
          const fname = `page_${idx + 1}${ext}`;
          fs.writeFileSync(path.join(noteDir, fname), f.buffer);
          savedImages.push(`${noteId}/${fname}`);
        });
        fs.writeFileSync(path.join(noteDir, 'images.json'), JSON.stringify(savedImages));
        relFilePath = `${noteId}/images.json`;
        pageCount = savedImages.length;
      }

      const tags = tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 6);

      const status = 'pending';
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO notes (
          id, uploader_id, title, subject, exam_class, description, tags,
          price_coins, is_free_sample, is_gemini_note, is_pyq, pyq_year, preview_pages_count,
          page_count, file_type, file_path, file_hash, status, copyright_declared, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, '', 0, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(
        noteId,
        user.id,
        title,
        subject,
        examClass,
        description,
        JSON.stringify(tags),
        priceCoins,
        pageCount,
        fileType,
        relFilePath,
        fileHash,
        status,
        now,
      );

      res.status(201).json({
        ok: true,
        noteId,
        status,
        message: 'Submitted for admin review! You will earn up to 🪙2 reward once approved.',
      });
    },
  );

  // Atomic Coin Unlock (50% to uploader, 50% burned from economy + referral + achievement check)
  router.post('/:id/unlock', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const buyer = req.user!;
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id) as NoteRow | undefined;
    if (!note || note.status !== 'approved') {
      res.status(404).json({ error: 'Note not available' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const existing = db
          .prepare('SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0')
          .get(buyer.id, note.id);
        if (existing || note.uploader_id === buyer.id) {
          throw new Error('ALREADY_UNLOCKED');
        }

        const priceCoins = note.is_free_sample ? 0 : note.price_coins;
        const freshBuyer = db
          .prepare('SELECT coins_balance, referred_by, referral_rewarded FROM users WHERE id = ?')
          .get(buyer.id) as {
          coins_balance: number;
          referred_by: string | null;
          referral_rewarded: number;
        };

        if (freshBuyer.coins_balance < priceCoins) {
          throw new Error('INSUFFICIENT_COINS');
        }

        const now = new Date().toISOString();
        const isOfficial = note.is_gemini_note === 1 || note.is_pyq === 1;
        const split = calculateCoinUnlockSplit(priceCoins);
        const uploaderShare = isOfficial ? 0 : split.uploaderCoins;
        const burned = priceCoins - uploaderShare;

        if (priceCoins > 0) {
          db.prepare('UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?').run(priceCoins, buyer.id);
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'spent', 'unlock_debit', ?, ?, ?, ?)`,
          ).run(
            `tx_${crypto.randomUUID().slice(0, 10)}`,
            buyer.id,
            -priceCoins,
            `Unlocked "${note.title}"`,
            note.id,
            now,
          );
        }

        if (uploaderShare > 0) {
          db.prepare(
            'UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?',
          ).run(uploaderShare, uploaderShare, note.uploader_id);

          db.prepare('UPDATE notes SET total_earned_coins = total_earned_coins + ? WHERE id = ?').run(
            uploaderShare,
            note.id,
          );

          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'sale_credit', ?, ?, ?, ?)`,
          ).run(
            `tx_${crypto.randomUUID().slice(0, 10)}`,
            note.uploader_id,
            uploaderShare,
            `${buyer.name} unlocked "${note.title}"`,
            note.id,
            now,
          );

          db.prepare(
            `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
             VALUES (?, ?, 'Note Unlocked!', ?, 0, ?)`,
          ).run(
            `ntf_${crypto.randomUUID().slice(0, 10)}`,
            note.uploader_id,
            `${buyer.name} unlocked "${note.title}" — you earned +🪙${uploaderShare}!`,
            now,
          );
        }

        if (burned > 0) {
          const prevBurn = Number(
            (db.prepare("SELECT value FROM app_settings WHERE key = 'coins_burned_total'").get() as { value: string } | undefined)?.value || 0,
          );
          db.prepare(
            "INSERT INTO app_settings (key, value) VALUES ('coins_burned_total', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          ).run(String(prevBurn + burned));
        }

        db.prepare('UPDATE notes SET sales_count = sales_count + 1 WHERE id = ?').run(note.id);

        db.prepare(
          `INSERT INTO purchases (id, buyer_id, note_id, price_coins, uploader_coins, burned_coins, refunded, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(buyer_id, note_id) DO UPDATE SET refunded = 0, created_at = excluded.created_at`,
        ).run(
          `pur_${crypto.randomUUID().slice(0, 10)}`,
          buyer.id,
          note.id,
          priceCoins,
          uploaderShare,
          burned,
          now,
        );

        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'note_unlock', 'note', ?, ?, ?, ?)`,
        ).run(
          `aud_${crypto.randomUUID().slice(0, 10)}`,
          buyer.id,
          note.id,
          priceCoins,
          JSON.stringify({ uploaderShare, burned }),
          now,
        );

        // Referral reward: both get +5 Coins after friend's first paid unlock
        let referralCredited = false;
        if (priceCoins > 0 && freshBuyer.referred_by && freshBuyer.referral_rewarded === 0) {
          db.prepare(
            'UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ?, referral_rewarded = 1 WHERE id = ?',
          ).run(REFERRAL_BONUS_COINS, REFERRAL_BONUS_COINS, buyer.id);

          db.prepare(
            'UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?',
          ).run(REFERRAL_BONUS_COINS, REFERRAL_BONUS_COINS, freshBuyer.referred_by);

          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'referral_bonus', ?, 'Referral bonus on first unlock', ?, ?)`,
          ).run(`tx_${crypto.randomUUID().slice(0, 10)}`, buyer.id, REFERRAL_BONUS_COINS, freshBuyer.referred_by, now);

          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'referral_bonus', ?, ?, ?, ?)`,
          ).run(
            `tx_${crypto.randomUUID().slice(0, 10)}`,
            freshBuyer.referred_by,
            REFERRAL_BONUS_COINS,
            `Referral bonus: ${buyer.name} unlocked their first note`,
            buyer.id,
            now,
          );

          db.prepare(
            `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
             VALUES (?, ?, 'Referral Bonus!', ?, 0, ?)`,
          ).run(
            `ntf_${crypto.randomUUID().slice(0, 10)}`,
            freshBuyer.referred_by,
            `${buyer.name} completed their first unlock! You earned +🪙${REFERRAL_BONUS_COINS}.`,
            now,
          );
          referralCredited = true;
        }

        const updatedBalance = (
          db.prepare('SELECT coins_balance FROM users WHERE id = ?').get(buyer.id) as { coins_balance: number }
        ).coins_balance;

        return { updatedBalance, priceCoins, uploaderShare, burned, referralCredited };
      })();

      const newlyUnlocked = checkAndUnlockAchievements(buyer.id);
      checkAndUnlockAchievements(note.uploader_id);

      res.json({
        ok: true,
        coinsBalance: result.updatedBalance,
        spentCoins: result.priceCoins,
        referralCredited: result.referralCredited,
        newlyUnlocked,
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'ALREADY_UNLOCKED') {
        res.status(400).json({ error: 'You already have access to this note' });
        return;
      }
      if (msg === 'INSUFFICIENT_COINS') {
        res.status(400).json({ error: 'Not enough Coins. Claim your daily streak, spin the wheel, or redeem a code!' });
        return;
      }
      res.status(500).json({ error: 'Unlock transaction failed' });
    }
  });

  // Buyer-only ratings & reviews
  router.post('/:id/reviews', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const buyer = req.user!;
    const noteId = req.params.id;
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim().slice(0, 500);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'Rating must be between 1 and 5 stars' });
      return;
    }
    if (comment.length < 4) {
      res.status(400).json({ error: 'Please write a short review (at least 4 characters)' });
      return;
    }

    const purchase = db
      .prepare('SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0')
      .get(buyer.id, noteId);
    if (!purchase) {
      res.status(403).json({ error: 'Only verified buyers can review this note' });
      return;
    }

    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO reviews (id, note_id, buyer_id, rating, comment, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(`rev_${crypto.randomUUID().slice(0, 10)}`, noteId, buyer.id, rating, comment, new Date().toISOString());

        const stats = db
          .prepare('SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE note_id = ?')
          .get(noteId) as { avg_rating: number; cnt: number };

        db.prepare('UPDATE notes SET rating_avg = ?, rating_count = ? WHERE id = ?').run(
          stats.avg_rating || 0,
          stats.cnt || 0,
          noteId,
        );
      })();
      res.status(201).json({ ok: true });
    } catch {
      res.status(409).json({ error: 'You have already reviewed this note' });
    }
  });

  // Toggle Bookmark / Wishlist
  router.post('/:id/bookmark', requireAuth, (req: AuthedRequest, res: Response) => {
    const userId = req.user!.id;
    const noteId = req.params.id;
    const existing = db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND note_id = ?').get(userId, noteId);
    if (existing) {
      db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND note_id = ?').run(userId, noteId);
      res.json({ bookmarked: false });
    } else {
      db.prepare('INSERT INTO bookmarks (user_id, note_id, created_at) VALUES (?, ?, ?)').run(
        userId,
        noteId,
        new Date().toISOString(),
      );
      res.json({ bookmarked: true });
    }
  });

  // Report a note (auto-hides after 3 unique reports)
  router.post('/:id/report', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const noteId = req.params.id;
    const reason = String(req.body?.reason || '').trim();
    const details = String(req.body?.details || '').trim().slice(0, 400);

    if (!['copyright', 'spam', 'wrong_content'].includes(reason)) {
      res.status(400).json({ error: 'Choose copyright, spam, or wrong_content' });
      return;
    }

    try {
      let autoHidden = false;
      db.transaction(() => {
        db.prepare(
          `INSERT INTO reports (id, note_id, reporter_id, reason, details, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        ).run(`rep_${crypto.randomUUID().slice(0, 10)}`, noteId, user.id, reason, details, new Date().toISOString());

        db.prepare('UPDATE notes SET report_count = report_count + 1 WHERE id = ?').run(noteId);
        const noteRow = db.prepare('SELECT report_count FROM notes WHERE id = ?').get(noteId) as
          | { report_count: number }
          | undefined;
        if (noteRow && noteRow.report_count >= AUTO_HIDE_REPORT_THRESHOLD) {
          db.prepare("UPDATE notes SET status = 'hidden_review' WHERE id = ?").run(noteId);
          autoHidden = true;
        }
      })();
      res.json({ ok: true, autoHidden });
    } catch {
      res.status(409).json({ error: 'You already reported this note' });
    }
  });

  // Request Coin Refund within 24 hours if note is wrong/unreadable
  router.post('/:id/refund', requireAuth, actionLimiter, (req: AuthedRequest, res: Response) => {
    const buyer = req.user!;
    const noteId = req.params.id;
    const reason = String(req.body?.reason || '').trim().slice(0, 400);
    if (reason.length < 8) {
      res.status(400).json({ error: 'Explain why the note is wrong or unreadable (8+ characters)' });
      return;
    }

    const purchase = db
      .prepare('SELECT * FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0')
      .get(buyer.id, noteId) as
      | { id: string; price_coins: number; created_at: string }
      | undefined;

    if (!purchase || purchase.price_coins <= 0) {
      res.status(400).json({ error: 'No eligible paid unlock found for this note' });
      return;
    }
    if (!isWithinRefundWindow(purchase.created_at)) {
      res.status(400).json({ error: 'Coin refund requests must be submitted within 24 hours of unlocking' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM refund_requests WHERE purchase_id = ?')
      .get(purchase.id);
    if (existing) {
      res.status(409).json({ error: 'A refund request for this unlock already exists' });
      return;
    }

    db.prepare(
      `INSERT INTO refund_requests (id, purchase_id, note_id, buyer_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(`rfd_${crypto.randomUUID().slice(0, 10)}`, purchase.id, noteId, buyer.id, reason, new Date().toISOString());

    res.status(201).json({ ok: true, message: 'Coin refund request sent to admin for review.' });
  });

  return router;
}
