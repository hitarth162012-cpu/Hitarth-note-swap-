import crypto from 'node:crypto';

export const WELCOME_BONUS_COINS = 10;
export const REFERRAL_BONUS_COINS = 5;
export const DAILY_STREAK_BASE_COINS = 1;
export const DAILY_STREAK_DAY7_BONUS_COINS = 3;
export const MAX_UPLOAD_REWARD_COINS = 2;
export const MIN_NOTE_PRICE_COINS = 1;
export const MAX_NOTE_PRICE_COINS = 50;
export const GEMINI_NOTE_PRICE_COINS = 15;
export const AUTO_HIDE_REPORT_THRESHOLD = 3;
export const REDEEM_MAX_ATTEMPTS = 5;
export const REDEEM_LOCK_MINUTES = 15;
export const REFUND_WINDOW_HOURS = 24;
export const QUIZ_PASS_MIN_SCORE = 4; // out of 5
export const QUIZ_REWARD_COINS = 1;
export const QUIZ_MAX_DAILY_REWARDS = 3;
export const SPIN_COOLDOWN_HOURS = 24;
export const DOUBT_REWARD_MIN_COINS = 1;
export const DOUBT_REWARD_MAX_COINS = 5;
export const CHAT_TRANSFER_MIN_COINS = 1;
export const CHAT_TRANSFER_MAX_COINS = 50;
export const CHAT_TRANSFER_DAILY_LIMIT_COINS = 100;
export const CHAT_MIN_ACCOUNT_AGE_HOURS = 24;
export const CHAT_AUTO_MUTE_REPORT_THRESHOLD = 3;
export const CHAT_MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export interface CoinSplitResult {
  totalCoins: number;
  uploaderCoins: number;
  burnedCoins: number;
}

export function calculateCoinUnlockSplit(priceCoins: number): CoinSplitResult {
  if (!Number.isInteger(priceCoins) || priceCoins < 0) {
    throw new Error('Invalid note coin price');
  }
  const uploaderCoins = Math.floor(priceCoins / 2);
  const burnedCoins = priceCoins - uploaderCoins;
  return {
    totalCoins: priceCoins,
    uploaderCoins,
    burnedCoins,
  };
}

export function parsePositiveIntCoins(input: unknown): number | null {
  const num = typeof input === 'string' ? Number(input.trim()) : Number(input);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
}

export function validateNoteUploadPriceCoins(priceCoins: number): string | null {
  if (!Number.isInteger(priceCoins)) return 'Coin price must be a whole number';
  if (priceCoins < MIN_NOTE_PRICE_COINS || priceCoins > MAX_NOTE_PRICE_COINS) {
    return 'Price must be between 1 and 50 Coins';
  }
  return null;
}

export function validateUploadRewardCoins(rewardCoins: number): string | null {
  if (!Number.isInteger(rewardCoins)) return 'Reward must be a whole number';
  if (rewardCoins < 0 || rewardCoins > MAX_UPLOAD_REWARD_COINS) {
    return 'Upload reward must be between 0 and 2 Coins';
  }
  return null;
}

export function validateDoubtRewardCoins(rewardCoins: number): string | null {
  if (!Number.isInteger(rewardCoins)) return 'Reward must be a whole number';
  if (rewardCoins < DOUBT_REWARD_MIN_COINS || rewardCoins > DOUBT_REWARD_MAX_COINS) {
    return 'Doubt reward must be between 1 and 5 Coins';
  }
  return null;
}

export function validateCoinTransferEligibility(params: {
  amountCoins: number;
  senderBalance: number;
  senderCreatedAtIso: string;
  senderCompletedUnlocks: number;
  senderSentTodayCoins: number;
  senderDeviceId: string;
  receiverDeviceId: string;
  nowMs?: number;
}): string | null {
  const nowMs = params.nowMs ?? Date.now();
  if (!Number.isInteger(params.amountCoins) || params.amountCoins < CHAT_TRANSFER_MIN_COINS || params.amountCoins > CHAT_TRANSFER_MAX_COINS) {
    return `Transfer amount must be between ${CHAT_TRANSFER_MIN_COINS} and ${CHAT_TRANSFER_MAX_COINS} Coins`;
  }
  if (params.senderBalance < params.amountCoins) {
    return 'Insufficient Coin balance';
  }
  const createdMs = Date.parse(params.senderCreatedAtIso);
  if (!Number.isFinite(createdMs) || nowMs - createdMs < CHAT_MIN_ACCOUNT_AGE_HOURS * 60 * 60 * 1000) {
    return 'Account must be at least 24 hours old before sending Coins';
  }
  if (params.senderCompletedUnlocks < 1) {
    return 'Complete at least 1 note unlock before sending Coins';
  }
  if (params.senderSentTodayCoins + params.amountCoins > CHAT_TRANSFER_DAILY_LIMIT_COINS) {
    return `Daily Coin transfer limit is ${CHAT_TRANSFER_DAILY_LIMIT_COINS} Coins`;
  }
  if (params.senderDeviceId && params.receiverDeviceId && params.senderDeviceId === params.receiverDeviceId) {
    return 'Coin transfers between accounts on the same device are blocked';
  }
  return null;
}

const PROFANITY_LIST = ['spammer', 'scamlink', 'f***', 'bitch', 'asshole', 'bastard', 'idiotbox', 'porn', 'xxx'];
const TRUSTED_LINK_HOSTS = new Set([
  'ncert.nic.in',
  'nta.ac.in',
  'jeemain.nta.nic.in',
  'neet.nta.nic.in',
  'en.wikipedia.org',
  'wikipedia.org',
  'khanacademy.org',
  'www.khanacademy.org',
]);

export function moderateChatMessage(rawText: string): { ok: boolean; reason?: string; cleanedText: string } {
  const text = rawText.trim();
  if (!text) return { ok: false, reason: 'Message cannot be empty', cleanedText: '' };
  if (text.length > 1000) return { ok: false, reason: 'Message exceeds 1000 character limit', cleanedText: text };

  const lower = text.toLowerCase();
  for (const word of PROFANITY_LIST) {
    if (lower.includes(word)) {
      return { ok: false, reason: 'Message blocked by safety & profanity filter', cleanedText: text };
    }
  }

  // Repeated spam check (e.g. same character repeated 15+ times)
  if (/(.)\1{14,}/.test(text)) {
    return { ok: false, reason: 'Message flagged as repetitive spam', cleanedText: text };
  }

  // External link filter: block URLs unless host is in trusted academic allowlist
  const urlMatches = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi);
  if (urlMatches) {
    for (const rawUrl of urlMatches) {
      const normalized = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
      try {
        const parsed = new URL(normalized);
        if (!TRUSTED_LINK_HOSTS.has(parsed.hostname.toLowerCase())) {
          return {
            ok: false,
            reason: 'External links are blocked unless from trusted study sites (NCERT, NTA, Wikipedia, Khan Academy)',
            cleanedText: text,
          };
        }
      } catch {
        return { ok: false, reason: 'Invalid or suspicious URL blocked', cleanedText: text };
      }
    }
  }

  return { ok: true, cleanedText: text };
}

export function getCreatorLevel(approvedUploads: number): {
  level: 'Beginner' | 'Contributor' | 'Top Uploader';
  nextTarget: number | null;
} {
  if (approvedUploads >= 10) {
    return { level: 'Top Uploader', nextTarget: null };
  }
  if (approvedUploads >= 3) {
    return { level: 'Contributor', nextTarget: 10 };
  }
  return { level: 'Beginner', nextTarget: 3 };
}

export function calculateDailyStreakReward(
  currentStreak: number,
  lastClaimDate: string | null,
  todayDateStr: string,
): {
  eligible: boolean;
  newStreak: number;
  coinsAwarded: number;
  isSevenDayBonus: boolean;
} {
  if (lastClaimDate === todayDateStr) {
    return {
      eligible: false,
      newStreak: currentStreak,
      coinsAwarded: 0,
      isSevenDayBonus: false,
    };
  }

  let nextStreak = 1;
  if (lastClaimDate) {
    const lastMs = Date.parse(`${lastClaimDate}T00:00:00Z`);
    const todayMs = Date.parse(`${todayDateStr}T00:00:00Z`);
    const diffDays = Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      nextStreak = currentStreak + 1;
    }
  }

  const isSevenDayBonus = nextStreak > 0 && nextStreak % 7 === 0;
  const coinsAwarded =
    DAILY_STREAK_BASE_COINS + (isSevenDayBonus ? DAILY_STREAK_DAY7_BONUS_COINS : 0);

  return {
    eligible: true,
    newStreak: nextStreak,
    coinsAwarded,
    isSevenDayBonus,
  };
}

export function isSpinEligible(lastSpinAtIso: string | null, nowMs: number = Date.now()): {
  eligible: boolean;
  nextSpinAt: string | null;
} {
  if (!lastSpinAtIso) return { eligible: true, nextSpinAt: null };
  const lastMs = Date.parse(lastSpinAtIso);
  if (!Number.isFinite(lastMs)) return { eligible: true, nextSpinAt: null };
  const nextMs = lastMs + SPIN_COOLDOWN_HOURS * 60 * 60 * 1000;
  if (nowMs >= nextMs) return { eligible: true, nextSpinAt: null };
  return { eligible: false, nextSpinAt: new Date(nextMs).toISOString() };
}

export function pickSpinWheelSlice(): { sliceIndex: number; coins: number } {
  const slices = [0, 1, 2, 3, 4, 5];
  const sliceIndex = crypto.randomInt(0, slices.length);
  return { sliceIndex, coins: slices[sliceIndex] };
}

export function evaluateQuizReward(params: {
  score: number;
  totalQuestions: number;
  alreadyRewardedForNote: boolean;
  rewardsEarnedToday: number;
}): { passed: boolean; coinsAwarded: number } {
  const passed = params.totalQuestions === 5 && params.score >= QUIZ_PASS_MIN_SCORE;
  if (!passed || params.alreadyRewardedForNote || params.rewardsEarnedToday >= QUIZ_MAX_DAILY_REWARDS) {
    return { passed, coinsAwarded: 0 };
  }
  return { passed: true, coinsAwarded: QUIZ_REWARD_COINS };
}

export function calculateExamCountdownDays(examDateStr: string, todayStr: string): number {
  const examMs = Date.parse(`${examDateStr}T00:00:00Z`);
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  if (!Number.isFinite(examMs) || !Number.isFinite(todayMs)) return 0;
  return Math.ceil((examMs - todayMs) / (24 * 60 * 60 * 1000));
}

export function isWithinRefundWindow(
  purchasedAtIso: string,
  nowMs: number = Date.now(),
): boolean {
  const purchasedMs = Date.parse(purchasedAtIso);
  if (!Number.isFinite(purchasedMs)) return false;
  return nowMs - purchasedMs <= REFUND_WINDOW_HOURS * 60 * 60 * 1000;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function isRedeemLocked(
  failedAttempts: number,
  lockedUntilIso: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (failedAttempts < REDEEM_MAX_ATTEMPTS || !lockedUntilIso) return false;
  const lockedUntilMs = Date.parse(lockedUntilIso);
  return Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs;
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function signViewerToken(
  payload: { noteId: string; userId: string; exp: number },
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyViewerToken(
  token: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): { noteId: string; userId: string; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (
      typeof parsed?.noteId !== 'string' ||
      typeof parsed?.userId !== 'string' ||
      typeof parsed?.exp !== 'number'
    ) {
      return null;
    }
    if (parsed.exp < nowSec) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function generateReferralCode(name: string, idSuffix: string): string {
  const base = name
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 5)
    .padEnd(3, 'N');
  return `${base}${idSuffix.slice(0, 4).toUpperCase()}`;
}
