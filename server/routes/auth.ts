import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { getApp, getApps, initializeApp, type App as FirebaseAdminApp } from 'firebase-admin/app';
import { getAuth as getFirebaseAdminAuth } from 'firebase-admin/auth';
import { ACHIEVEMENTS } from '../achievements';
import { db } from '../db';
import {
  calculateExamCountdownDays,
  generateReferralCode,
  getCreatorLevel,
  normalizeCode,
  REFERRAL_BONUS_COINS,
  WELCOME_BONUS_COINS,
} from '../domain';
import {
  clearSessionCookie,
  createRateLimiter,
  hashOtp,
  hashPassword,
  parseCookieToken,
  setSessionCookie,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
} from '../security';

export interface AuthUser {
  id: string;
  google_id: string | null;
  auth_provider: string;
  name: string;
  email: string;
  role: string;
  is_minor: number;
  is_chat_muted: number;
  device_id: string;
  coins_balance: number;
  coins_earned_total: number;
  streak_days: number;
  last_streak_date: string | null;
  last_spin_at: string | null;
  equipped_theme: string;
  equipped_avatar: string;
  equipped_frame: string;
  referral_code: string;
  is_banned: number;
  created_at: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function attachOptionalUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : null;
  const cookieToken = parseCookieToken(req);
  const token = bearer || cookieToken;
  if (token) {
    const parsed = verifySessionToken(token);
    if (parsed) {
      const user = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(parsed.uid) as AuthUser | undefined;
      if (user && !user.is_banned) {
        req.user = user;
      }
    }
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Please sign in to continue' });
    return;
  }
  if (req.user.is_banned) {
    res.status(403).json({ error: 'Your account has been suspended' });
    return;
  }
  next();
}

export function requireGoogleAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Firebase or Google sign-in is required' });
    return;
  }
  if (!['google', 'firebase_email'].includes(req.user.auth_provider)) {
    res.status(403).json({ error: 'Live Chat requires Google or Firebase Email sign-in' });
    return;
  }
  next();
}

function getFirebaseAdminApp(): FirebaseAdminApp | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { projectId?: string };
    if (!cfg.projectId || cfg.projectId === 'remixed-project-id') return null;
    return getApps().length ? getApp() : initializeApp({ projectId: cfg.projectId });
  } catch {
    return null;
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Admin sign-in required' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin privileges required' });
    return;
  }
  next();
}

function serializeProfile(user: AuthUser) {
  const approvedUploads = (
    db
      .prepare("SELECT COUNT(*) as c FROM notes WHERE uploader_id = ? AND status = 'approved'")
      .get(user.id) as { c: number }
  ).c;
  const levelInfo = getCreatorLevel(approvedUploads);

  const unlockedAchievements = (
    db
      .prepare('SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = ?')
      .all(user.id) as Array<{ achievement_key: string; unlocked_at: string }>
  ).map((row) => ({
    ...row,
    ...(ACHIEVEMENTS.find((a) => a.key === row.achievement_key) || {}),
  }));

  const ownedItems = (
    db
      .prepare(
        `SELECT s.* FROM shop_items s
         JOIN user_inventory ui ON ui.item_id = s.id
         WHERE ui.user_id = ?`,
      )
      .all(user.id) as Array<{ id: string; kind: string; key: string; name: string; preview_value: string }>
  );

  const unreadNotifications = (
    db
      .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(user.id) as { c: number }
  ).c;

  const exam = db
    .prepare('SELECT exam_name, exam_date, reminder_days FROM user_exams WHERE user_id = ?')
    .get(user.id) as { exam_name: string; exam_date: string; reminder_days: number } | undefined;

  const todayStr = new Date().toISOString().slice(0, 10);
  const examCountdown = exam
    ? {
        ...exam,
        daysLeft: calculateExamCountdownDays(exam.exam_date, todayStr),
      }
    : null;

  const pendingDmRequests = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM dm_threads
         WHERE (user_a = ? OR user_b = ?) AND requester_id != ? AND status = 'pending'`,
      )
      .get(user.id, user.id, user.id) as { c: number }
  ).c;

  const completedUnlocks = (
    db
      .prepare('SELECT COUNT(*) as c FROM purchases WHERE buyer_id = ? AND refunded = 0')
      .get(user.id) as { c: number }
  ).c;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    authProvider: user.auth_provider,
    isMinor: Boolean(user.is_minor),
    isChatMuted: Boolean(user.is_chat_muted),
    coinsBalance: user.coins_balance,
    coinsEarnedTotal: user.coins_earned_total,
    streakDays: user.streak_days,
    lastStreakDate: user.last_streak_date,
    lastSpinAt: user.last_spin_at,
    equippedTheme: user.equipped_theme,
    equippedAvatar: user.equipped_avatar,
    equippedFrame: user.equipped_frame,
    referralCode: user.referral_code,
    approvedUploads,
    level: levelInfo.level,
    nextLevelTarget: levelInfo.nextTarget,
    achievements: unlockedAchievements,
    ownedItems,
    unreadNotifications,
    pendingDmRequests,
    examCountdown,
    completedUnlocks,
    createdAt: user.created_at,
  };
}

export function createAuthRouter(): express.Router {
  const router = express.Router();
  const otpLimiter = createRateLimiter('otp', 10, 10 * 60 * 1000);
  const authLimiter = createRateLimiter('auth', 20, 10 * 60 * 1000);

  router.get('/me', (req: AuthedRequest, res: Response) => {
    const passcodeSet = Boolean(process.env.ADMIN_PASSCODE?.trim());
    const claimedHash = db
      .prepare("SELECT value FROM app_settings WHERE key = 'admin_passcode_hash'")
      .get() as { value: string } | undefined;

    const adminApp = getFirebaseAdminApp();
    res.json({
      user: req.user ? serializeProfile(req.user) : null,
      googleConfigured: Boolean(adminApp || process.env.GOOGLE_CLIENT_ID?.trim()),
      firebaseConfigured: Boolean(adminApp),
      adminSetupRequired: !passcodeSet && !claimedHash,
    });
  });

  // Real Firebase Auth ID Token verification (Google Sign-In & Email/Password Sign-In)
  router.post('/firebase', authLimiter, async (req: AuthedRequest, res: Response) => {
    const { idToken, displayName, referralCode, isMinor } = req.body || {};
    if (typeof idToken !== 'string' || idToken.length < 20) {
      res.status(400).json({ error: 'Valid Firebase ID token is required' });
      return;
    }

    const adminApp = getFirebaseAdminApp();
    if (!adminApp) {
      res.status(503).json({ error: 'Firebase project is not configured on the server yet' });
      return;
    }

    let decoded;
    try {
      decoded = await getFirebaseAdminAuth(adminApp).verifyIdToken(idToken);
    } catch (err) {
      res.status(401).json({
        error: `Firebase authentication failed: ${(err as Error).message || 'Invalid token'}`,
      });
      return;
    }

    const verifiedEmail = String(decoded.email || '').trim().toLowerCase();
    if (!verifiedEmail) {
      res.status(400).json({ error: 'Firebase account must include a valid email address' });
      return;
    }

    const signInProvider = decoded.firebase?.sign_in_provider || '';
    const authProvider = signInProvider === 'google.com' ? 'google' : 'firebase_email';
    const verifiedUid = decoded.uid;
    const resolvedName =
      typeof displayName === 'string' && displayName.trim().length >= 2
        ? displayName.trim().slice(0, 48)
        : typeof decoded.name === 'string' && decoded.name.trim().length >= 2
          ? decoded.name.trim().slice(0, 48)
          : verifiedEmail.split('@')[0];

    const deviceId = String(req.headers['x-device-id'] || '').slice(0, 64);

    const existing = db
      .prepare('SELECT * FROM users WHERE google_id = ? OR email = ?')
      .get(verifiedUid, verifiedEmail) as AuthUser | undefined;

    if (existing) {
      if (existing.is_banned) {
        res.status(403).json({ error: 'This account has been suspended' });
        return;
      }
      db.prepare('UPDATE users SET google_id = ?, auth_provider = ? WHERE id = ?').run(
        verifiedUid,
        authProvider,
        existing.id,
      );
      if (deviceId && !existing.device_id) {
        db.prepare('UPDATE users SET device_id = ? WHERE id = ?').run(deviceId, existing.id);
      }
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as AuthUser;
      const token = signSessionToken({
        uid: refreshed.id,
        role: refreshed.role,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      });
      setSessionCookie(req, res, token);
      res.json({ user: serializeProfile(refreshed), isNewUser: false });
      return;
    }

    const newUserId = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const refCode = generateReferralCode(resolvedName, newUserId.slice(-4));
    const cleanReferredBy =
      typeof referralCode === 'string' && referralCode.trim()
        ? normalizeCode(referralCode)
        : null;

    let referrerId: string | null = null;
    if (cleanReferredBy) {
      const refUser = db
        .prepare('SELECT id FROM users WHERE referral_code = ?')
        .get(cleanReferredBy) as { id: string } | undefined;
      if (refUser) referrerId = refUser.id;
    }

    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (
          id, google_id, auth_provider, name, email, role, is_minor, device_id,
          coins_balance, coins_earned_total, referral_code, referred_by, created_at
        ) VALUES (?, ?, ?, ?, ?, 'student', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newUserId,
        verifiedUid,
        authProvider,
        resolvedName,
        verifiedEmail,
        isMinor ? 1 : 0,
        deviceId,
        WELCOME_BONUS_COINS,
        WELCOME_BONUS_COINS,
        refCode,
        referrerId,
        now,
      );

      db.prepare(
        `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
         VALUES (?, ?, 'earned', 'welcome_bonus', ?, ?, 'firebase_signup', ?)`,
      ).run(
        `tx_${crypto.randomUUID().slice(0, 10)}`,
        newUserId,
        WELCOME_BONUS_COINS,
        `Welcome bonus (+${WELCOME_BONUS_COINS} Coins on first Firebase sign-in)`,
        now,
      );

      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
         VALUES (?, ?, 'welcome_bonus', 'user', ?, ?, ?, ?)`,
      ).run(
        `aud_${crypto.randomUUID().slice(0, 10)}`,
        newUserId,
        newUserId,
        WELCOME_BONUS_COINS,
        JSON.stringify({ email: verifiedEmail, provider: authProvider, referredBy: referrerId }),
        now,
      );

      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      ).run(
        `ntf_${crypto.randomUUID().slice(0, 10)}`,
        newUserId,
        'Welcome to NoteSwap!',
        `You received 🪙${WELCOME_BONUS_COINS} welcome bonus on first sign-in. Upload notes or unlock study packs!`,
        now,
      );
    })();

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId) as AuthUser;
    const token = signSessionToken({
      uid: created.id,
      role: created.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });
    setSessionCookie(req, res, token);
    res.status(201).json({ user: serializeProfile(created), isNewUser: true, welcomeCoins: WELCOME_BONUS_COINS });
  });

  // Main Google Login (1 account per Google ID; awards 10 Coin welcome bonus on first login)
  router.post('/google', authLimiter, async (req: AuthedRequest, res: Response) => {
    const { idToken, googleId, email, name, referralCode, isMinor } = req.body || {};
    const deviceId = String(req.headers['x-device-id'] || '').slice(0, 64);

    let verifiedGoogleId = '';
    let verifiedEmail = '';
    let verifiedName = '';

    const configuredClientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (configuredClientId && typeof idToken === 'string' && idToken.length > 20) {
      try {
        const resp = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        );
        if (!resp.ok) {
          res.status(401).json({ error: 'Invalid Google token' });
          return;
        }
        const info = (await resp.json()) as {
          aud?: string;
          sub?: string;
          email?: string;
          name?: string;
        };
        if (info.aud !== configuredClientId || !info.sub || !info.email) {
          res.status(401).json({ error: 'Google token audience mismatch' });
          return;
        }
        verifiedGoogleId = info.sub;
        verifiedEmail = info.email.toLowerCase();
        verifiedName = info.name || info.email.split('@')[0];
      } catch {
        res.status(502).json({ error: 'Unable to verify Google token right now' });
        return;
      }
    } else {
      // Test Mode Google Sign-In when GOOGLE_CLIENT_ID is not configured
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        res.status(400).json({ error: 'Valid Google email is required' });
        return;
      }
      verifiedEmail = email.trim().toLowerCase();
      verifiedGoogleId =
        typeof googleId === 'string' && googleId.trim()
          ? googleId.trim().slice(0, 80)
          : `google_${crypto.createHash('sha256').update(verifiedEmail).digest('hex').slice(0, 16)}`;
      verifiedName =
        typeof name === 'string' && name.trim().length >= 2
          ? name.trim().slice(0, 48)
          : verifiedEmail.split('@')[0];
    }

    const existing = db
      .prepare('SELECT * FROM users WHERE google_id = ? OR email = ?')
      .get(verifiedGoogleId, verifiedEmail) as AuthUser | undefined;

    if (existing) {
      if (existing.is_banned) {
        res.status(403).json({ error: 'This account has been suspended' });
        return;
      }
      if (!existing.google_id) {
        db.prepare("UPDATE users SET google_id = ?, auth_provider = 'google' WHERE id = ?").run(
          verifiedGoogleId,
          existing.id,
        );
      }
      if (deviceId && !existing.device_id) {
        db.prepare('UPDATE users SET device_id = ? WHERE id = ?').run(deviceId, existing.id);
      }
      const refreshed = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as AuthUser;
      const token = signSessionToken({
        uid: refreshed.id,
        role: refreshed.role,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      });
      setSessionCookie(req, res, token);
      res.json({ user: serializeProfile(refreshed), isNewUser: false });
      return;
    }

    // Create new user atomically with 10 Coin welcome bonus
    const newUserId = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const refCode = generateReferralCode(verifiedName, newUserId.slice(-4));
    const cleanReferredBy =
      typeof referralCode === 'string' && referralCode.trim()
        ? normalizeCode(referralCode)
        : null;

    let referrerId: string | null = null;
    if (cleanReferredBy) {
      const refUser = db
        .prepare('SELECT id FROM users WHERE referral_code = ?')
        .get(cleanReferredBy) as { id: string } | undefined;
      if (refUser) referrerId = refUser.id;
    }

    const createTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (
          id, google_id, auth_provider, name, email, role, is_minor, device_id,
          coins_balance, coins_earned_total, referral_code, referred_by, created_at
        ) VALUES (?, ?, 'google', ?, ?, 'student', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newUserId,
        verifiedGoogleId,
        verifiedName,
        verifiedEmail,
        isMinor ? 1 : 0,
        deviceId,
        WELCOME_BONUS_COINS,
        WELCOME_BONUS_COINS,
        refCode,
        referrerId,
        now,
      );

      db.prepare(
        `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
         VALUES (?, ?, 'earned', 'welcome_bonus', ?, ?, 'google_signup', ?)`,
      ).run(
        `tx_${crypto.randomUUID().slice(0, 10)}`,
        newUserId,
        WELCOME_BONUS_COINS,
        `Welcome bonus (+${WELCOME_BONUS_COINS} Coins on first Google login)`,
        now,
      );

      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
         VALUES (?, ?, 'welcome_bonus', 'user', ?, ?, ?, ?)`,
      ).run(
        `aud_${crypto.randomUUID().slice(0, 10)}`,
        newUserId,
        newUserId,
        WELCOME_BONUS_COINS,
        JSON.stringify({ email: verifiedEmail, referredBy: referrerId }),
        now,
      );

      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      ).run(
        `ntf_${crypto.randomUUID().slice(0, 10)}`,
        newUserId,
        'Welcome to NoteSwap!',
        referrerId
          ? `You received 🪙${WELCOME_BONUS_COINS} welcome bonus! Unlock your first note to earn 🪙${REFERRAL_BONUS_COINS} referral Coins for both you and your friend.`
          : `You received 🪙${WELCOME_BONUS_COINS} welcome bonus on first Google login. Check out Free Sample notes to start!`,
        now,
      );
    });

    createTx();

    const created = db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId) as AuthUser;
    const token = signSessionToken({
      uid: created.id,
      role: created.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });
    setSessionCookie(req, res, token);
    res.status(201).json({ user: serializeProfile(created), isNewUser: true, welcomeCoins: WELCOME_BONUS_COINS });
  });

  // Optional Email OTP fallback (Note: Live Chat remains Google-login only)
  router.post('/otp/request', otpLimiter, (req: Request, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Enter a valid email address' });
      return;
    }
    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = hashOtp(otp, email);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO otp_challenges (email, otp_hash, expires_at, attempts)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET otp_hash = excluded.otp_hash, expires_at = excluded.expires_at, attempts = 0`,
    ).run(email, otpHash, expiresAt);

    // Without external SMTP configured, return instant verification code directly in-app so email login always works
    const hasSmtp = Boolean(process.env.SMTP_HOST?.trim());
    res.json({
      sent: true,
      message: '6-digit verification code generated (expires in 5 minutes).',
      previewOtp: hasSmtp ? undefined : otp,
    });
  });

  router.post('/otp/verify', otpLimiter, (req: AuthedRequest, res: Response) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!email || !/^\d{6}$/.test(otp)) {
      res.status(400).json({ error: 'Enter a valid email and 6-digit OTP' });
      return;
    }

    const challenge = db
      .prepare('SELECT * FROM otp_challenges WHERE email = ?')
      .get(email) as { email: string; otp_hash: string; expires_at: string; attempts: number } | undefined;

    if (!challenge || Date.parse(challenge.expires_at) < Date.now()) {
      res.status(400).json({ error: 'OTP expired. Request a new code.' });
      return;
    }
    if (challenge.attempts >= 5) {
      res.status(429).json({ error: 'Too many wrong OTP attempts. Request a new code.' });
      return;
    }

    if (hashOtp(otp, email) !== challenge.otp_hash) {
      db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE email = ?').run(email);
      res.status(400).json({ error: 'Incorrect verification code' });
      return;
    }

    db.prepare('DELETE FROM otp_challenges WHERE email = ?').run(email);

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as AuthUser | undefined;
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      const id = `usr_${crypto.randomUUID().slice(0, 10)}`;
      const displayName = name || email.split('@')[0];
      const refCode = generateReferralCode(displayName, id.slice(-4));
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO users (id, google_id, auth_provider, name, email, role, coins_balance, coins_earned_total, referral_code, created_at)
           VALUES (?, NULL, 'firebase_email', ?, ?, 'student', ?, ?, ?, ?)`,
        ).run(id, displayName, email, WELCOME_BONUS_COINS, WELCOME_BONUS_COINS, refCode, now);

        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'welcome_bonus', ?, ?, 'email_signup', ?)`,
        ).run(
          `tx_${crypto.randomUUID().slice(0, 10)}`,
          id,
          WELCOME_BONUS_COINS,
          `Welcome bonus (+${WELCOME_BONUS_COINS} Coins on first email sign-in)`,
          now,
        );
      })();
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as AuthUser;
    }

    if (user.is_banned) {
      res.status(403).json({ error: 'This account has been suspended' });
      return;
    }

    const token = signSessionToken({
      uid: user.id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });
    setSessionCookie(req, res, token);
    res.json({ user: serializeProfile(user), isNewUser, welcomeCoins: isNewUser ? WELCOME_BONUS_COINS : undefined });
  });

  // Quick demo student login (for testing student flows in preview)
  router.post('/demo-student', authLimiter, (req: Request, res: Response) => {
    const accountId = req.body?.userId === 'usr_priya' ? 'usr_priya' : 'usr_arjun';
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(accountId) as AuthUser | undefined;
    if (!user) {
      res.status(404).json({ error: 'Demo user not found' });
      return;
    }
    const token = signSessionToken({
      uid: user.id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });
    setSessionCookie(req, res, token);
    res.json({ user: serializeProfile(user) });
  });

  // First-run Admin Claim / Admin Passcode login (SecureCoder pattern)
  router.post('/admin-login', authLimiter, (req: Request, res: Response) => {
    const passcode = String(req.body?.passcode || '');
    if (passcode.length < 4) {
      res.status(400).json({ error: 'Passcode must be at least 4 characters' });
      return;
    }

    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    const storedHashRow = db
      .prepare("SELECT value FROM app_settings WHERE key = 'admin_passcode_hash'")
      .get() as { value: string } | undefined;

    if (storedHashRow) {
      if (!verifyPassword(passcode, storedHashRow.value)) {
        res.status(403).json({ error: 'Incorrect admin passcode' });
        return;
      }
    } else if (envPasscode) {
      const a = Buffer.from(passcode);
      const b = Buffer.from(envPasscode);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(403).json({ error: 'Incorrect admin passcode' });
        return;
      }
    } else {
      // First-run atomic bootstrap: claim admin passcode
      const hash = hashPassword(passcode);
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('admin_passcode_hash', ?)").run(hash);
    }

    const adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get() as
      | AuthUser
      | undefined;
    if (!adminUser) {
      res.status(404).json({ error: 'Admin account not found' });
      return;
    }

    const token = signSessionToken({
      uid: adminUser.id,
      role: adminUser.role,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    });
    setSessionCookie(req, res, token);
    res.json({ user: serializeProfile(adminUser) });
  });

  router.put('/profile', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : user.name;
    const isMinor = typeof req.body?.isMinor === 'boolean' ? (req.body.isMinor ? 1 : 0) : user.is_minor;

    if (name.length < 2) {
      res.status(400).json({ error: 'Display name must be at least 2 characters' });
      return;
    }

    db.prepare('UPDATE users SET name = ?, is_minor = ? WHERE id = ?').run(name, isMinor, user.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as AuthUser;
    res.json({ user: serializeProfile(updated) });
  });

  router.post('/logout', (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  return router;
}
