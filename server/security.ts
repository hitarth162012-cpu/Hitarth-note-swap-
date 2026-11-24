import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Runtime fallback keeps sessions/signatures unpredictable when env var is unset
export const SERVER_SECRET =
  process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

export const SESSION_COOKIE_NAME = 'ns_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hashOtp(otp: string, email: string): string {
  return crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(`${email.toLowerCase()}:${otp}`)
    .digest('hex');
}

export function signSessionToken(payload: { uid: string; role: string; exp: number }): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SERVER_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(
  token: string,
): { uid: string; role: string; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = crypto.createHmac('sha256', SERVER_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof parsed?.uid !== 'string' || typeof parsed?.exp !== 'number') return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const isHttps = String(proto).includes('https');
  const maxAgeSec = 7 * 24 * 60 * 60;
  if (isHttps) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None; Partitioned`,
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`,
    );
  }
}

export function clearSessionCookie(req: Request, res: Response): void {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const isHttps = String(proto).includes('https');
  if (isHttps) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`,
    );
  } else {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    );
  }
}

export function parseCookieToken(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

// Simple in-memory sliding-window rate limiter keyed by IP + action
const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(action: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${action}:${ip}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (hits.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait a moment and try again.',
      });
      return;
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    next();
  };
}

// CSRF guard for mutating API routes using cookies
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const hasCustomHeader = req.headers['x-requested-with'] === 'NoteSwap';
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (hasCustomHeader) {
    next();
    return;
  }
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // fall through
    }
  }
  res.status(403).json({ error: 'Blocked by CSRF protection' });
}
