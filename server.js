// server.ts
import "dotenv/config";
import http from "node:http";
import path5 from "node:path";
import express8 from "express";
import { WebSocketServer as WebSocketServer2 } from "ws";

// server/db.ts
import Database from "better-sqlite3";
import fs2 from "node:fs";
import path2 from "node:path";

// server/domain.ts
import crypto from "node:crypto";
var WELCOME_BONUS_COINS = 10;
var REFERRAL_BONUS_COINS = 5;
var DAILY_STREAK_BASE_COINS = 1;
var DAILY_STREAK_DAY7_BONUS_COINS = 3;
var MAX_UPLOAD_REWARD_COINS = 2;
var MIN_NOTE_PRICE_COINS = 1;
var MAX_NOTE_PRICE_COINS = 50;
var GEMINI_NOTE_PRICE_COINS = 15;
var AUTO_HIDE_REPORT_THRESHOLD = 3;
var REDEEM_MAX_ATTEMPTS = 5;
var REDEEM_LOCK_MINUTES = 15;
var REFUND_WINDOW_HOURS = 24;
var QUIZ_PASS_MIN_SCORE = 4;
var QUIZ_REWARD_COINS = 1;
var QUIZ_MAX_DAILY_REWARDS = 3;
var SPIN_COOLDOWN_HOURS = 24;
var DOUBT_REWARD_MIN_COINS = 1;
var DOUBT_REWARD_MAX_COINS = 5;
var CHAT_TRANSFER_MIN_COINS = 1;
var CHAT_TRANSFER_MAX_COINS = 50;
var CHAT_TRANSFER_DAILY_LIMIT_COINS = 100;
var CHAT_MIN_ACCOUNT_AGE_HOURS = 24;
var CHAT_AUTO_MUTE_REPORT_THRESHOLD = 3;
var CHAT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
function calculateCoinUnlockSplit(priceCoins) {
  if (!Number.isInteger(priceCoins) || priceCoins < 0) {
    throw new Error("Invalid note coin price");
  }
  const uploaderCoins = Math.floor(priceCoins / 2);
  const burnedCoins = priceCoins - uploaderCoins;
  return {
    totalCoins: priceCoins,
    uploaderCoins,
    burnedCoins
  };
}
function parsePositiveIntCoins(input) {
  const num = typeof input === "string" ? Number(input.trim()) : Number(input);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
}
function validateNoteUploadPriceCoins(priceCoins) {
  if (!Number.isInteger(priceCoins)) return "Coin price must be a whole number";
  if (priceCoins < MIN_NOTE_PRICE_COINS || priceCoins > MAX_NOTE_PRICE_COINS) {
    return "Price must be between 1 and 50 Coins";
  }
  return null;
}
function validateUploadRewardCoins(rewardCoins) {
  if (!Number.isInteger(rewardCoins)) return "Reward must be a whole number";
  if (rewardCoins < 0 || rewardCoins > MAX_UPLOAD_REWARD_COINS) {
    return "Upload reward must be between 0 and 2 Coins";
  }
  return null;
}
function validateDoubtRewardCoins(rewardCoins) {
  if (!Number.isInteger(rewardCoins)) return "Reward must be a whole number";
  if (rewardCoins < DOUBT_REWARD_MIN_COINS || rewardCoins > DOUBT_REWARD_MAX_COINS) {
    return "Doubt reward must be between 1 and 5 Coins";
  }
  return null;
}
function validateCoinTransferEligibility(params) {
  const nowMs = params.nowMs ?? Date.now();
  if (!Number.isInteger(params.amountCoins) || params.amountCoins < CHAT_TRANSFER_MIN_COINS || params.amountCoins > CHAT_TRANSFER_MAX_COINS) {
    return `Transfer amount must be between ${CHAT_TRANSFER_MIN_COINS} and ${CHAT_TRANSFER_MAX_COINS} Coins`;
  }
  if (params.senderBalance < params.amountCoins) {
    return "Insufficient Coin balance";
  }
  const createdMs = Date.parse(params.senderCreatedAtIso);
  if (!Number.isFinite(createdMs) || nowMs - createdMs < CHAT_MIN_ACCOUNT_AGE_HOURS * 60 * 60 * 1e3) {
    return "Account must be at least 24 hours old before sending Coins";
  }
  if (params.senderCompletedUnlocks < 1) {
    return "Complete at least 1 note unlock before sending Coins";
  }
  if (params.senderSentTodayCoins + params.amountCoins > CHAT_TRANSFER_DAILY_LIMIT_COINS) {
    return `Daily Coin transfer limit is ${CHAT_TRANSFER_DAILY_LIMIT_COINS} Coins`;
  }
  if (params.senderDeviceId && params.receiverDeviceId && params.senderDeviceId === params.receiverDeviceId) {
    return "Coin transfers between accounts on the same device are blocked";
  }
  return null;
}
var PROFANITY_LIST = ["spammer", "scamlink", "f***", "bitch", "asshole", "bastard", "idiotbox", "porn", "xxx"];
var TRUSTED_LINK_HOSTS = /* @__PURE__ */ new Set([
  "ncert.nic.in",
  "nta.ac.in",
  "jeemain.nta.nic.in",
  "neet.nta.nic.in",
  "en.wikipedia.org",
  "wikipedia.org",
  "khanacademy.org",
  "www.khanacademy.org"
]);
function moderateChatMessage(rawText) {
  const text = rawText.trim();
  if (!text) return { ok: false, reason: "Message cannot be empty", cleanedText: "" };
  if (text.length > 1e3) return { ok: false, reason: "Message exceeds 1000 character limit", cleanedText: text };
  const lower = text.toLowerCase();
  for (const word of PROFANITY_LIST) {
    if (lower.includes(word)) {
      return { ok: false, reason: "Message blocked by safety & profanity filter", cleanedText: text };
    }
  }
  if (/(.)\1{14,}/.test(text)) {
    return { ok: false, reason: "Message flagged as repetitive spam", cleanedText: text };
  }
  const urlMatches = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi);
  if (urlMatches) {
    for (const rawUrl of urlMatches) {
      const normalized = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
      try {
        const parsed = new URL(normalized);
        if (!TRUSTED_LINK_HOSTS.has(parsed.hostname.toLowerCase())) {
          return {
            ok: false,
            reason: "External links are blocked unless from trusted study sites (NCERT, NTA, Wikipedia, Khan Academy)",
            cleanedText: text
          };
        }
      } catch {
        return { ok: false, reason: "Invalid or suspicious URL blocked", cleanedText: text };
      }
    }
  }
  return { ok: true, cleanedText: text };
}
function getCreatorLevel(approvedUploads) {
  if (approvedUploads >= 10) {
    return { level: "Top Uploader", nextTarget: null };
  }
  if (approvedUploads >= 3) {
    return { level: "Contributor", nextTarget: 10 };
  }
  return { level: "Beginner", nextTarget: 3 };
}
function calculateDailyStreakReward(currentStreak, lastClaimDate, todayDateStr) {
  if (lastClaimDate === todayDateStr) {
    return {
      eligible: false,
      newStreak: currentStreak,
      coinsAwarded: 0,
      isSevenDayBonus: false
    };
  }
  let nextStreak = 1;
  if (lastClaimDate) {
    const lastMs = Date.parse(`${lastClaimDate}T00:00:00Z`);
    const todayMs = Date.parse(`${todayDateStr}T00:00:00Z`);
    const diffDays = Math.round((todayMs - lastMs) / (24 * 60 * 60 * 1e3));
    if (diffDays === 1) {
      nextStreak = currentStreak + 1;
    }
  }
  const isSevenDayBonus = nextStreak > 0 && nextStreak % 7 === 0;
  const coinsAwarded = DAILY_STREAK_BASE_COINS + (isSevenDayBonus ? DAILY_STREAK_DAY7_BONUS_COINS : 0);
  return {
    eligible: true,
    newStreak: nextStreak,
    coinsAwarded,
    isSevenDayBonus
  };
}
function isSpinEligible(lastSpinAtIso, nowMs = Date.now()) {
  if (!lastSpinAtIso) return { eligible: true, nextSpinAt: null };
  const lastMs = Date.parse(lastSpinAtIso);
  if (!Number.isFinite(lastMs)) return { eligible: true, nextSpinAt: null };
  const nextMs = lastMs + SPIN_COOLDOWN_HOURS * 60 * 60 * 1e3;
  if (nowMs >= nextMs) return { eligible: true, nextSpinAt: null };
  return { eligible: false, nextSpinAt: new Date(nextMs).toISOString() };
}
function pickSpinWheelSlice() {
  const slices = [0, 1, 2, 3, 4, 5];
  const sliceIndex = crypto.randomInt(0, slices.length);
  return { sliceIndex, coins: slices[sliceIndex] };
}
function evaluateQuizReward(params) {
  const passed = params.totalQuestions === 5 && params.score >= QUIZ_PASS_MIN_SCORE;
  if (!passed || params.alreadyRewardedForNote || params.rewardsEarnedToday >= QUIZ_MAX_DAILY_REWARDS) {
    return { passed, coinsAwarded: 0 };
  }
  return { passed: true, coinsAwarded: QUIZ_REWARD_COINS };
}
function calculateExamCountdownDays(examDateStr, todayStr) {
  const examMs = Date.parse(`${examDateStr}T00:00:00Z`);
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  if (!Number.isFinite(examMs) || !Number.isFinite(todayMs)) return 0;
  return Math.ceil((examMs - todayMs) / (24 * 60 * 60 * 1e3));
}
function isWithinRefundWindow(purchasedAtIso, nowMs = Date.now()) {
  const purchasedMs = Date.parse(purchasedAtIso);
  if (!Number.isFinite(purchasedMs)) return false;
  return nowMs - purchasedMs <= REFUND_WINDOW_HOURS * 60 * 60 * 1e3;
}
function normalizeCode(raw) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}
function isRedeemLocked(failedAttempts, lockedUntilIso, nowMs = Date.now()) {
  if (failedAttempts < REDEEM_MAX_ATTEMPTS || !lockedUntilIso) return false;
  const lockedUntilMs = Date.parse(lockedUntilIso);
  return Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs;
}
function computeSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
function signViewerToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyViewerToken(token, secret, nowSec = Math.floor(Date.now() / 1e3)) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expectedSig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed?.noteId !== "string" || typeof parsed?.userId !== "string" || typeof parsed?.exp !== "number") {
      return null;
    }
    if (parsed.exp < nowSec) return null;
    return parsed;
  } catch {
    return null;
  }
}
function generateReferralCode(name, idSuffix) {
  const base = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5).padEnd(3, "N");
  return `${base}${idSuffix.slice(0, 4).toUpperCase()}`;
}

// server/noteRenderer.ts
import fs from "node:fs";
import path from "node:path";
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length <= maxChars) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
function renderBlurredPreviewSvg(title, subject, pageCount) {
  const safeTitle = escapeXml(title.slice(0, 44));
  const safeSubject = escapeXml(subject.slice(0, 28));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <filter id="heavyBlur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="9" />
    </filter>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e2e8f0" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="600" height="800" fill="#ffffff"/>
  <rect width="600" height="800" fill="url(#grid)" opacity="0.55"/>
  <g filter="url(#heavyBlur)">
    <rect x="44" y="48" width="240" height="22" rx="4" fill="#4f46e5" opacity="0.45"/>
    <rect x="44" y="84" width="420" height="14" rx="4" fill="#1e293b" opacity="0.5"/>
    <rect x="44" y="130" width="510" height="10" rx="3" fill="#64748b" opacity="0.35"/>
    <rect x="44" y="152" width="470" height="10" rx="3" fill="#64748b" opacity="0.35"/>
    <rect x="44" y="174" width="490" height="10" rx="3" fill="#64748b" opacity="0.35"/>
    <rect x="44" y="216" width="512" height="110" rx="8" fill="#eef2ff" stroke="#818cf8" stroke-width="2" opacity="0.7"/>
    <rect x="64" y="246" width="320" height="14" rx="3" fill="#312e81" opacity="0.5"/>
    <rect x="64" y="274" width="260" height="12" rx="3" fill="#4338ca" opacity="0.4"/>
    <rect x="44" y="360" width="495" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <rect x="44" y="384" width="440" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <rect x="44" y="408" width="505" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <rect x="44" y="432" width="380" height="10" rx="3" fill="#475569" opacity="0.38"/>
    <circle cx="170" cy="560" r="76" fill="none" stroke="#4f46e5" stroke-width="5" opacity="0.4"/>
    <line x1="170" y1="560" x2="225" y2="510" stroke="#0f172a" stroke-width="4" opacity="0.4"/>
    <rect x="290" y="505" width="250" height="12" rx="3" fill="#334155" opacity="0.4"/>
    <rect x="290" y="530" width="210" height="12" rx="3" fill="#334155" opacity="0.35"/>
    <rect x="290" y="555" width="230" height="12" rx="3" fill="#334155" opacity="0.35"/>
    <rect x="44" y="690" width="512" height="58" rx="6" fill="#ecfdf5" opacity="0.75"/>
  </g>
  <rect x="0" y="0" width="600" height="800" fill="rgba(15, 23, 42, 0.08)"/>
  <g transform="translate(300, 390)" text-anchor="middle">
    <rect x="-190" y="-64" width="380" height="128" rx="16" fill="#0f172a" fill-opacity="0.86"/>
    <text x="0" y="-22" fill="#e2e8f0" font-family="sans-serif" font-size="13" font-weight="600">${safeSubject} \xB7 ${pageCount} Pages</text>
    <text x="0" y="6" fill="#ffffff" font-family="sans-serif" font-size="16" font-weight="700">${safeTitle}</text>
    <text x="0" y="34" fill="#a5b4fc" font-family="sans-serif" font-size="13" font-weight="600">Preview Locked \xB7 Unlock to Read Full Notes</text>
  </g>
</svg>`;
}
function renderStructuredPageSvg(noteTitle, subject, pageNumber, totalPages, page, watermarkText) {
  const safeTitle = escapeXml(noteTitle);
  const safeSubject = escapeXml(subject);
  const safeHeading = escapeXml(page.heading);
  const safeSubheading = page.subheading ? escapeXml(page.subheading) : "";
  const safeWatermark = escapeXml(watermarkText);
  let y = 138;
  const bulletElements = [];
  for (const bullet of page.bullets) {
    const lines = wrapText(bullet, 62);
    lines.forEach((line, idx) => {
      const prefix = idx === 0 ? "\u2022  " : "   ";
      bulletElements.push(
        `<text x="56" y="${y}" fill="#1e293b" font-family="sans-serif" font-size="16">${escapeXml(prefix + line)}</text>`
      );
      y += 26;
    });
    y += 10;
  }
  let formulaBlock = "";
  if (page.formula) {
    const formulaY = Math.max(y + 10, 470);
    formulaBlock = `
      <rect x="52" y="${formulaY}" width="596" height="84" rx="10" fill="#eef2ff" stroke="#c7d2fe" stroke-width="1.5"/>
      <text x="72" y="${formulaY + 28}" fill="#4338ca" font-family="sans-serif" font-size="12" font-weight="700">KEY FORMULA / RULE</text>
      <text x="72" y="${formulaY + 58}" fill="#1e1b4b" font-family="monospace" font-size="17" font-weight="700">${escapeXml(page.formula)}</text>
    `;
    y = formulaY + 108;
  }
  let tipBlock = "";
  if (page.tip) {
    const tipY = Math.max(y + 8, 585);
    const tipLines = wrapText(page.tip, 64);
    tipBlock = `
      <rect x="52" y="${tipY}" width="596" height="${46 + tipLines.length * 22}" rx="10" fill="#ecfdf5" stroke="#a7f3d0" stroke-width="1.5"/>
      <text x="72" y="${tipY + 26}" fill="#047857" font-family="sans-serif" font-size="12" font-weight="700">EXAM TIP</text>
      ${tipLines.map(
      (l, i) => `<text x="72" y="${tipY + 50 + i * 22}" fill="#064e3b" font-family="sans-serif" font-size="14">${escapeXml(l)}</text>`
    ).join("\n")}
    `;
  }
  const watermarks = [160, 420, 680].map(
    (wy) => `<text x="350" y="${wy}" text-anchor="middle" transform="rotate(-24 350 ${wy})" fill="#4f46e5" fill-opacity="0.09" font-family="monospace" font-size="15" font-weight="700">${safeWatermark}</text>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 920" width="700" height="920">
  <defs>
    <pattern id="noteGrid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#f1f5f9" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="700" height="920" fill="#ffffff"/>
  <rect width="700" height="920" fill="url(#noteGrid)"/>
  <rect x="0" y="0" width="700" height="6" fill="#4f46e5"/>
  <text x="52" y="44" fill="#64748b" font-family="sans-serif" font-size="12" font-weight="600">${safeSubject}  \xB7  ${safeTitle}</text>
  <text x="648" y="44" text-anchor="end" fill="#64748b" font-family="monospace" font-size="12">Page ${pageNumber} / ${totalPages}</text>
  <line x1="52" y1="58" x2="648" y2="58" stroke="#e2e8f0" stroke-width="1"/>
  <text x="52" y="96" fill="#0f172a" font-family="sans-serif" font-size="24" font-weight="700">${safeHeading}</text>
  ${safeSubheading ? `<text x="52" y="118" fill="#4f46e5" font-family="sans-serif" font-size="13" font-weight="600">${safeSubheading}</text>` : ""}
  ${bulletElements.join("\n")}
  ${formulaBlock}
  ${tipBlock}
  ${watermarks}
  <line x1="52" y1="875" x2="648" y2="875" stroke="#e2e8f0" stroke-width="1"/>
  <text x="52" y="898" fill="#94a3b8" font-family="monospace" font-size="10">Licensed to: ${safeWatermark}</text>
</svg>`;
}
function ensurePrivateStorageDir() {
  const dir = path.resolve(process.cwd(), "storage", "private_notes");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function resolveSafePrivatePath(relativeFilePath) {
  const baseDir = ensurePrivateStorageDir();
  const resolved = path.resolve(baseDir, relativeFilePath);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error("Invalid storage path");
  }
  return resolved;
}

// server/db.ts
var STORAGE_DIR = path2.resolve(process.cwd(), "storage");
fs2.mkdirSync(STORAGE_DIR, { recursive: true });
var DB_PATH = path2.join(STORAGE_DIR, "noteswap.db");
var db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT UNIQUE,
      auth_provider TEXT NOT NULL DEFAULT 'google',
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      is_minor INTEGER NOT NULL DEFAULT 0,
      is_chat_muted INTEGER NOT NULL DEFAULT 0,
      chat_report_count INTEGER NOT NULL DEFAULT 0,
      device_id TEXT DEFAULT '',
      coins_balance INTEGER NOT NULL DEFAULT 0,
      coins_earned_total INTEGER NOT NULL DEFAULT 0,
      streak_days INTEGER NOT NULL DEFAULT 0,
      last_streak_date TEXT,
      last_spin_at TEXT,
      equipped_theme TEXT NOT NULL DEFAULT 'indigo',
      equipped_avatar TEXT NOT NULL DEFAULT 'scholar',
      equipped_frame TEXT NOT NULL DEFAULT 'none',
      referral_code TEXT UNIQUE NOT NULL,
      referred_by TEXT,
      referral_rewarded INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      redeem_failed_attempts INTEGER NOT NULL DEFAULT 0,
      redeem_locked_until TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otp_challenges (
      email TEXT PRIMARY KEY,
      otp_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      uploader_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      exam_class TEXT NOT NULL,
      description TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      price_coins INTEGER NOT NULL,
      is_free_sample INTEGER NOT NULL DEFAULT 0,
      is_gemini_note INTEGER NOT NULL DEFAULT 0,
      is_pyq INTEGER NOT NULL DEFAULT 0,
      pyq_year TEXT DEFAULT '',
      preview_pages_count INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      cover_image TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT DEFAULT '',
      upload_reward_coins INTEGER NOT NULL DEFAULT 0,
      sales_count INTEGER NOT NULL DEFAULT 0,
      total_earned_coins INTEGER NOT NULL DEFAULT 0,
      rating_avg REAL NOT NULL DEFAULT 0,
      rating_count INTEGER NOT NULL DEFAULT 0,
      copyright_declared INTEGER NOT NULL DEFAULT 0,
      report_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
    CREATE INDEX IF NOT EXISTS idx_notes_hash ON notes(file_hash);

    CREATE TABLE IF NOT EXISTS note_ai_kits (
      note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      flashcards_json TEXT NOT NULL,
      quiz_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      note_id TEXT NOT NULL REFERENCES notes(id),
      score INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      reward_coins INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gemini_bundles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      bundle_price_coins INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gemini_bundle_items (
      bundle_id TEXT NOT NULL REFERENCES gemini_bundles(id) ON DELETE CASCADE,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      PRIMARY KEY(bundle_id, note_id)
    );

    CREATE TABLE IF NOT EXISTS gemini_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      topic TEXT NOT NULL,
      subject TEXT NOT NULL,
      exam_class TEXT NOT NULL,
      votes_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gemini_request_votes (
      request_id TEXT NOT NULL REFERENCES gemini_requests(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(request_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      buyer_id TEXT NOT NULL REFERENCES users(id),
      note_id TEXT NOT NULL REFERENCES notes(id),
      price_coins INTEGER NOT NULL,
      uploader_coins INTEGER NOT NULL,
      burned_coins INTEGER NOT NULL,
      refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(buyer_id, note_id)
    );

    CREATE TABLE IF NOT EXISTS refund_requests (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL REFERENCES purchases(id),
      note_id TEXT NOT NULL REFERENCES notes(id),
      buyer_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id),
      buyer_id TEXT NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(note_id, buyer_id)
    );

    CREATE TABLE IF NOT EXISTS coin_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_coins INTEGER NOT NULL,
      description TEXT NOT NULL,
      ref_id TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT DEFAULT '',
      target_id TEXT DEFAULT '',
      amount_coins INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS redeem_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      value_coins INTEGER NOT NULL,
      usage_limit INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0,
      per_user_limit INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      note TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS redeem_usages (
      id TEXT PRIMARY KEY,
      code_id TEXT NOT NULL REFERENCES redeem_codes(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(code_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id),
      reporter_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      details TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      UNIQUE(note_id, reporter_id)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      user_id TEXT NOT NULL REFERENCES users(id),
      note_id TEXT NOT NULL REFERENCES notes(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, note_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id),
      following_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id TEXT NOT NULL REFERENCES users(id),
      achievement_key TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY(user_id, achievement_key)
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price_coins INTEGER NOT NULL,
      preview_value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      user_id TEXT NOT NULL REFERENCES users(id),
      item_id TEXT NOT NULL REFERENCES shop_items(id),
      purchased_at TEXT NOT NULL,
      PRIMARY KEY(user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS doubts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      subject TEXT NOT NULL,
      exam_class TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      best_answer_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doubt_answers (
      id TEXT PRIMARY KEY,
      doubt_id TEXT NOT NULL REFERENCES doubts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      is_best INTEGER NOT NULL DEFAULT 0,
      reward_coins INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_exams (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      exam_name TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      reminder_days INTEGER NOT NULL DEFAULT 14,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_logs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      results_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Live Chat, DM Requests, Blocks, Mutes, Coin Transfers & Moderation
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dm_threads (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL REFERENCES users(id),
      user_b TEXT NOT NULL REFERENCES users(id),
      requester_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      UNIQUE(user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_id TEXT NOT NULL REFERENCES users(id),
      message_type TEXT NOT NULL DEFAULT 'text',
      body TEXT NOT NULL DEFAULT '',
      image_data TEXT DEFAULT '',
      payload_json TEXT DEFAULT '{}',
      seen_by_json TEXT NOT NULL DEFAULT '[]',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_room_time ON chat_messages(room_id, created_at);

    CREATE TABLE IF NOT EXISTS chat_mutes (
      user_id TEXT NOT NULL REFERENCES users(id),
      room_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, room_id)
    );

    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id TEXT NOT NULL REFERENCES users(id),
      blocked_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS chat_reports (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES chat_messages(id),
      room_id TEXT NOT NULL,
      reported_user_id TEXT NOT NULL REFERENCES users(id),
      reporter_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      UNIQUE(message_id, reporter_id)
    );

    CREATE TABLE IF NOT EXISTS coin_transfers (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id),
      receiver_id TEXT NOT NULL REFERENCES users(id),
      amount_coins INTEGER NOT NULL,
      flagged_suspicious INTEGER NOT NULL DEFAULT 0,
      flag_reason TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  purgeExpiredChatHistory();
  seedInitialData();
}
function purgeExpiredChatHistory() {
  db.prepare(
    `DELETE FROM chat_messages WHERE datetime(created_at) < datetime('now', '-30 days')`
  ).run();
}
function writeStructuredNotePages(noteId, pages) {
  const baseDir = ensurePrivateStorageDir();
  const noteDir = path2.join(baseDir, noteId);
  fs2.mkdirSync(noteDir, { recursive: true });
  const jsonContent = JSON.stringify(pages, null, 2);
  fs2.writeFileSync(path2.join(noteDir, "pages.json"), jsonContent, "utf8");
  return {
    relPath: `${noteId}/pages.json`,
    hash: computeSha256(Buffer.from(jsonContent, "utf8"))
  };
}
function seedInitialData() {
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  if (userCount > 0) return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1e3).toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  const futureExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1e3).toISOString();
  const examSoon = new Date(Date.now() + 12 * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  const seedUsers = [
    {
      id: "usr_admin",
      google_id: "google_admin_hitz90541",
      name: "NoteSwap Admin",
      email: "hitz90541@gmail.com",
      role: "admin",
      is_minor: 0,
      device_id: "dev_seed_admin",
      coins_balance: 100,
      coins_earned_total: 0,
      streak_days: 3,
      last_streak_date: yesterday,
      referral_code: "ADMIN1"
    },
    {
      id: "usr_arjun",
      google_id: "google_arjun_1042",
      name: "Arjun Mehta",
      email: "arjun@student.edu.in",
      role: "student",
      is_minor: 0,
      device_id: "dev_seed_arjun",
      coins_balance: 34,
      coins_earned_total: 42,
      streak_days: 6,
      last_streak_date: yesterday,
      referral_code: generateReferralCode("Arjun", "1042")
    },
    {
      id: "usr_priya",
      google_id: "google_priya_2084",
      name: "Priya Sharma",
      email: "priya@iitb.ac.in",
      role: "student",
      is_minor: 0,
      device_id: "dev_seed_priya",
      coins_balance: 54,
      coins_earned_total: 128,
      streak_days: 4,
      last_streak_date: yesterday,
      referral_code: generateReferralCode("Priya", "2084")
    },
    {
      id: "usr_rohan",
      google_id: "google_rohan_3099",
      name: "Rohan Verma",
      email: "rohan@aiims.edu",
      role: "student",
      is_minor: 1,
      // Minor account to test stranger DM safety guard
      device_id: "dev_seed_rohan",
      coins_balance: 35,
      coins_earned_total: 94,
      streak_days: 2,
      last_streak_date: yesterday,
      referral_code: generateReferralCode("Rohan", "3099")
    }
  ];
  const insertUser = db.prepare(`
    INSERT INTO users (
      id, google_id, auth_provider, name, email, role, is_minor, device_id,
      coins_balance, coins_earned_total, streak_days, last_streak_date, referral_code, created_at
    ) VALUES (
      @id, @google_id, 'google', @name, @email, @role, @is_minor, @device_id,
      @coins_balance, @coins_earned_total, @streak_days, @last_streak_date, @referral_code, @created_at
    )
  `);
  for (const u of seedUsers) {
    insertUser.run({ ...u, created_at: threeDaysAgo });
  }
  db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`).run("coins_burned_total", "215");
  db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`).run("coins_minted_total", "482");
  const seedNotes = [
    {
      id: "note_gemini_electrodynamics",
      uploader_id: "usr_admin",
      title: "Gemini Official: Electrodynamics & Maxwell Equations Master Pack",
      subject: "Physics",
      exam_class: "JEE Main & Adv",
      description: "Curated Official Gemini Note covering Gauss Law, Faraday induction, displacement current, and boundary conditions with 2 free preview pages.",
      tags: ["Gemini Official", "Physics", "Electrodynamics", "JEE"],
      price_coins: GEMINI_NOTE_PRICE_COINS,
      is_free_sample: 0,
      is_gemini_note: 1,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 2,
      cover_image: "/src/assets/images/cover_physics_notes_1795530739360.jpg",
      status: "approved",
      sales_count: 42,
      total_earned_coins: 0,
      rating_avg: 4.9,
      rating_count: 18,
      upload_reward_coins: 0,
      pages: [
        {
          heading: "1. Gauss Law & Electric Flux Symmetry",
          subheading: "Gemini Official Preview \xB7 Page 1 (Free Preview)",
          bullets: [
            "Total electric flux through any closed Gaussian surface depends only on enclosed charge: Phi = q_enc / epsilon_0.",
            "Choose spherical surfaces for point/spherical symmetry, cylindrical surfaces for infinite line charges.",
            "Inside a conductor in electrostatic equilibrium, E = 0 and net excess charge resides on the outer surface."
          ],
          formula: "oint E . dA = q_enclosed / epsilon_0",
          tip: "When a charge sits at a cube corner, imagine 8 symmetric cubes to find flux through one face = q / (24 * eps_0)."
        },
        {
          heading: "2. Faraday Law & Motional EMF",
          subheading: "Gemini Official Preview \xB7 Page 2 (Free Preview)",
          bullets: [
            "Induced EMF opposes the change in magnetic flux: e = -d(Phi_B)/dt.",
            "Motional EMF across a rod of length L moving perpendicular to B: e = B * L * v.",
            "For a rotating rod about one end in uniform B: e = (1/2) * B * omega * L^2."
          ],
          formula: "EMF_rotating_rod = 0.5 * B * omega * L^2",
          tip: "Always check whether the loop is open (EMF develops) or closed (induced current flows)."
        },
        {
          heading: "3. Maxwell Displacement Current & EM Waves",
          subheading: "Gemini Official Full Pack \xB7 Page 3",
          bullets: [
            "Ampere-Maxwell Law adds displacement current I_d = epsilon_0 * d(Phi_E)/dt inside charging capacitors.",
            "EM waves are transverse: E perpendicular to B perpendicular to propagation direction (E x B).",
            "Wave speed in vacuum c = 1 / sqrt(mu_0 * epsilon_0), and E_0 / B_0 = c."
          ],
          formula: "oint B . dl = mu_0 * (I_c + epsilon_0 * dPhi_E/dt)",
          tip: "In a parallel plate capacitor, conduction current in wires equals displacement current between plates."
        }
      ]
    },
    {
      id: "note_gemini_system_design",
      uploader_id: "usr_admin",
      title: "Gemini Official: System Design & Distributed Caching Blueprint",
      subject: "Computer Science",
      exam_class: "B.Tech / GATE CS",
      description: "Official Gemini Note with architecture patterns for rate limiters, consistent hashing, Redis caching, and SQL vs NoSQL trade-offs.",
      tags: ["Gemini Official", "System Design", "Placements", "GATE CS"],
      price_coins: GEMINI_NOTE_PRICE_COINS,
      is_free_sample: 0,
      is_gemini_note: 1,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 1,
      cover_image: "/src/assets/images/cover_cs_algorithms_1795530739692.jpg",
      status: "approved",
      sales_count: 35,
      total_earned_coins: 0,
      rating_avg: 4.9,
      rating_count: 14,
      upload_reward_coins: 0,
      pages: [
        {
          heading: "1. Consistent Hashing & Virtual Nodes",
          subheading: "Gemini Official Preview \xB7 Page 1 (Free Preview)",
          bullets: [
            "Modulo hashing (hash(key) % N) remaps almost all keys whenever a cache node joins or leaves.",
            "Consistent hashing maps both servers and keys onto a [0, 2^32 - 1] hash ring.",
            "Adding virtual nodes per physical server prevents hot-spotting and evens load distribution."
          ],
          formula: "Keys moved on node add/remove \u2248 K / N",
          tip: "Always mention virtual nodes (100\u2013200 vnodes/server) when explaining consistent hashing in interviews."
        },
        {
          heading: "2. Cache-Aside vs Write-Through Strategies",
          subheading: "Gemini Official Full Pack \xB7 Page 2",
          bullets: [
            "Cache-Aside: App checks Redis first; on miss, reads DB and populates cache with a TTL.",
            "Write-Through: App writes to cache and cache synchronously writes to DB (higher write latency, strong consistency).",
            "Prevent cache stampede using singleflight locks or staggered TTL jitter."
          ],
          formula: "Hit Ratio = Cache Hits / (Cache Hits + Cache Misses)",
          tip: "Use Redis INCR + EXPIRE or Token Bucket Lua scripts for atomic distributed rate limiting."
        }
      ]
    },
    {
      id: "note_pyq_jee_2025",
      uploader_id: "usr_admin",
      title: "JEE Main 2025 Session 1 \u2014 Solved Physics & Maths Paper",
      subject: "Physics",
      exam_class: "JEE Main & Adv",
      description: "Official solved previous year question paper with step-by-step derivations, option elimination tricks, and final answer key.",
      tags: ["PYQ", "JEE Main", "2025", "Solved Paper"],
      price_coins: 5,
      is_free_sample: 0,
      is_gemini_note: 0,
      is_pyq: 1,
      pyq_year: "2025",
      preview_pages_count: 1,
      cover_image: "/src/assets/images/cover_physics_notes_1795530739360.jpg",
      status: "approved",
      sales_count: 61,
      total_earned_coins: 0,
      rating_avg: 4.9,
      rating_count: 22,
      upload_reward_coins: 0,
      pages: [
        {
          heading: "JEE Main 2025 Physics Shift 1 \u2014 Questions 1 to 3",
          subheading: "Official Previous Year Paper \xB7 2025",
          bullets: [
            "Q1 (Electrostatics): Two point charges +4q and -q placed at x=0 and x=d. Null point lies at x = 2d.",
            "Q2 (Modern Physics): De Broglie wavelength ratio for proton and alpha particle accelerated through same V is 2*sqrt(2):1.",
            "Q3 (Optics): Young double slit fringe width doubles when wavelength is doubled or slit separation halved."
          ],
          formula: "lambda = h / sqrt(2 * m * q * V)",
          tip: "Use dimensional analysis on complex mechanics options in JEE Main to eliminate 2 choices in 10 seconds."
        },
        {
          heading: "JEE Main 2025 Maths Shift 1 \u2014 Calculus & Matrices",
          subheading: "Official Previous Year Paper \xB7 2025",
          bullets: [
            "Q4 (Matrices): If A^2 - 5A + 7I = 0, then A^(-1) = (5I - A) / 7 by Cayley-Hamilton theorem.",
            "Q5 (Vectors): Shortest distance between skew lines uses |(a2 - a1) . (b1 x b2)| / |b1 x b2|."
          ],
          formula: "A^(-1) = (5I - A) / 7",
          tip: "Verify determinant != 0 before inverting any matrix identity."
        }
      ]
    },
    {
      id: "note_pyq_neet_2025",
      uploader_id: "usr_admin",
      title: "NEET UG 2025 \u2014 Organic & Bio High-Yield PYQ Solutions",
      subject: "Chemistry",
      exam_class: "NEET & Class 12",
      description: "Verified previous year paper solution guide highlighting NCERT line-by-line references for every Biology & Organic Chemistry question.",
      tags: ["PYQ", "NEET", "2025", "NCERT"],
      price_coins: 5,
      is_free_sample: 0,
      is_gemini_note: 0,
      is_pyq: 1,
      pyq_year: "2025",
      preview_pages_count: 1,
      cover_image: "/src/assets/images/cover_organic_chem_1795530740363.jpg",
      status: "approved",
      sales_count: 49,
      total_earned_coins: 0,
      rating_avg: 4.8,
      rating_count: 16,
      upload_reward_coins: 0,
      pages: [
        {
          heading: "NEET UG 2025 \u2014 Assertion & Reason Solutions",
          subheading: "Official Previous Year Paper \xB7 2025",
          bullets: [
            "Q1 (Cell Cycle): Crossing over occurs during Pachytene of Prophase I via recombinase enzyme.",
            "Q2 (Aldehydes): Fehling test is positive for aliphatic aldehydes, negative for benzaldehyde.",
            "Q3 (Genetics): Lac operon is inducible; allolactose acts as the true inducer binding to repressor."
          ],
          formula: "Recombinase acts at Pachytene (Meiosis I)",
          tip: 'For NEET Assertion-Reason, test if the Reason explicitly starts with "because" and holds true independently.'
        }
      ]
    },
    {
      id: "note_sample_physics",
      uploader_id: "usr_priya",
      title: "Rotational Motion & Moment of Inertia \u2014 Free Starter Pack",
      subject: "Physics",
      exam_class: "JEE Main & Adv",
      description: "Crisp handwritten summary of torque, angular momentum conservation, parallel & perpendicular axis theorems with solved JEE PYQ tricks.",
      tags: ["Physics", "Mechanics", "JEE", "Free Sample"],
      price_coins: 0,
      is_free_sample: 1,
      is_gemini_note: 0,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 1,
      cover_image: "/src/assets/images/cover_physics_notes_1795530739360.jpg",
      status: "approved",
      sales_count: 148,
      total_earned_coins: 0,
      rating_avg: 4.9,
      rating_count: 28,
      upload_reward_coins: 2,
      pages: [
        {
          heading: "1. Moment of Inertia & Parallel Axis Theorem",
          subheading: "JEE Physics Rapid Revision \xB7 Page 1",
          bullets: [
            "Moment of inertia I = sum(m_i * r_i^2) depends on mass distribution relative to the axis of rotation.",
            "Parallel Axis Theorem: I = I_cm + M * d^2 where d is perpendicular distance between parallel axes.",
            "Perpendicular Axis Theorem (planar bodies only): I_z = I_x + I_y."
          ],
          formula: "I_solid_sphere = (2/5)MR^2  |  I_disc = (1/2)MR^2",
          tip: "Check whether the body is hollow or solid before plugging in K^2/R^2 for rolling motion."
        },
        {
          heading: "2. Rolling Without Slipping on Inclined Plane",
          subheading: "JEE Physics Rapid Revision \xB7 Page 2",
          bullets: [
            "Pure rolling condition at contact point: v_cm = omega * R and a_cm = alpha * R.",
            "Acceleration down an incline of angle theta: a = g * sin(theta) / (1 + I / MR^2).",
            "Sphere reaches the bottom faster than a disc, which is faster than a ring."
          ],
          formula: "a_rolling = g sin(theta) / (1 + K^2 / R^2)",
          tip: "Static friction does zero work during pure rolling, so mechanical energy stays conserved."
        }
      ]
    },
    {
      id: "note_dsa_graphs",
      uploader_id: "usr_priya",
      title: "Data Structures & Graph Algorithms Master Sheet",
      subject: "Computer Science",
      exam_class: "B.Tech / GATE CS",
      description: "Complete visual trace of BFS, DFS, Dijkstra, Bellman-Ford, Kruskal MST, and Dynamic Programming patterns with complexity table.",
      tags: ["DSA", "Algorithms", "GATE", "Placement"],
      price_coins: 10,
      is_free_sample: 0,
      is_gemini_note: 0,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 0,
      cover_image: "/src/assets/images/cover_cs_algorithms_1795530739692.jpg",
      status: "approved",
      sales_count: 64,
      total_earned_coins: 320,
      rating_avg: 4.8,
      rating_count: 19,
      upload_reward_coins: 2,
      pages: [
        {
          heading: "1. Graph Traversals: BFS vs DFS",
          subheading: "B.Tech / GATE CS \xB7 Core Traversals",
          bullets: [
            "BFS uses a Queue (FIFO) and finds shortest path in unweighted graphs in O(V + E).",
            "DFS uses Recursion/Stack (LIFO), detects cycles, and computes topological order in DAGs.",
            "Track visited states before pushing into BFS queue to prevent duplicate visits."
          ],
          formula: "Time Complexity: O(V + E)  |  Space: O(V)",
          tip: "For 2D grid shortest paths, BFS with 4-direction dx/dy array beats DFS on time."
        },
        {
          heading: "2. Shortest Paths: Dijkstra & Bellman-Ford",
          subheading: "B.Tech / GATE CS \xB7 Weighted Graphs",
          bullets: [
            "Dijkstra uses a min-heap priority queue and requires non-negative edge weights.",
            "Bellman-Ford relaxes all E edges V-1 times and detects negative weight cycles on the V-th pass.",
            "Floyd-Warshall computes all-pairs shortest paths in O(V^3)."
          ],
          formula: "Dijkstra: O((V + E) log V)  |  Bellman-Ford: O(V * E)",
          tip: "In GATE MCQs, always verify if negative weights exist before choosing Dijkstra."
        },
        {
          heading: "3. Dynamic Programming Checklist",
          subheading: "B.Tech / GATE CS \xB7 Interview Prep",
          bullets: [
            "Identify overlapping subproblems and optimal substructure before writing memoization.",
            "Convert 2D 0/1 Knapsack table to 1D rolling array by iterating capacity backwards.",
            "Longest Increasing Subsequence optimizes from O(N^2) to O(N log N) via patience sorting."
          ],
          formula: "dp[w] = max(dp[w], val[i] + dp[w - wt[i]])",
          tip: "Always write the base case for index = 0 and capacity = 0 first."
        }
      ]
    },
    {
      id: "note_org_chem",
      uploader_id: "usr_rohan",
      title: "Organic Chemistry Named Reactions & Mechanisms",
      subject: "Chemistry",
      exam_class: "NEET & Class 12",
      description: "32 high-yield NCERT & NEET named reactions (Aldol, Cannizzaro, Friedel-Crafts, Hofmann) with reagents, stereochemistry, and exceptions.",
      tags: ["Organic Chemistry", "NEET", "Class 12", "NCERT"],
      price_coins: 12,
      is_free_sample: 0,
      is_gemini_note: 0,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 0,
      cover_image: "/src/assets/images/cover_organic_chem_1795530740363.jpg",
      status: "approved",
      sales_count: 52,
      total_earned_coins: 312,
      rating_avg: 4.9,
      rating_count: 15,
      upload_reward_coins: 2,
      pages: [
        {
          heading: "1. Aldol & Cannizzaro Reaction",
          subheading: "Carbonyl Compounds \xB7 High-Yield NEET",
          bullets: [
            "Aldehydes/ketones with at least one alpha-hydrogen undergo Aldol condensation in dilute NaOH.",
            "Aldehydes WITHOUT alpha-hydrogen (HCHO, PhCHO) undergo Cannizzaro disproportionation in conc. NaOH.",
            "Intramolecular Aldol favors 5- and 6-membered cyclic enones upon heating."
          ],
          formula: "2 R-CH2-CHO --(dil. NaOH, heat)--> alpha,beta-unsaturated aldehyde",
          tip: "If both HCHO and PhCHO react (Crossed Cannizzaro), HCHO gets oxidized to formate."
        },
        {
          heading: "2. Electrophilic Aromatic Substitution",
          subheading: "Benzene Derivatives \xB7 Directing Effects",
          bullets: [
            "Ortho/Para directors (+M, +I): -OH, -NH2, -OCH3, -CH3 activate the ring.",
            "Meta directors (-M, -I): -NO2, -CN, -CHO, -COOH deactivate the ring.",
            "Halogens (-Cl, -Br) are deactivating (-I > +M) yet ortho/para directing."
          ],
          formula: "Nitration Electrophile: NO2+ (from HNO3 + H2SO4)",
          tip: "Aniline does not undergo Friedel-Crafts directly because it forms a salt with AlCl3."
        }
      ]
    },
    {
      id: "note_calculus_cheatsheet",
      uploader_id: "usr_arjun",
      title: "Definite Integration & Differential Equations Shortcuts",
      subject: "Mathematics",
      exam_class: "JEE Main & Adv",
      description: "King property, Queen property, Wallis formula, and linear differential equation integrating factor solved examples for fast scoring.",
      tags: ["Calculus", "Mathematics", "Class 12", "JEE"],
      price_coins: 8,
      is_free_sample: 0,
      is_gemini_note: 0,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 0,
      cover_image: "/src/assets/images/cover_physics_notes_1795530739360.jpg",
      status: "approved",
      sales_count: 37,
      total_earned_coins: 148,
      rating_avg: 4.7,
      rating_count: 11,
      upload_reward_coins: 2,
      pages: [
        {
          heading: "1. King Property & Even-Odd Symmetry",
          subheading: "Definite Integration \xB7 Page 1",
          bullets: [
            "King Property: Integral from a to b of f(x)dx equals Integral from a to b of f(a + b - x)dx.",
            "Add I + I after applying King Property whenever numerator + denominator share symmetry.",
            "For symmetric limits [-a, a]: odd functions integrate to 0; even functions double [0, a]."
          ],
          formula: "I = int_a^b f(x)dx = int_a^b f(a + b - x)dx",
          tip: "Look for trigonometric denominators like sin(x) + cos(x) over [0, pi/2] \u2014 answer is almost always pi/4."
        },
        {
          heading: "2. Linear Differential Equations",
          subheading: "Differential Equations \xB7 Page 2",
          bullets: [
            "Standard form: dy/dx + P(x)y = Q(x).",
            "Integrating Factor (I.F.) = exp(integral of P(x) dx).",
            "Solution: y * (I.F.) = integral of (Q(x) * I.F.) dx + C."
          ],
          formula: "y * e^(int P dx) = int (Q * e^(int P dx)) dx + C",
          tip: "If dy/dx looks non-linear in y, check dx/dy + P(y)x = Q(y) instead."
        }
      ]
    },
    {
      id: "note_indian_polity",
      uploader_id: "usr_rohan",
      title: "Indian Constitution Articles & Amendments Quick Notes",
      subject: "General Studies",
      exam_class: "UPSC / SSC / CUET",
      description: "All Fundamental Rights (Art 12-35), DPSP, Emergency provisions, and 42nd/44th/73rd/101st Amendments organized for last-minute revision.",
      tags: ["Polity", "UPSC", "CUET", "SSC"],
      price_coins: 15,
      is_free_sample: 0,
      is_gemini_note: 0,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 0,
      cover_image: "/src/assets/images/hero_study_desk_1795530739424.jpg",
      status: "approved",
      sales_count: 41,
      total_earned_coins: 287,
      rating_avg: 4.8,
      rating_count: 9,
      upload_reward_coins: 2,
      pages: [
        {
          heading: "1. Fundamental Rights (Part III: Articles 12\u201335)",
          subheading: "UPSC Polity Summary \xB7 Page 1",
          bullets: [
            "Right to Equality (Art 14\u201318): Abolition of untouchability (Art 17) & titles (Art 18).",
            "Right to Freedom (Art 19\u201322): Art 21 guarantees Right to Life & Personal Liberty.",
            "Constitutional Remedies (Art 32): 5 Writs \u2014 Habeas Corpus, Mandamus, Prohibition, Certiorari, Quo Warranto."
          ],
          formula: "Art 32 (Supreme Court)  |  Art 226 (High Courts)",
          tip: "Articles 20 and 21 cannot be suspended even during a National Emergency under Art 352."
        }
      ]
    },
    {
      id: "note_pending_thermo",
      uploader_id: "usr_arjun",
      title: "Thermodynamics Laws & Carnot Cycle Formula Sheet",
      subject: "Physics",
      exam_class: "NEET & Class 12",
      description: "Clean 1-page summary of First & Second Law of Thermodynamics, isothermal vs adiabatic work, and Carnot engine efficiency.",
      tags: ["Thermodynamics", "Physics", "NEET"],
      price_coins: 6,
      is_free_sample: 0,
      is_gemini_note: 0,
      is_pyq: 0,
      pyq_year: "",
      preview_pages_count: 0,
      cover_image: "/src/assets/images/cover_physics_notes_1795530739360.jpg",
      status: "pending",
      sales_count: 0,
      total_earned_coins: 0,
      rating_avg: 0,
      rating_count: 0,
      upload_reward_coins: 0,
      pages: [
        {
          heading: "1. First Law & Thermodynamic Processes",
          subheading: "Pending Review \xB7 Physics",
          bullets: [
            "Sign convention (Physics): dQ = dU + dW where dW = P dV.",
            "Isothermal process (T = const): dU = 0, so dQ = dW = nRT ln(V2/V1).",
            "Adiabatic process (dQ = 0): PV^gamma = constant, slope is gamma times isothermal slope."
          ],
          formula: "Carnot Efficiency: eta = 1 - (T_sink / T_source)",
          tip: "Always convert temperatures to Kelvin before computing Carnot efficiency."
        }
      ]
    }
  ];
  const insertNote = db.prepare(`
    INSERT INTO notes (
      id, uploader_id, title, subject, exam_class, description, tags,
      price_coins, is_free_sample, is_gemini_note, is_pyq, pyq_year, preview_pages_count,
      page_count, file_type, file_path, file_hash, cover_image, status,
      upload_reward_coins, sales_count, total_earned_coins,
      rating_avg, rating_count, copyright_declared, created_at
    ) VALUES (
      @id, @uploader_id, @title, @subject, @exam_class, @description, @tags,
      @price_coins, @is_free_sample, @is_gemini_note, @is_pyq, @pyq_year, @preview_pages_count,
      @page_count, 'structured', @file_path, @file_hash, @cover_image, @status,
      @upload_reward_coins, @sales_count, @total_earned_coins,
      @rating_avg, @rating_count, 1, @created_at
    )
  `);
  for (const n of seedNotes) {
    const { relPath, hash } = writeStructuredNotePages(n.id, n.pages);
    insertNote.run({
      id: n.id,
      uploader_id: n.uploader_id,
      title: n.title,
      subject: n.subject,
      exam_class: n.exam_class,
      description: n.description,
      tags: JSON.stringify(n.tags),
      price_coins: n.price_coins,
      is_free_sample: n.is_free_sample,
      is_gemini_note: n.is_gemini_note,
      is_pyq: n.is_pyq,
      pyq_year: n.pyq_year,
      preview_pages_count: n.preview_pages_count,
      page_count: n.pages.length,
      file_path: relPath,
      file_hash: hash,
      cover_image: n.cover_image,
      status: n.status,
      upload_reward_coins: n.upload_reward_coins,
      sales_count: n.sales_count,
      total_earned_coins: n.total_earned_coins,
      rating_avg: n.rating_avg,
      rating_count: n.rating_count,
      created_at: now
    });
  }
  db.prepare(`
    INSERT INTO gemini_bundles (id, title, description, bundle_price_coins, is_active, created_at)
    VALUES ('bnd_gemini_stem', 'STEM Dual Pack: Electrodynamics + System Design', 'Unlock both Official Gemini Notes together and save 6 Coins.', 24, 1, ?)
  `).run(now);
  db.prepare(`INSERT INTO gemini_bundle_items (bundle_id, note_id) VALUES ('bnd_gemini_stem', 'note_gemini_electrodynamics')`).run();
  db.prepare(`INSERT INTO gemini_bundle_items (bundle_id, note_id) VALUES ('bnd_gemini_stem', 'note_gemini_system_design')`).run();
  const insertReq = db.prepare(`
    INSERT INTO gemini_requests (id, user_id, topic, subject, exam_class, votes_count, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `);
  insertReq.run("greq_1", "usr_arjun", "Operating Systems Deadlocks, Paging & Virtual Memory", "Computer Science", "B.Tech / GATE CS", 18, now);
  insertReq.run("greq_2", "usr_rohan", "Human Physiology & Neural Control NCERT Mindmaps", "Biology", "NEET & Class 12", 14, now);
  insertReq.run("greq_3", "usr_priya", "Modern Indian History Timeline (1857\u20131947)", "General Studies", "UPSC / SSC / CUET", 9, now);
  db.prepare(`INSERT INTO gemini_request_votes (request_id, user_id, created_at) VALUES ('greq_1', 'usr_arjun', ?)`).run(now);
  db.prepare(`
    INSERT INTO purchases (id, buyer_id, note_id, price_coins, uploader_coins, burned_coins, created_at)
    VALUES ('pur_seed_1', 'usr_arjun', 'note_sample_physics', 0, 0, 0, ?)
  `).run(now);
  db.prepare(`
    INSERT INTO reviews (id, note_id, buyer_id, rating, comment, created_at)
    VALUES ('rev_seed_1', 'note_sample_physics', 'usr_arjun', 5, 'Super clear parallel axis theorem trick. Saved me 20 minutes in mock test!', ?)
  `).run(now);
  const insertTx = db.prepare(`
    INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertTx.run("tx_1", "usr_arjun", "earned", "welcome_bonus", WELCOME_BONUS_COINS, "Welcome bonus on first Google login", "signup", now);
  insertTx.run("tx_2", "usr_arjun", "earned", "sale_credit", 24, "Coins earned from Calculus Shortcuts unlocks", "note_calculus_cheatsheet", now);
  insertTx.run("tx_3", "usr_arjun", "earned", "upload_reward", 2, "Admin upload reward for Calculus Shortcuts", "note_calculus_cheatsheet", now);
  insertTx.run("tx_4", "usr_arjun", "spent", "unlock_debit", -8, "Unlocked Indian Constitution Quick Notes", "note_indian_polity", now);
  const insertCode = db.prepare(`
    INSERT INTO redeem_codes (id, code, value_coins, usage_limit, used_count, per_user_limit, expires_at, note, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCode.run("rc_diwali", "DIWALI20", 20, 100, 4, 1, futureExpiry, "Diwali Study Boost", 1, now);
  insertCode.run("rc_study10", "STUDY10", 10, 50, 2, 1, futureExpiry, "Exam Week Bonus", 1, now);
  const insertShop = db.prepare(`
    INSERT INTO shop_items (id, kind, key, name, description, price_coins, preview_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertShop.run("shp_theme_emerald", "theme", "emerald", "Emerald Focus Theme", "Crisp botanical emerald accent across cards and buttons.", 8, "#059669");
  insertShop.run("shp_theme_amber", "theme", "amber", "Royal Amber Theme", "Warm scholar gold accent for exam season.", 10, "#d97706");
  insertShop.run("shp_theme_rose", "theme", "rose", "Crimson Ink Theme", "Bold crimson notebook highlight accent.", 10, "#e11d48");
  insertShop.run("shp_avatar_owl", "avatar", "owl", "Night Owl Scholar", "Late-night revision specialist avatar.", 6, "\u{1F989}");
  insertShop.run("shp_avatar_rocket", "avatar", "rocket", "Top Ranker Rocket", "High-velocity exam sprint avatar.", 8, "\u{1F680}");
  insertShop.run("shp_avatar_atom", "avatar", "atom", "Quantum Mind", "Physics & STEM specialist emblem.", 8, "\u269B\uFE0F");
  insertShop.run("shp_frame_gold", "frame", "gold", "Golden Scholar Ring", "Radiant gold border ring around your profile badge.", 12, "ring-amber-400");
  insertShop.run("shp_frame_emerald", "frame", "emerald", "Emerald Circuit Frame", "Sleek emerald double-ring profile frame.", 10, "ring-emerald-500");
  db.prepare(`
    INSERT INTO doubts (id, user_id, subject, exam_class, title, body, status, created_at)
    VALUES ('dbt_1', 'usr_arjun', 'Physics', 'JEE Main & Adv', 'Why does static friction do zero work in pure rolling?', 'In rolling motion down an incline, friction applies torque. Why is work done by static friction zero?', 'open', ?)
  `).run(now);
  db.prepare(`
    INSERT INTO doubt_answers (id, doubt_id, user_id, body, is_best, reward_coins, created_at)
    VALUES ('ans_1', 'dbt_1', 'usr_priya', 'Because the instantaneous velocity of the point of contact with the ground is zero (v_cm - omega*R = 0), so infinitesimal displacement dS = 0 and dW = f . dS = 0.', 0, 0, ?)
  `).run(now);
  db.prepare(`
    INSERT INTO user_exams (user_id, exam_name, exam_date, reminder_days, updated_at)
    VALUES ('usr_arjun', 'JEE Main & Adv', ?, 14, ?)
  `).run(examSoon, now);
  db.prepare(`
    INSERT INTO user_achievements (user_id, achievement_key, unlocked_at)
    VALUES ('usr_arjun', 'first_unlock', ?)
  `).run(now);
  const insertSearch = db.prepare(`INSERT INTO search_logs (id, query, results_count, created_at) VALUES (?, ?, ?, ?)`);
  insertSearch.run("sl_1", "thermodynamics", 0, now);
  insertSearch.run("sl_2", "electrochemistry pyq", 0, now);
  insertSearch.run("sl_3", "electrochemistry pyq", 0, now);
  insertSearch.run("sl_4", "microprocessors 8085", 0, now);
  insertSearch.run("sl_5", "dijkstra", 1, now);
  const insertRoom = db.prepare(`
    INSERT INTO chat_rooms (id, slug, name, category, description)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertRoom.run("room_lounge", "study-lounge", "Study Lounge", "Global", "Open room for study motivation, quick tips, and note recommendations.");
  insertRoom.run("room_jee", "jee", "JEE Main & Adv", "Exam", "Physics, Calculus, Organic Chemistry, and JEE mock test prep.");
  insertRoom.run("room_neet", "neet", "NEET & Class 12", "Exam", "NCERT Biology, Chemistry, and Class 12 board revision.");
  insertRoom.run("room_gate", "gate-cs", "GATE CS & B.Tech", "Subject", "DSA, OS, DBMS, System Design, and placement preparation.");
  insertRoom.run("room_upsc", "upsc-cuet", "UPSC & CUET", "Exam", "Polity, History, Current Affairs, and CUET UG prep.");
  db.prepare(`
    INSERT INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
    VALUES ('dm_arjun_priya', 'usr_arjun', 'usr_priya', 'usr_arjun', 'accepted', ?)
  `).run(threeDaysAgo);
  const insertMsg = db.prepare(`
    INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMsg.run(
    "msg_seed_1",
    "room_lounge",
    "usr_priya",
    "text",
    "Hey everyone! Just uploaded the Rotational Motion free starter pack if anyone wants quick JEE formulas.",
    "{}",
    JSON.stringify(["usr_arjun", "usr_priya"]),
    now
  );
  insertMsg.run(
    "msg_seed_2",
    "room_lounge",
    "usr_arjun",
    "note_card",
    "Sharing a helpful starter note!",
    JSON.stringify({
      noteId: "note_sample_physics",
      title: "Rotational Motion & Moment of Inertia \u2014 Free Starter Pack",
      subject: "Physics",
      priceCoins: 0,
      coverImage: "/src/assets/images/cover_physics_notes_1795530739360.jpg"
    }),
    JSON.stringify(["usr_arjun", "usr_priya"]),
    now
  );
  insertMsg.run(
    "msg_seed_3",
    "dm_arjun_priya",
    "usr_priya",
    "text",
    "Thanks for reviewing my Rotational Motion notes, Arjun!",
    "{}",
    JSON.stringify(["usr_arjun", "usr_priya"]),
    now
  );
  db.prepare(`
    INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
    VALUES ('notif_1', 'usr_arjun', 'Welcome to NoteSwap!', 'You received 10 Coins on signup. Try the Daily Spin Wheel, AI Study Kit, or Live Study Lounge!', 0, ?)
  `).run(now);
}

// server/routes/admin.ts
import crypto4 from "node:crypto";
import express2 from "express";

// server/achievements.ts
var ACHIEVEMENTS = [
  {
    key: "first_unlock",
    title: "First Note Unlocked",
    description: "Unlocked your very first study note on NoteSwap.",
    icon: "\u{1F4D6}"
  },
  {
    key: "first_upload",
    title: "Knowledge Sharer",
    description: "Had your first uploaded study note approved.",
    icon: "\u{1F4DD}"
  },
  {
    key: "streak_7",
    title: "7-Day Scholar Streak",
    description: "Claimed daily study Coins for 7 consecutive days.",
    icon: "\u{1F525}"
  },
  {
    key: "quiz_master",
    title: "Quiz Ace",
    description: "Scored 4/5 or higher on an AI Note Quiz.",
    icon: "\u{1F9E0}"
  },
  {
    key: "doubt_helper",
    title: "Doubt Buster",
    description: "Earned a best-answer Coin reward in the Doubt Forum.",
    icon: "\u{1F4A1}"
  },
  {
    key: "collector_5",
    title: "Library Builder",
    description: "Collected 5 or more notes in your Library.",
    icon: "\u{1F3DB}\uFE0F"
  },
  {
    key: "top_earner_50",
    title: "50+ Coins Earned",
    description: "Earned 50+ lifetime Coins from notes, quizzes, and streaks.",
    icon: "\u{1FA99}"
  }
];
function checkAndUnlockAchievements(userId) {
  const existing = new Set(
    db.prepare("SELECT achievement_key FROM user_achievements WHERE user_id = ?").all(userId).map((r) => r.achievement_key)
  );
  const user = db.prepare("SELECT streak_days, coins_earned_total FROM users WHERE id = ?").get(userId);
  if (!user) return [];
  const unlockCount = db.prepare("SELECT COUNT(*) as c FROM purchases WHERE buyer_id = ? AND refunded = 0").get(userId).c;
  const approvedUploads = db.prepare("SELECT COUNT(*) as c FROM notes WHERE uploader_id = ? AND status = 'approved'").get(userId).c;
  const quizWins = db.prepare("SELECT COUNT(*) as c FROM quiz_attempts WHERE user_id = ? AND reward_coins > 0").get(userId).c;
  const bestAnswers = db.prepare("SELECT COUNT(*) as c FROM doubt_answers WHERE user_id = ? AND is_best = 1").get(userId).c;
  const checks = {
    first_unlock: unlockCount >= 1,
    first_upload: approvedUploads >= 1,
    streak_7: user.streak_days >= 7,
    quiz_master: quizWins >= 1,
    doubt_helper: bestAnswers >= 1,
    collector_5: unlockCount >= 5,
    top_earner_50: user.coins_earned_total >= 50
  };
  const newlyUnlocked = [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_achievements (user_id, achievement_key, unlocked_at) VALUES (?, ?, ?)"
  );
  for (const def of ACHIEVEMENTS) {
    if (!existing.has(def.key) && checks[def.key]) {
      insert.run(userId, def.key, now);
      newlyUnlocked.push(def);
    }
  }
  return newlyUnlocked;
}

// server/ws.ts
import { WebSocket } from "ws";

// server/security.ts
import crypto2 from "node:crypto";
var SERVER_SECRET = process.env.SESSION_SECRET?.trim() || crypto2.randomBytes(32).toString("hex");
var SESSION_COOKIE_NAME = "ns_session";
function hashPassword(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const hash = crypto2.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const derived = crypto2.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(derived, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto2.timingSafeEqual(a, b);
}
function hashOtp(otp, email) {
  return crypto2.createHmac("sha256", SERVER_SECRET).update(`${email.toLowerCase()}:${otp}`).digest("hex");
}
function signSessionToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto2.createHmac("sha256", SERVER_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifySessionToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = crypto2.createHmac("sha256", SERVER_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto2.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed?.uid !== "string" || typeof parsed?.exp !== "number") return null;
    if (parsed.exp < Math.floor(Date.now() / 1e3)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function setSessionCookie(req, res, token) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const isHttps = String(proto).includes("https");
  const maxAgeSec = 7 * 24 * 60 * 60;
  if (isHttps) {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  } else {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`
    );
  }
}
function clearSessionCookie(req, res) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const isHttps = String(proto).includes("https");
  if (isHttps) {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
    );
  } else {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
    );
  }
}
function parseCookieToken(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}
var rateBuckets = /* @__PURE__ */ new Map();
function createRateLimiter(action, maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${action}:${ip}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (hits.length >= maxRequests) {
      res.status(429).json({
        error: "Too many requests. Please wait a moment and try again."
      });
      return;
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    next();
  };
}
function csrfProtection(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const hasCustomHeader = req.headers["x-requested-with"] === "NoteSwap";
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
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
    }
  }
  res.status(403).json({ error: "Blocked by CSRF protection" });
}

// server/ws.ts
var userSockets = /* @__PURE__ */ new Map();
var roomSubscriptions = /* @__PURE__ */ new Map();
function getOnlineUserIds() {
  return Array.from(userSockets.keys());
}
function broadcastToRoom(roomId, event) {
  const subs = roomSubscriptions.get(roomId);
  if (!subs) return;
  const payload = JSON.stringify(event);
  for (const sock of subs) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(payload);
    }
  }
}
function broadcastToUser(userId, event) {
  const socks = userSockets.get(userId);
  if (!socks) return;
  const payload = JSON.stringify(event);
  for (const sock of socks) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(payload);
    }
  }
}
function broadcastPresence() {
  const payload = JSON.stringify({
    type: "presence:update",
    onlineUserIds: getOnlineUserIds()
  });
  for (const socks of userSockets.values()) {
    for (const sock of socks) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(payload);
      }
    }
  }
}
function subscribeRoom(sock, roomId) {
  if (!sock.rooms) sock.rooms = /* @__PURE__ */ new Set();
  sock.rooms.add(roomId);
  let set = roomSubscriptions.get(roomId);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    roomSubscriptions.set(roomId, set);
  }
  set.add(sock);
}
function unsubscribeAll(sock) {
  if (sock.rooms) {
    for (const roomId of sock.rooms) {
      const set = roomSubscriptions.get(roomId);
      if (set) {
        set.delete(sock);
        if (set.size === 0) roomSubscriptions.delete(roomId);
      }
    }
    sock.rooms.clear();
  }
  if (sock.userId) {
    const set = userSockets.get(sock.userId);
    if (set) {
      set.delete(sock);
      if (set.size === 0) userSockets.delete(sock.userId);
    }
  }
}
function canJoinRoom(userId, roomId) {
  if (roomId.startsWith("room_")) return true;
  const thread = db.prepare("SELECT user_a, user_b FROM dm_threads WHERE id = ?").get(roomId);
  return Boolean(thread && (thread.user_a === userId || thread.user_b === userId));
}
function setupWebSocketHub(wss) {
  wss.on("connection", (ws, req) => {
    const cookieToken = parseCookieToken(req);
    const session = cookieToken ? verifySessionToken(cookieToken) : null;
    if (!session) {
      ws.close(4001, "Unauthorized");
      return;
    }
    const user = db.prepare("SELECT id, name, auth_provider, is_banned FROM users WHERE id = ?").get(session.uid);
    if (!user || user.is_banned || user.auth_provider !== "google") {
      ws.close(4003, "Google sign-in required for chat");
      return;
    }
    ws.userId = user.id;
    let set = userSockets.get(user.id);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      userSockets.set(user.id, set);
    }
    set.add(ws);
    ws.send(JSON.stringify({ type: "presence:update", onlineUserIds: getOnlineUserIds() }));
    broadcastPresence();
    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(String(raw));
        if (data?.type === "room:join" && typeof data.roomId === "string") {
          if (canJoinRoom(user.id, data.roomId)) {
            subscribeRoom(ws, data.roomId);
          }
        } else if (data?.type === "typing:start" && typeof data.roomId === "string") {
          if (canJoinRoom(user.id, data.roomId)) {
            broadcastToRoom(data.roomId, {
              type: "typing:update",
              roomId: data.roomId,
              userId: user.id,
              userName: user.name,
              isTyping: true
            });
          }
        } else if (data?.type === "typing:stop" && typeof data.roomId === "string") {
          if (canJoinRoom(user.id, data.roomId)) {
            broadcastToRoom(data.roomId, {
              type: "typing:update",
              roomId: data.roomId,
              userId: user.id,
              userName: user.name,
              isTyping: false
            });
          }
        }
      } catch {
      }
    });
    ws.on("close", () => {
      unsubscribeAll(ws);
      broadcastPresence();
    });
  });
}

// server/routes/auth.ts
import crypto3 from "node:crypto";
import express from "express";
function attachOptionalUser(req, _res, next) {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : null;
  const cookieToken = parseCookieToken(req);
  const token = bearer || cookieToken;
  if (token) {
    const parsed = verifySessionToken(token);
    if (parsed) {
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(parsed.uid);
      if (user && !user.is_banned) {
        req.user = user;
      }
    }
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Please sign in to continue" });
    return;
  }
  if (req.user.is_banned) {
    res.status(403).json({ error: "Your account has been suspended" });
    return;
  }
  next();
}
function requireGoogleAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Google sign-in is required" });
    return;
  }
  if (req.user.auth_provider !== "google") {
    res.status(403).json({ error: "Live Chat requires Google sign-in" });
    return;
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Admin sign-in required" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin privileges required" });
    return;
  }
  next();
}
function serializeProfile(user) {
  const approvedUploads = db.prepare("SELECT COUNT(*) as c FROM notes WHERE uploader_id = ? AND status = 'approved'").get(user.id).c;
  const levelInfo = getCreatorLevel(approvedUploads);
  const unlockedAchievements = db.prepare("SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = ?").all(user.id).map((row) => ({
    ...row,
    ...ACHIEVEMENTS.find((a) => a.key === row.achievement_key) || {}
  }));
  const ownedItems = db.prepare(
    `SELECT s.* FROM shop_items s
         JOIN user_inventory ui ON ui.item_id = s.id
         WHERE ui.user_id = ?`
  ).all(user.id);
  const unreadNotifications = db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0").get(user.id).c;
  const exam = db.prepare("SELECT exam_name, exam_date, reminder_days FROM user_exams WHERE user_id = ?").get(user.id);
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const examCountdown = exam ? {
    ...exam,
    daysLeft: calculateExamCountdownDays(exam.exam_date, todayStr)
  } : null;
  const pendingDmRequests = db.prepare(
    `SELECT COUNT(*) as c FROM dm_threads
         WHERE (user_a = ? OR user_b = ?) AND requester_id != ? AND status = 'pending'`
  ).get(user.id, user.id, user.id).c;
  const completedUnlocks = db.prepare("SELECT COUNT(*) as c FROM purchases WHERE buyer_id = ? AND refunded = 0").get(user.id).c;
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
    createdAt: user.created_at
  };
}
function createAuthRouter() {
  const router = express.Router();
  const otpLimiter = createRateLimiter("otp", 10, 10 * 60 * 1e3);
  const authLimiter = createRateLimiter("auth", 20, 10 * 60 * 1e3);
  router.get("/me", (req, res) => {
    const passcodeSet = Boolean(process.env.ADMIN_PASSCODE?.trim());
    const claimedHash = db.prepare("SELECT value FROM app_settings WHERE key = 'admin_passcode_hash'").get();
    res.json({
      user: req.user ? serializeProfile(req.user) : null,
      googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
      adminSetupRequired: !passcodeSet && !claimedHash
    });
  });
  router.post("/google", authLimiter, async (req, res) => {
    const { idToken, googleId, email, name, referralCode, isMinor } = req.body || {};
    const deviceId = String(req.headers["x-device-id"] || "").slice(0, 64);
    let verifiedGoogleId = "";
    let verifiedEmail = "";
    let verifiedName = "";
    const configuredClientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (configuredClientId && typeof idToken === "string" && idToken.length > 20) {
      try {
        const resp = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
        );
        if (!resp.ok) {
          res.status(401).json({ error: "Invalid Google token" });
          return;
        }
        const info = await resp.json();
        if (info.aud !== configuredClientId || !info.sub || !info.email) {
          res.status(401).json({ error: "Google token audience mismatch" });
          return;
        }
        verifiedGoogleId = info.sub;
        verifiedEmail = info.email.toLowerCase();
        verifiedName = info.name || info.email.split("@")[0];
      } catch {
        res.status(502).json({ error: "Unable to verify Google token right now" });
        return;
      }
    } else {
      if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        res.status(400).json({ error: "Valid Google email is required" });
        return;
      }
      verifiedEmail = email.trim().toLowerCase();
      verifiedGoogleId = typeof googleId === "string" && googleId.trim() ? googleId.trim().slice(0, 80) : `google_${crypto3.createHash("sha256").update(verifiedEmail).digest("hex").slice(0, 16)}`;
      verifiedName = typeof name === "string" && name.trim().length >= 2 ? name.trim().slice(0, 48) : verifiedEmail.split("@")[0];
    }
    const existing = db.prepare("SELECT * FROM users WHERE google_id = ? OR email = ?").get(verifiedGoogleId, verifiedEmail);
    if (existing) {
      if (existing.is_banned) {
        res.status(403).json({ error: "This account has been suspended" });
        return;
      }
      if (!existing.google_id) {
        db.prepare("UPDATE users SET google_id = ?, auth_provider = 'google' WHERE id = ?").run(
          verifiedGoogleId,
          existing.id
        );
      }
      if (deviceId && !existing.device_id) {
        db.prepare("UPDATE users SET device_id = ? WHERE id = ?").run(deviceId, existing.id);
      }
      const refreshed = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
      const token2 = signSessionToken({
        uid: refreshed.id,
        role: refreshed.role,
        exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
      });
      setSessionCookie(req, res, token2);
      res.json({ user: serializeProfile(refreshed), isNewUser: false });
      return;
    }
    const newUserId = `usr_${crypto3.randomUUID().slice(0, 10)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const refCode = generateReferralCode(verifiedName, newUserId.slice(-4));
    const cleanReferredBy = typeof referralCode === "string" && referralCode.trim() ? normalizeCode(referralCode) : null;
    let referrerId = null;
    if (cleanReferredBy) {
      const refUser = db.prepare("SELECT id FROM users WHERE referral_code = ?").get(cleanReferredBy);
      if (refUser) referrerId = refUser.id;
    }
    const createTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (
          id, google_id, auth_provider, name, email, role, is_minor, device_id,
          coins_balance, coins_earned_total, referral_code, referred_by, created_at
        ) VALUES (?, ?, 'google', ?, ?, 'student', ?, ?, ?, ?, ?, ?, ?)`
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
        now
      );
      db.prepare(
        `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
         VALUES (?, ?, 'earned', 'welcome_bonus', ?, ?, 'google_signup', ?)`
      ).run(
        `tx_${crypto3.randomUUID().slice(0, 10)}`,
        newUserId,
        WELCOME_BONUS_COINS,
        `Welcome bonus (+${WELCOME_BONUS_COINS} Coins on first Google login)`,
        now
      );
      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
         VALUES (?, ?, 'welcome_bonus', 'user', ?, ?, ?, ?)`
      ).run(
        `aud_${crypto3.randomUUID().slice(0, 10)}`,
        newUserId,
        newUserId,
        WELCOME_BONUS_COINS,
        JSON.stringify({ email: verifiedEmail, referredBy: referrerId }),
        now
      );
      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`
      ).run(
        `ntf_${crypto3.randomUUID().slice(0, 10)}`,
        newUserId,
        "Welcome to NoteSwap!",
        referrerId ? `You received \u{1FA99}${WELCOME_BONUS_COINS} welcome bonus! Unlock your first note to earn \u{1FA99}${REFERRAL_BONUS_COINS} referral Coins for both you and your friend.` : `You received \u{1FA99}${WELCOME_BONUS_COINS} welcome bonus on first Google login. Check out Free Sample notes to start!`,
        now
      );
    });
    createTx();
    const created = db.prepare("SELECT * FROM users WHERE id = ?").get(newUserId);
    const token = signSessionToken({
      uid: created.id,
      role: created.role,
      exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
    });
    setSessionCookie(req, res, token);
    res.status(201).json({ user: serializeProfile(created), isNewUser: true, welcomeCoins: WELCOME_BONUS_COINS });
  });
  router.post("/otp/request", otpLimiter, (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid email address" });
      return;
    }
    const otp = String(crypto3.randomInt(1e5, 999999));
    const otpHash = hashOtp(otp, email);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1e3).toISOString();
    db.prepare(
      `INSERT INTO otp_challenges (email, otp_hash, expires_at, attempts)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET otp_hash = excluded.otp_hash, expires_at = excluded.expires_at, attempts = 0`
    ).run(email, otpHash, expiresAt);
    const isProd = process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_OTP !== "true";
    res.json({
      sent: true,
      message: "6-digit verification code generated (expires in 5 minutes).",
      previewOtp: isProd ? void 0 : otp
    });
  });
  router.post("/otp/verify", otpLimiter, (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();
    const name = String(req.body?.name || "").trim();
    if (!email || !/^\d{6}$/.test(otp)) {
      res.status(400).json({ error: "Enter a valid email and 6-digit OTP" });
      return;
    }
    const challenge = db.prepare("SELECT * FROM otp_challenges WHERE email = ?").get(email);
    if (!challenge || Date.parse(challenge.expires_at) < Date.now()) {
      res.status(400).json({ error: "OTP expired. Request a new code." });
      return;
    }
    if (challenge.attempts >= 5) {
      res.status(429).json({ error: "Too many wrong OTP attempts. Request a new code." });
      return;
    }
    if (hashOtp(otp, email) !== challenge.otp_hash) {
      db.prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE email = ?").run(email);
      res.status(400).json({ error: "Incorrect verification code" });
      return;
    }
    db.prepare("DELETE FROM otp_challenges WHERE email = ?").run(email);
    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) {
      const id = `usr_${crypto3.randomUUID().slice(0, 10)}`;
      const displayName = name || email.split("@")[0];
      const refCode = generateReferralCode(displayName, id.slice(-4));
      db.prepare(
        `INSERT INTO users (id, google_id, auth_provider, name, email, role, coins_balance, coins_earned_total, referral_code, created_at)
         VALUES (?, NULL, 'otp', ?, ?, 'student', 5, 5, ?, ?)`
      ).run(id, displayName, email, refCode, (/* @__PURE__ */ new Date()).toISOString());
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    }
    if (user.is_banned) {
      res.status(403).json({ error: "This account has been suspended" });
      return;
    }
    const token = signSessionToken({
      uid: user.id,
      role: user.role,
      exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
    });
    setSessionCookie(req, res, token);
    res.json({ user: serializeProfile(user) });
  });
  router.post("/demo-student", authLimiter, (req, res) => {
    const accountId = req.body?.userId === "usr_priya" ? "usr_priya" : "usr_arjun";
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(accountId);
    if (!user) {
      res.status(404).json({ error: "Demo user not found" });
      return;
    }
    const token = signSessionToken({
      uid: user.id,
      role: user.role,
      exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
    });
    setSessionCookie(req, res, token);
    res.json({ user: serializeProfile(user) });
  });
  router.post("/admin-login", authLimiter, (req, res) => {
    const passcode = String(req.body?.passcode || "");
    if (passcode.length < 4) {
      res.status(400).json({ error: "Passcode must be at least 4 characters" });
      return;
    }
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    const storedHashRow = db.prepare("SELECT value FROM app_settings WHERE key = 'admin_passcode_hash'").get();
    if (envPasscode) {
      const a = Buffer.from(passcode);
      const b = Buffer.from(envPasscode);
      if (a.length !== b.length || !crypto3.timingSafeEqual(a, b)) {
        res.status(403).json({ error: "Incorrect admin passcode" });
        return;
      }
    } else if (storedHashRow) {
      if (!verifyPassword(passcode, storedHashRow.value)) {
        res.status(403).json({ error: "Incorrect admin passcode" });
        return;
      }
    } else {
      const hash = hashPassword(passcode);
      db.prepare("INSERT INTO app_settings (key, value) VALUES ('admin_passcode_hash', ?)").run(hash);
    }
    const adminUser = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
    if (!adminUser) {
      res.status(404).json({ error: "Admin account not found" });
      return;
    }
    const token = signSessionToken({
      uid: adminUser.id,
      role: adminUser.role,
      exp: Math.floor(Date.now() / 1e3) + 7 * 24 * 60 * 60
    });
    setSessionCookie(req, res, token);
    res.json({ user: serializeProfile(adminUser) });
  });
  router.put("/profile", requireAuth, (req, res) => {
    const user = req.user;
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 48) : user.name;
    const isMinor = typeof req.body?.isMinor === "boolean" ? req.body.isMinor ? 1 : 0 : user.is_minor;
    if (name.length < 2) {
      res.status(400).json({ error: "Display name must be at least 2 characters" });
      return;
    }
    db.prepare("UPDATE users SET name = ?, is_minor = ? WHERE id = ?").run(name, isMinor, user.id);
    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    res.json({ user: serializeProfile(updated) });
  });
  router.post("/logout", (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });
  return router;
}

// server/routes/admin.ts
function createAdminRouter() {
  const router = express2.Router();
  router.use(requireAdmin);
  router.get("/dashboard", (_req, res) => {
    const totalUnlocks = db.prepare("SELECT COUNT(*) as c FROM purchases WHERE refunded = 0").get().c;
    const totalStudents = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student'").get().c;
    const pendingNotes = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status = 'pending'").get().c;
    const openNoteReports = db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'open'").get().c;
    const openChatReports = db.prepare("SELECT COUNT(*) as c FROM chat_reports WHERE status = 'open'").get().c;
    const pendingRefunds = db.prepare("SELECT COUNT(*) as c FROM refund_requests WHERE status = 'pending'").get().c;
    const coinsBurnedTotal = Number(
      db.prepare("SELECT value FROM app_settings WHERE key = 'coins_burned_total'").get()?.value || 0
    );
    const coinsCirculating = db.prepare("SELECT COALESCE(SUM(coins_balance), 0) as s FROM users").get().s;
    const topSubjects = db.prepare(
      `SELECT subject, COUNT(*) as noteCount, COALESCE(SUM(sales_count), 0) as totalUnlocks
         FROM notes
         WHERE status = 'approved'
         GROUP BY subject
         ORDER BY totalUnlocks DESC, noteCount DESC
         LIMIT 6`
    ).all();
    const zeroResultSearches = db.prepare(
      `SELECT query, COUNT(*) as searchCount
         FROM search_logs
         WHERE results_count = 0
         GROUP BY query
         ORDER BY searchCount DESC
         LIMIT 8`
    ).all();
    const hourRows = db.prepare(
      `SELECT CAST(strftime('%H', created_at) AS INTEGER) as hr, COUNT(*) as cnt
         FROM (
           SELECT created_at FROM purchases
           UNION ALL SELECT created_at FROM search_logs
           UNION ALL SELECT created_at FROM chat_messages
         )
         GROUP BY hr
         ORDER BY hr ASC`
    ).all();
    const peakHours = Array.from({ length: 24 }, (_, hr) => ({
      hour: hr,
      count: hourRows.find((r) => r.hr === hr)?.cnt || 0
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
        coinsCirculating
      },
      analytics: {
        topSubjects,
        zeroResultSearches,
        peakHours
      }
    });
  });
  router.get("/queue", (_req, res) => {
    const notes = db.prepare(
      `SELECT n.*, u.name as uploader_name, u.email as uploader_email
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE n.status IN ('pending', 'hidden_review')
         ORDER BY n.created_at ASC`
    ).all();
    res.json({ queue: notes });
  });
  router.post("/notes/:id/review", (req, res) => {
    const decision = req.body?.decision === "approve" ? "approved" : "rejected";
    const rejectionReason = String(req.body?.rejectionReason || "").trim().slice(0, 300);
    const rewardCoins = parsePositiveIntCoins(req.body?.uploadRewardCoins ?? 2);
    if (decision === "approved") {
      if (rewardCoins === null) {
        res.status(400).json({ error: "Invalid upload reward amount" });
        return;
      }
      const err = validateUploadRewardCoins(rewardCoins);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    } else if (rejectionReason.length < 5) {
      res.status(400).json({ error: "Provide a clear rejection reason (5+ characters)" });
      return;
    }
    const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.transaction(() => {
      if (decision === "approved") {
        const appliedReward = note.status === "pending" ? rewardCoins : 0;
        db.prepare(
          "UPDATE notes SET status = 'approved', rejection_reason = '', upload_reward_coins = ? WHERE id = ?"
        ).run(appliedReward, note.id);
        if (appliedReward > 0) {
          db.prepare(
            "UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?"
          ).run(appliedReward, appliedReward, note.uploader_id);
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'upload_reward', ?, ?, ?, ?)`
          ).run(
            `tx_${crypto4.randomUUID().slice(0, 10)}`,
            note.uploader_id,
            appliedReward,
            `Upload reward for "${note.title}"`,
            note.id,
            now
          );
        }
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Note Approved!', ?, 0, ?)`
        ).run(
          `ntf_${crypto4.randomUUID().slice(0, 10)}`,
          note.uploader_id,
          `Your note "${note.title}" is now live${appliedReward > 0 ? ` (+\u{1FA99}${appliedReward} reward!)` : "."}`,
          now
        );
      } else {
        db.prepare("UPDATE notes SET status = 'rejected', rejection_reason = ? WHERE id = ?").run(
          rejectionReason,
          note.id
        );
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Note Rejected', ?, 0, ?)`
        ).run(
          `ntf_${crypto4.randomUUID().slice(0, 10)}`,
          note.uploader_id,
          `"${note.title}" was rejected: ${rejectionReason}`,
          now
        );
      }
      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
         VALUES (?, ?, ?, 'note', ?, ?, ?, ?)`
      ).run(
        `aud_${crypto4.randomUUID().slice(0, 10)}`,
        req.user.id,
        `admin_note_${decision}`,
        note.id,
        decision === "approved" ? rewardCoins : 0,
        JSON.stringify({ rejectionReason }),
        now
      );
    })();
    if (decision === "approved") {
      checkAndUnlockAchievements(note.uploader_id);
    }
    res.json({ ok: true, status: decision });
  });
  router.get("/redeem-codes", (_req, res) => {
    const codes = db.prepare("SELECT * FROM redeem_codes ORDER BY created_at DESC").all();
    res.json({ codes });
  });
  router.post("/redeem-codes", (req, res) => {
    const code = normalizeCode(String(req.body?.code || ""));
    const valueCoins = parsePositiveIntCoins(req.body?.valueCoins);
    const usageLimit = parsePositiveIntCoins(req.body?.usageLimit);
    const expiresAt = String(req.body?.expiresAt || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 80);
    if (code.length < 3 || !valueCoins || valueCoins < 1 || !usageLimit || usageLimit < 1 || !expiresAt) {
      res.status(400).json({ error: "Provide a valid code, coin value (>=1), usage limit, and expiry date" });
      return;
    }
    try {
      const id = `rc_${crypto4.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO redeem_codes (id, code, value_coins, usage_limit, used_count, per_user_limit, expires_at, note, is_active, created_at)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, 1, ?)`
      ).run(id, code, valueCoins, usageLimit, new Date(expiresAt).toISOString(), note, (/* @__PURE__ */ new Date()).toISOString());
      res.status(201).json({ ok: true, id });
    } catch {
      res.status(409).json({ error: "A redeem code with this name already exists" });
    }
  });
  router.post("/redeem-codes/:id/toggle", (req, res) => {
    db.prepare("UPDATE redeem_codes SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?").run(
      req.params.id
    );
    res.json({ ok: true });
  });
  router.post("/bundles", (req, res) => {
    const title = String(req.body?.title || "").trim().slice(0, 100);
    const description = String(req.body?.description || "").trim().slice(0, 240);
    const bundlePriceCoins = parsePositiveIntCoins(req.body?.bundlePriceCoins);
    const noteIds = Array.isArray(req.body?.noteIds) ? req.body.noteIds : [];
    if (title.length < 4 || !bundlePriceCoins || bundlePriceCoins < 5 || noteIds.length < 2) {
      res.status(400).json({ error: "Bundle requires a title, >= 5 Coins price, and at least 2 Gemini Notes" });
      return;
    }
    const id = `bnd_${crypto4.randomUUID().slice(0, 10)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO gemini_bundles (id, title, description, bundle_price_coins, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      ).run(id, title, description || "Discounted Official Gemini Bundle", bundlePriceCoins, now);
      const ins = db.prepare("INSERT OR IGNORE INTO gemini_bundle_items (bundle_id, note_id) VALUES (?, ?)");
      for (const nid of noteIds) {
        ins.run(id, nid);
      }
    })();
    res.status(201).json({ ok: true, id });
  });
  router.post("/gemini-requests/:id/fulfill", (req, res) => {
    db.prepare("UPDATE gemini_requests SET status = 'fulfilled' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });
  router.get("/refunds", (_req, res) => {
    const refunds = db.prepare(
      `SELECT rr.*, n.title as note_title, p.price_coins, p.uploader_coins, u.name as buyer_name
         FROM refund_requests rr
         JOIN purchases p ON p.id = rr.purchase_id
         JOIN notes n ON n.id = rr.note_id
         JOIN users u ON u.id = rr.buyer_id
         ORDER BY rr.status ASC, rr.created_at DESC`
    ).all();
    res.json({ refunds });
  });
  router.post("/refunds/:id/process", (req, res) => {
    const approve = req.body?.approve === true;
    const adminNote = String(req.body?.adminNote || "").trim().slice(0, 200);
    const rfd = db.prepare("SELECT * FROM refund_requests WHERE id = ?").get(req.params.id);
    if (!rfd || rfd.status !== "pending") {
      res.status(404).json({ error: "Pending refund request not found" });
      return;
    }
    const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(rfd.purchase_id);
    const note = db.prepare("SELECT uploader_id, title FROM notes WHERE id = ?").get(rfd.note_id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.transaction(() => {
      db.prepare("UPDATE refund_requests SET status = ?, admin_note = ?, processed_at = ? WHERE id = ?").run(
        approve ? "approved" : "rejected",
        adminNote,
        now,
        rfd.id
      );
      if (approve) {
        db.prepare("UPDATE purchases SET refunded = 1 WHERE id = ?").run(purchase.id);
        db.prepare("UPDATE users SET coins_balance = coins_balance + ? WHERE id = ?").run(
          purchase.price_coins,
          rfd.buyer_id
        );
        if (purchase.uploader_coins > 0) {
          db.prepare("UPDATE users SET coins_balance = MAX(0, coins_balance - ?) WHERE id = ?").run(
            purchase.uploader_coins,
            note.uploader_id
          );
        }
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'coin_refund', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto4.randomUUID().slice(0, 10)}`,
          rfd.buyer_id,
          purchase.price_coins,
          `24h Coin refund approved for "${note.title}"`,
          rfd.id,
          now
        );
      }
      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`
      ).run(
        `ntf_${crypto4.randomUUID().slice(0, 10)}`,
        rfd.buyer_id,
        approve ? "Coin Refund Approved" : "Refund Request Declined",
        approve ? `+\u{1FA99}${purchase.price_coins} returned to your balance for "${note.title}".` : `Your refund request for "${note.title}" was declined.${adminNote ? ` Note: ${adminNote}` : ""}`,
        now
      );
      db.prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
         VALUES (?, ?, ?, 'refund_request', ?, ?, ?, ?)`
      ).run(
        `aud_${crypto4.randomUUID().slice(0, 10)}`,
        req.user.id,
        approve ? "refund_approved" : "refund_rejected",
        rfd.id,
        approve ? purchase.price_coins : 0,
        JSON.stringify({ adminNote }),
        now
      );
    })();
    res.json({ ok: true });
  });
  router.get("/reports", (_req, res) => {
    const noteReports = db.prepare(
      `SELECT r.*, n.title as note_title, n.status as note_status, u.name as reporter_name
         FROM reports r
         JOIN notes n ON n.id = r.note_id
         JOIN users u ON u.id = r.reporter_id
         ORDER BY r.status ASC, r.created_at DESC`
    ).all();
    const chatReports = db.prepare(
      `SELECT cr.*, cm.body as message_body, cm.is_deleted,
         ru.name as reported_user_name, ru.is_chat_muted, ru.is_banned,
         rep.name as reporter_name
         FROM chat_reports cr
         JOIN chat_messages cm ON cm.id = cr.message_id
         JOIN users ru ON ru.id = cr.reported_user_id
         JOIN users rep ON rep.id = cr.reporter_id
         ORDER BY cr.status ASC, cr.created_at DESC`
    ).all();
    const suspiciousTransfers = db.prepare(
      `SELECT ct.*, su.name as sender_name, ru.name as receiver_name
         FROM coin_transfers ct
         JOIN users su ON su.id = ct.sender_id
         JOIN users ru ON ru.id = ct.receiver_id
         WHERE ct.flagged_suspicious = 1
         ORDER BY ct.created_at DESC
         LIMIT 30`
    ).all();
    res.json({ noteReports, chatReports, suspiciousTransfers });
  });
  router.post("/reports/note/:id/resolve", (req, res) => {
    const action = String(req.body?.action || "dismiss");
    const rep = db.prepare("SELECT note_id FROM reports WHERE id = ?").get(req.params.id);
    if (!rep) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    db.transaction(() => {
      db.prepare("UPDATE reports SET status = 'resolved' WHERE note_id = ?").run(rep.note_id);
      if (action === "remove_note") {
        db.prepare("UPDATE notes SET status = 'rejected', rejection_reason = 'Removed after moderation review' WHERE id = ?").run(
          rep.note_id
        );
      } else {
        db.prepare("UPDATE notes SET status = 'approved', report_count = 0 WHERE id = ?").run(rep.note_id);
      }
    })();
    res.json({ ok: true });
  });
  router.post("/reports/chat/:id/resolve", (req, res) => {
    const action = String(req.body?.action || "dismiss");
    const crep = db.prepare("SELECT * FROM chat_reports WHERE id = ?").get(req.params.id);
    if (!crep) {
      res.status(404).json({ error: "Chat report not found" });
      return;
    }
    db.transaction(() => {
      db.prepare("UPDATE chat_reports SET status = 'resolved' WHERE id = ?").run(crep.id);
      if (action === "delete_msg" || action === "mute_user" || action === "ban_user") {
        db.prepare("UPDATE chat_messages SET is_deleted = 1 WHERE id = ?").run(crep.message_id);
      }
      if (action === "mute_user") {
        db.prepare("UPDATE users SET is_chat_muted = 1 WHERE id = ?").run(crep.reported_user_id);
      }
      if (action === "ban_user") {
        db.prepare("UPDATE users SET is_banned = 1, is_chat_muted = 1 WHERE id = ?").run(crep.reported_user_id);
      }
    })();
    if (action !== "dismiss") {
      broadcastToRoom(crep.room_id, { type: "chat:deleted", messageId: crep.message_id });
    }
    res.json({ ok: true });
  });
  router.get("/users", (_req, res) => {
    const users = db.prepare(
      `SELECT id, name, email, role, auth_provider, is_minor, is_banned, is_chat_muted,
         coins_balance, coins_earned_total, streak_days, created_at
         FROM users
         ORDER BY created_at DESC`
    ).all();
    const auditLogs = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 40").all();
    res.json({ users, auditLogs });
  });
  router.post("/users/:id/status", (req, res) => {
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      res.status(400).json({ error: "You cannot ban or mute yourself" });
      return;
    }
    const action = String(req.body?.action || "");
    if (action === "ban") db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?").run(targetId);
    if (action === "unban") db.prepare("UPDATE users SET is_banned = 0 WHERE id = ?").run(targetId);
    if (action === "mute") db.prepare("UPDATE users SET is_chat_muted = 1 WHERE id = ?").run(targetId);
    if (action === "unmute") db.prepare("UPDATE users SET is_chat_muted = 0, chat_report_count = 0 WHERE id = ?").run(targetId);
    res.json({ ok: true });
  });
  return router;
}

// server/routes/ai.ts
import crypto6 from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import express4 from "express";

// server/routes/notes.ts
import crypto5 from "node:crypto";
import fs3 from "node:fs";
import path3 from "node:path";
import express3 from "express";
import multer from "multer";
var upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    // 10 MB per file
    files: 10
  }
});
function formatNoteSummary(row) {
  const approvedCount = row.uploader_approved_count ?? 0;
  return {
    id: row.id,
    uploaderId: row.uploader_id,
    uploaderName: row.uploader_name || "Student Creator",
    uploaderAvatar: row.uploader_avatar || "scholar",
    uploaderFrame: row.uploader_frame || "none",
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
    pyqYear: row.pyq_year || "",
    previewPagesCount: row.preview_pages_count,
    pageCount: row.page_count,
    fileType: row.file_type,
    coverImage: row.cover_image || `/api/notes/${row.id}/preview`,
    status: row.status,
    rejectionReason: row.rejection_reason || "",
    uploadRewardCoins: row.upload_reward_coins,
    salesCount: row.sales_count,
    totalEarnedCoins: row.total_earned_coins,
    ratingAvg: Number((row.rating_avg || 0).toFixed(1)),
    ratingCount: row.rating_count,
    createdAt: row.created_at
  };
}
function extractNotePlainText(note) {
  const fullPath = resolveSafePrivatePath(note.file_path);
  if (note.file_type === "structured") {
    const pages = JSON.parse(fs3.readFileSync(fullPath, "utf8"));
    return pages.map(
      (p, idx) => `Page ${idx + 1}: ${p.heading}
${p.subheading || ""}
${p.bullets.join("\n")}
Formula: ${p.formula || ""}
Tip: ${p.tip || ""}`
    ).join("\n\n");
  }
  return `Title: ${note.title}
Subject: ${note.subject}
Exam: ${note.exam_class}
Description: ${note.description}`;
}
function userHasFullAccess(userId, note) {
  if (note.is_free_sample === 1) return true;
  if (!userId) return false;
  if (note.uploader_id === userId) return true;
  const userRow = db.prepare("SELECT role FROM users WHERE id = ?").get(userId);
  if (userRow?.role === "admin") return true;
  const purchase = db.prepare("SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0").get(userId, note.id);
  return Boolean(purchase);
}
function createNotesRouter() {
  const router = express3.Router();
  const actionLimiter = createRateLimiter("notes_action", 30, 60 * 1e3);
  router.get("/", (req, res) => {
    const q = String(req.query.q || "").trim();
    const subject = String(req.query.subject || "").trim();
    const examClass = String(req.query.exam || "").trim();
    const section = String(req.query.section || "all").trim();
    let where = "n.status = 'approved'";
    const params = [];
    if (q) {
      where += " AND (n.title LIKE ? OR n.subject LIKE ? OR n.exam_class LIKE ? OR n.description LIKE ? OR n.tags LIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    if (subject && subject !== "All") {
      where += " AND n.subject = ?";
      params.push(subject);
    }
    if (examClass && examClass !== "All") {
      where += " AND n.exam_class LIKE ?";
      params.push(`%${examClass}%`);
    }
    if (section === "free") where += " AND n.is_free_sample = 1";
    if (section === "gemini") where += " AND n.is_gemini_note = 1";
    if (section === "pyq") where += " AND n.is_pyq = 1";
    let orderBy = "n.created_at DESC";
    if (section === "trending") orderBy = "n.sales_count DESC, n.rating_avg DESC";
    if (section === "top_rated") orderBy = "n.rating_avg DESC, n.rating_count DESC";
    const rows = db.prepare(
      `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT 60`
    ).all(...params);
    if (q.length >= 2) {
      db.prepare(
        "INSERT INTO search_logs (id, query, results_count, created_at) VALUES (?, ?, ?, ?)"
      ).run(`sl_${crypto5.randomUUID().slice(0, 10)}`, q.toLowerCase().slice(0, 80), rows.length, (/* @__PURE__ */ new Date()).toISOString());
    }
    const userId = req.user?.id;
    const bookmarkedIds = userId ? new Set(
      db.prepare("SELECT note_id FROM bookmarks WHERE user_id = ?").all(userId).map((r) => r.note_id)
    ) : /* @__PURE__ */ new Set();
    const unlockedIds = userId ? new Set(
      db.prepare("SELECT note_id FROM purchases WHERE buyer_id = ? AND refunded = 0").all(userId).map((r) => r.note_id)
    ) : /* @__PURE__ */ new Set();
    res.json({
      notes: rows.map((r) => ({
        ...formatNoteSummary(r),
        isBookmarked: bookmarkedIds.has(r.id),
        isUnlocked: r.is_free_sample === 1 || r.uploader_id === userId || unlockedIds.has(r.id)
      }))
    });
  });
  router.get("/bundles", (req, res) => {
    const bundles = db.prepare("SELECT * FROM gemini_bundles WHERE is_active = 1 ORDER BY created_at DESC").all();
    const userId = req.user?.id;
    const unlockedIds = userId ? new Set(
      db.prepare("SELECT note_id FROM purchases WHERE buyer_id = ? AND refunded = 0").all(userId).map((r) => r.note_id)
    ) : /* @__PURE__ */ new Set();
    const hydrated = bundles.map((b) => {
      const items = db.prepare(
        `SELECT n.* FROM notes n
           JOIN gemini_bundle_items bi ON bi.note_id = n.id
           WHERE bi.bundle_id = ?`
      ).all(b.id);
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
        notes: items.map((i) => ({ id: i.id, title: i.title, subject: i.subject, priceCoins: i.price_coins }))
      };
    });
    res.json({ bundles: hydrated });
  });
  router.post("/bundles/:bundleId/unlock", requireAuth, actionLimiter, (req, res) => {
    const user = req.user;
    const bundle = db.prepare("SELECT * FROM gemini_bundles WHERE id = ? AND is_active = 1").get(req.params.bundleId);
    if (!bundle) {
      res.status(404).json({ error: "Bundle not found" });
      return;
    }
    const items = db.prepare(
      `SELECT n.* FROM notes n
         JOIN gemini_bundle_items bi ON bi.note_id = n.id
         WHERE bi.bundle_id = ?`
    ).all(bundle.id);
    if (items.length === 0) {
      res.status(400).json({ error: "Bundle has no notes" });
      return;
    }
    try {
      const result = db.transaction(() => {
        const freshUser = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(user.id);
        if (freshUser.coins_balance < bundle.bundle_price_coins) {
          throw new Error("INSUFFICIENT_COINS");
        }
        const missing = items.filter(
          (it) => !db.prepare("SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0").get(user.id, it.id)
        );
        if (missing.length === 0) {
          throw new Error("ALREADY_OWNED");
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        db.prepare("UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?").run(
          bundle.bundle_price_coins,
          user.id
        );
        for (const it of missing) {
          db.prepare(
            `INSERT INTO purchases (id, buyer_id, note_id, price_coins, uploader_coins, burned_coins, refunded, created_at)
             VALUES (?, ?, ?, ?, 0, ?, 0, ?)
             ON CONFLICT(buyer_id, note_id) DO UPDATE SET refunded = 0`
          ).run(
            `pur_${crypto5.randomUUID().slice(0, 10)}`,
            user.id,
            it.id,
            Math.round(bundle.bundle_price_coins / missing.length),
            Math.round(bundle.bundle_price_coins / missing.length),
            now
          );
          db.prepare("UPDATE notes SET sales_count = sales_count + 1 WHERE id = ?").run(it.id);
        }
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'bundle_debit', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto5.randomUUID().slice(0, 10)}`,
          user.id,
          -bundle.bundle_price_coins,
          `Unlocked Gemini Bundle: ${bundle.title}`,
          bundle.id,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'bundle_unlock', 'bundle', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto5.randomUUID().slice(0, 10)}`,
          user.id,
          bundle.id,
          bundle.bundle_price_coins,
          JSON.stringify({ noteIds: missing.map((m) => m.id) }),
          now
        );
        const updatedBalance = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(user.id).coins_balance;
        return { updatedBalance };
      })();
      const newlyUnlocked = checkAndUnlockAchievements(user.id);
      res.json({ ok: true, coinsBalance: result.updatedBalance, newlyUnlocked });
    } catch (err) {
      const msg = err.message;
      if (msg === "INSUFFICIENT_COINS") {
        res.status(400).json({ error: "Not enough Coins to unlock this bundle" });
        return;
      }
      if (msg === "ALREADY_OWNED") {
        res.status(400).json({ error: "You already unlocked all notes in this bundle" });
        return;
      }
      res.status(500).json({ error: "Could not complete bundle unlock" });
    }
  });
  router.get("/my/library", requireAuth, (req, res) => {
    const userId = req.user.id;
    const purchased = db.prepare(
      `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         p.created_at as unlocked_at, p.price_coins as paid_coins,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM purchases p
         JOIN notes n ON n.id = p.note_id
         JOIN users u ON u.id = n.uploader_id
         WHERE p.buyer_id = ? AND p.refunded = 0
         ORDER BY p.created_at DESC`
    ).all(userId);
    const bookmarks = db.prepare(
      `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM bookmarks b
         JOIN notes n ON n.id = b.note_id
         JOIN users u ON u.id = n.uploader_id
         WHERE b.user_id = ? AND n.status = 'approved'
         ORDER BY b.created_at DESC`
    ).all(userId);
    res.json({
      library: purchased.map((r) => ({
        ...formatNoteSummary(r),
        unlockedAt: r.unlocked_at,
        paidCoins: r.paid_coins,
        isUnlocked: true
      })),
      bookmarks: bookmarks.map((r) => ({
        ...formatNoteSummary(r),
        isBookmarked: true
      }))
    });
  });
  router.get("/my/uploads", requireAuth, (req, res) => {
    const userId = req.user.id;
    const rows = db.prepare(
      `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE n.uploader_id = ?
         ORDER BY n.created_at DESC`
    ).all(userId);
    const totalSales = rows.reduce((a, r) => a + r.sales_count, 0);
    const totalEarnedCoins = rows.reduce((a, r) => a + r.total_earned_coins + r.upload_reward_coins, 0);
    res.json({
      uploads: rows.map((r) => ({ ...formatNoteSummary(r), isUnlocked: true })),
      stats: { totalUploads: rows.length, totalSales, totalEarnedCoins }
    });
  });
  router.get("/:id/preview", (req, res) => {
    const note = db.prepare("SELECT id, title, subject, page_count FROM notes WHERE id = ?").get(req.params.id);
    if (!note) {
      res.status(404).send("Not found");
      return;
    }
    const svg = renderBlurredPreviewSvg(note.title, note.subject, note.page_count);
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(svg);
  });
  router.get("/:id", (req, res) => {
    const note = db.prepare(
      `SELECT n.*, u.name as uploader_name, u.equipped_avatar as uploader_avatar, u.equipped_frame as uploader_frame,
         (SELECT COUNT(*) FROM notes n2 WHERE n2.uploader_id = n.uploader_id AND n2.status = 'approved') as uploader_approved_count
         FROM notes n
         JOIN users u ON u.id = n.uploader_id
         WHERE n.id = ?`
    ).get(req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const userId = req.user?.id;
    const isAdmin = req.user?.role === "admin";
    if (note.status !== "approved" && note.uploader_id !== userId && !isAdmin) {
      res.status(404).json({ error: "Note is unavailable or pending review" });
      return;
    }
    const unlocked = userHasFullAccess(userId, note);
    const purchase = userId ? db.prepare("SELECT id, created_at, price_coins FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0").get(userId, note.id) : void 0;
    const existingRefund = purchase ? db.prepare("SELECT id, status FROM refund_requests WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1").get(purchase.id) : void 0;
    const canRequestRefund = Boolean(
      purchase && purchase.price_coins > 0 && !existingRefund && isWithinRefundWindow(purchase.created_at)
    );
    const isBookmarked = userId ? Boolean(db.prepare("SELECT 1 FROM bookmarks WHERE user_id = ? AND note_id = ?").get(userId, note.id)) : false;
    const isFollowingUploader = userId ? Boolean(
      db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?").get(userId, note.uploader_id)
    ) : false;
    const reviews = db.prepare(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.name as buyer_name, u.equipped_avatar as buyer_avatar
         FROM reviews r
         JOIN users u ON u.id = r.buyer_id
         WHERE r.note_id = ?
         ORDER BY r.created_at DESC`
    ).all(note.id);
    const hasReviewed = userId ? Boolean(db.prepare("SELECT 1 FROM reviews WHERE note_id = ? AND buyer_id = ?").get(note.id, userId)) : false;
    res.json({
      note: {
        ...formatNoteSummary(note),
        isUnlocked: unlocked,
        isBookmarked,
        isFollowingUploader,
        canReview: Boolean(purchase && !hasReviewed),
        canRequestRefund,
        refundStatus: existingRefund?.status || null,
        hasPreviewPages: note.preview_pages_count > 0
      },
      reviews: reviews.map((rv) => ({
        id: rv.id,
        rating: rv.rating,
        comment: rv.comment,
        createdAt: rv.created_at,
        buyerName: rv.buyer_name,
        buyerAvatar: rv.buyer_avatar
      }))
    });
  });
  router.get("/:id/viewer-urls", (req, res) => {
    const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const userId = req.user?.id || "guest";
    const fullAccess = userHasFullAccess(req.user?.id, note);
    const allowedPages = fullAccess ? note.page_count : note.preview_pages_count;
    if (allowedPages <= 0) {
      res.status(403).json({ error: "Unlock this note with Coins to view pages" });
      return;
    }
    const exp = Math.floor(Date.now() / 1e3) + 5 * 60;
    const token = signViewerToken({ noteId: note.id, userId, exp }, SERVER_SECRET);
    const pages = [];
    for (let p = 1; p <= allowedPages; p++) {
      pages.push({
        page: p,
        url: `/api/notes/${note.id}/page/${p}?token=${encodeURIComponent(token)}`,
        isPreviewOnly: !fullAccess
      });
    }
    res.json({
      fullAccess,
      totalPages: note.page_count,
      allowedPages,
      fileType: note.file_type,
      watermarkLabel: req.user ? `${req.user.name} \xB7 NoteSwap` : "Free Preview \xB7 NoteSwap",
      pages
    });
  });
  router.get("/:id/page/:page", (req, res) => {
    const token = String(req.query.token || "");
    const verified = verifyViewerToken(token, SERVER_SECRET);
    if (!verified || verified.noteId !== req.params.id) {
      res.status(403).json({ error: "Viewer link expired or invalid" });
      return;
    }
    const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
    if (!note) {
      res.status(404).send("Not found");
      return;
    }
    const pageNum = Number(req.params.page);
    const fullAccess = verified.userId !== "guest" ? userHasFullAccess(verified.userId, note) : note.is_free_sample === 1;
    const maxAllowed = fullAccess ? note.page_count : note.preview_pages_count;
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > maxAllowed) {
      res.status(403).send("Page locked");
      return;
    }
    const userRow = verified.userId !== "guest" ? db.prepare("SELECT name FROM users WHERE id = ?").get(verified.userId) : void 0;
    const watermarkText = userRow ? `${userRow.name} \xB7 ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}` : "NoteSwap Free Preview";
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const safePath = resolveSafePrivatePath(note.file_path);
    if (note.file_type === "structured") {
      const pages = JSON.parse(fs3.readFileSync(safePath, "utf8"));
      const pageData = pages[pageNum - 1];
      if (!pageData) {
        res.status(404).send("Page not found");
        return;
      }
      const svg = renderStructuredPageSvg(
        note.title,
        note.subject,
        pageNum,
        note.page_count,
        pageData,
        watermarkText
      );
      res.setHeader("Content-Type", "image/svg+xml");
      res.send(svg);
      return;
    }
    if (note.file_type === "image") {
      const files = JSON.parse(fs3.readFileSync(safePath, "utf8"));
      const targetRel = files[pageNum - 1];
      if (!targetRel) {
        res.status(404).send("Page image not found");
        return;
      }
      const imgPath = resolveSafePrivatePath(targetRel);
      const ext = path3.extname(imgPath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", "inline");
      fs3.createReadStream(imgPath).pipe(res);
      return;
    }
    if (note.file_type === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="protected-note.pdf"');
      fs3.createReadStream(safePath).pipe(res);
      return;
    }
    res.status(400).send("Unsupported note format");
  });
  router.post(
    "/upload",
    requireAuth,
    actionLimiter,
    upload.array("files", 10),
    (req, res) => {
      const user = req.user;
      const title = String(req.body?.title || "").trim();
      const subject = String(req.body?.subject || "").trim();
      const examClass = String(req.body?.examClass || "").trim();
      const description = String(req.body?.description || "").trim();
      const tagsRaw = String(req.body?.tags || "").trim();
      const copyrightDeclared = req.body?.copyrightDeclared === "true" || req.body?.copyrightDeclared === true;
      const isGeminiNote = req.body?.isGeminiNote === "true" || req.body?.isGeminiNote === true;
      const isPyq = req.body?.isPyq === "true" || req.body?.isPyq === true;
      const pyqYear = String(req.body?.pyqYear || "").trim().slice(0, 10);
      const previewPagesReq = Number(req.body?.previewPagesCount || 1);
      if ((isGeminiNote || isPyq) && user.role !== "admin") {
        res.status(403).json({ error: "Only admins can upload Official Gemini Notes or Previous Year Papers" });
        return;
      }
      if (title.length < 4 || title.length > 120) {
        res.status(400).json({ error: "Title must be between 4 and 120 characters" });
        return;
      }
      if (!subject || !examClass || description.length < 15) {
        res.status(400).json({ error: "Subject, class/exam, and description (15+ chars) are required" });
        return;
      }
      if (!copyrightDeclared) {
        res.status(400).json({ error: "You must confirm the copyright declaration checkbox" });
        return;
      }
      let priceCoins = isGeminiNote ? GEMINI_NOTE_PRICE_COINS : parsePositiveIntCoins(req.body?.priceCoins);
      if (priceCoins === null) {
        res.status(400).json({ error: "Enter a valid whole-number Coin price" });
        return;
      }
      if (!isGeminiNote) {
        const priceErr = validateNoteUploadPriceCoins(priceCoins);
        if (priceErr) {
          res.status(400).json({ error: priceErr });
          return;
        }
      }
      const files = req.files || [];
      if (files.length === 0) {
        res.status(400).json({ error: "Attach at least 1 PDF or image file" });
        return;
      }
      const combinedBuffer = Buffer.concat(files.map((f) => f.buffer));
      const fileHash = computeSha256(combinedBuffer);
      const duplicate = db.prepare("SELECT id, title FROM notes WHERE file_hash = ?").get(fileHash);
      if (duplicate) {
        res.status(409).json({
          error: `Duplicate file detected: this content already exists ("${duplicate.title}").`
        });
        return;
      }
      const isPdf = files[0].mimetype === "application/pdf";
      if (isPdf && files.length > 1) {
        res.status(400).json({ error: "Upload a single PDF or up to 10 page images" });
        return;
      }
      const allowedImageTypes = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/webp"]);
      if (!isPdf && files.some((f) => !allowedImageTypes.has(f.mimetype))) {
        res.status(400).json({ error: "Only PDF, PNG, JPG, or WebP files are accepted" });
        return;
      }
      const noteId = `note_${crypto5.randomUUID().slice(0, 10)}`;
      const baseDir = ensurePrivateStorageDir();
      const noteDir = path3.join(baseDir, noteId);
      fs3.mkdirSync(noteDir, { recursive: true });
      let fileType = "image";
      let relFilePath = "";
      let pageCount = files.length;
      if (isPdf) {
        fileType = "pdf";
        fs3.writeFileSync(path3.join(noteDir, "document.pdf"), files[0].buffer);
        relFilePath = `${noteId}/document.pdf`;
        pageCount = Math.max(1, Number(req.body?.pageCount || 1));
      } else {
        const savedImages = [];
        files.forEach((f, idx) => {
          const ext = f.mimetype === "image/png" ? ".png" : f.mimetype === "image/webp" ? ".webp" : ".jpg";
          const fname = `page_${idx + 1}${ext}`;
          fs3.writeFileSync(path3.join(noteDir, fname), f.buffer);
          savedImages.push(`${noteId}/${fname}`);
        });
        fs3.writeFileSync(path3.join(noteDir, "images.json"), JSON.stringify(savedImages));
        relFilePath = `${noteId}/images.json`;
        pageCount = savedImages.length;
      }
      const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6);
      const status = user.role === "admin" && (isGeminiNote || isPyq) ? "approved" : "pending";
      const previewPages = isGeminiNote ? Math.min(2, Math.max(1, previewPagesReq)) : isPyq ? 1 : 0;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      db.prepare(
        `INSERT INTO notes (
          id, uploader_id, title, subject, exam_class, description, tags,
          price_coins, is_free_sample, is_gemini_note, is_pyq, pyq_year, preview_pages_count,
          page_count, file_type, file_path, file_hash, status, copyright_declared, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(
        noteId,
        user.id,
        title,
        subject,
        examClass,
        description,
        JSON.stringify(tags),
        priceCoins,
        isGeminiNote ? 1 : 0,
        isPyq ? 1 : 0,
        pyqYear,
        previewPages,
        pageCount,
        fileType,
        relFilePath,
        fileHash,
        status,
        now
      );
      res.status(201).json({
        ok: true,
        noteId,
        status,
        message: status === "approved" ? "Published immediately!" : "Submitted for admin review! You will earn up to \u{1FA99}2 reward once approved."
      });
    }
  );
  router.post("/:id/unlock", requireAuth, actionLimiter, (req, res) => {
    const buyer = req.user;
    const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
    if (!note || note.status !== "approved") {
      res.status(404).json({ error: "Note not available" });
      return;
    }
    try {
      const result = db.transaction(() => {
        const existing = db.prepare("SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0").get(buyer.id, note.id);
        if (existing || note.uploader_id === buyer.id) {
          throw new Error("ALREADY_UNLOCKED");
        }
        const priceCoins = note.is_free_sample ? 0 : note.price_coins;
        const freshBuyer = db.prepare("SELECT coins_balance, referred_by, referral_rewarded FROM users WHERE id = ?").get(buyer.id);
        if (freshBuyer.coins_balance < priceCoins) {
          throw new Error("INSUFFICIENT_COINS");
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const isOfficial = note.is_gemini_note === 1 || note.is_pyq === 1;
        const split = calculateCoinUnlockSplit(priceCoins);
        const uploaderShare = isOfficial ? 0 : split.uploaderCoins;
        const burned = priceCoins - uploaderShare;
        if (priceCoins > 0) {
          db.prepare("UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?").run(priceCoins, buyer.id);
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'spent', 'unlock_debit', ?, ?, ?, ?)`
          ).run(
            `tx_${crypto5.randomUUID().slice(0, 10)}`,
            buyer.id,
            -priceCoins,
            `Unlocked "${note.title}"`,
            note.id,
            now
          );
        }
        if (uploaderShare > 0) {
          db.prepare(
            "UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?"
          ).run(uploaderShare, uploaderShare, note.uploader_id);
          db.prepare("UPDATE notes SET total_earned_coins = total_earned_coins + ? WHERE id = ?").run(
            uploaderShare,
            note.id
          );
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'sale_credit', ?, ?, ?, ?)`
          ).run(
            `tx_${crypto5.randomUUID().slice(0, 10)}`,
            note.uploader_id,
            uploaderShare,
            `${buyer.name} unlocked "${note.title}"`,
            note.id,
            now
          );
          db.prepare(
            `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
             VALUES (?, ?, 'Note Unlocked!', ?, 0, ?)`
          ).run(
            `ntf_${crypto5.randomUUID().slice(0, 10)}`,
            note.uploader_id,
            `${buyer.name} unlocked "${note.title}" \u2014 you earned +\u{1FA99}${uploaderShare}!`,
            now
          );
        }
        if (burned > 0) {
          const prevBurn = Number(
            db.prepare("SELECT value FROM app_settings WHERE key = 'coins_burned_total'").get()?.value || 0
          );
          db.prepare(
            "INSERT INTO app_settings (key, value) VALUES ('coins_burned_total', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
          ).run(String(prevBurn + burned));
        }
        db.prepare("UPDATE notes SET sales_count = sales_count + 1 WHERE id = ?").run(note.id);
        db.prepare(
          `INSERT INTO purchases (id, buyer_id, note_id, price_coins, uploader_coins, burned_coins, refunded, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(buyer_id, note_id) DO UPDATE SET refunded = 0, created_at = excluded.created_at`
        ).run(
          `pur_${crypto5.randomUUID().slice(0, 10)}`,
          buyer.id,
          note.id,
          priceCoins,
          uploaderShare,
          burned,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'note_unlock', 'note', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto5.randomUUID().slice(0, 10)}`,
          buyer.id,
          note.id,
          priceCoins,
          JSON.stringify({ uploaderShare, burned }),
          now
        );
        let referralCredited = false;
        if (priceCoins > 0 && freshBuyer.referred_by && freshBuyer.referral_rewarded === 0) {
          db.prepare(
            "UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ?, referral_rewarded = 1 WHERE id = ?"
          ).run(REFERRAL_BONUS_COINS, REFERRAL_BONUS_COINS, buyer.id);
          db.prepare(
            "UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?"
          ).run(REFERRAL_BONUS_COINS, REFERRAL_BONUS_COINS, freshBuyer.referred_by);
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'referral_bonus', ?, 'Referral bonus on first unlock', ?, ?)`
          ).run(`tx_${crypto5.randomUUID().slice(0, 10)}`, buyer.id, REFERRAL_BONUS_COINS, freshBuyer.referred_by, now);
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'referral_bonus', ?, ?, ?, ?)`
          ).run(
            `tx_${crypto5.randomUUID().slice(0, 10)}`,
            freshBuyer.referred_by,
            REFERRAL_BONUS_COINS,
            `Referral bonus: ${buyer.name} unlocked their first note`,
            buyer.id,
            now
          );
          db.prepare(
            `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
             VALUES (?, ?, 'Referral Bonus!', ?, 0, ?)`
          ).run(
            `ntf_${crypto5.randomUUID().slice(0, 10)}`,
            freshBuyer.referred_by,
            `${buyer.name} completed their first unlock! You earned +\u{1FA99}${REFERRAL_BONUS_COINS}.`,
            now
          );
          referralCredited = true;
        }
        const updatedBalance = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(buyer.id).coins_balance;
        return { updatedBalance, priceCoins, uploaderShare, burned, referralCredited };
      })();
      const newlyUnlocked = checkAndUnlockAchievements(buyer.id);
      checkAndUnlockAchievements(note.uploader_id);
      res.json({
        ok: true,
        coinsBalance: result.updatedBalance,
        spentCoins: result.priceCoins,
        referralCredited: result.referralCredited,
        newlyUnlocked
      });
    } catch (err) {
      const msg = err.message;
      if (msg === "ALREADY_UNLOCKED") {
        res.status(400).json({ error: "You already have access to this note" });
        return;
      }
      if (msg === "INSUFFICIENT_COINS") {
        res.status(400).json({ error: "Not enough Coins. Claim your daily streak, spin the wheel, or redeem a code!" });
        return;
      }
      res.status(500).json({ error: "Unlock transaction failed" });
    }
  });
  router.post("/:id/reviews", requireAuth, actionLimiter, (req, res) => {
    const buyer = req.user;
    const noteId = req.params.id;
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim().slice(0, 500);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: "Rating must be between 1 and 5 stars" });
      return;
    }
    if (comment.length < 4) {
      res.status(400).json({ error: "Please write a short review (at least 4 characters)" });
      return;
    }
    const purchase = db.prepare("SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0").get(buyer.id, noteId);
    if (!purchase) {
      res.status(403).json({ error: "Only verified buyers can review this note" });
      return;
    }
    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO reviews (id, note_id, buyer_id, rating, comment, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(`rev_${crypto5.randomUUID().slice(0, 10)}`, noteId, buyer.id, rating, comment, (/* @__PURE__ */ new Date()).toISOString());
        const stats = db.prepare("SELECT AVG(rating) as avg_rating, COUNT(*) as cnt FROM reviews WHERE note_id = ?").get(noteId);
        db.prepare("UPDATE notes SET rating_avg = ?, rating_count = ? WHERE id = ?").run(
          stats.avg_rating || 0,
          stats.cnt || 0,
          noteId
        );
      })();
      res.status(201).json({ ok: true });
    } catch {
      res.status(409).json({ error: "You have already reviewed this note" });
    }
  });
  router.post("/:id/bookmark", requireAuth, (req, res) => {
    const userId = req.user.id;
    const noteId = req.params.id;
    const existing = db.prepare("SELECT 1 FROM bookmarks WHERE user_id = ? AND note_id = ?").get(userId, noteId);
    if (existing) {
      db.prepare("DELETE FROM bookmarks WHERE user_id = ? AND note_id = ?").run(userId, noteId);
      res.json({ bookmarked: false });
    } else {
      db.prepare("INSERT INTO bookmarks (user_id, note_id, created_at) VALUES (?, ?, ?)").run(
        userId,
        noteId,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      res.json({ bookmarked: true });
    }
  });
  router.post("/:id/report", requireAuth, actionLimiter, (req, res) => {
    const user = req.user;
    const noteId = req.params.id;
    const reason = String(req.body?.reason || "").trim();
    const details = String(req.body?.details || "").trim().slice(0, 400);
    if (!["copyright", "spam", "wrong_content"].includes(reason)) {
      res.status(400).json({ error: "Choose copyright, spam, or wrong_content" });
      return;
    }
    try {
      let autoHidden = false;
      db.transaction(() => {
        db.prepare(
          `INSERT INTO reports (id, note_id, reporter_id, reason, details, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?)`
        ).run(`rep_${crypto5.randomUUID().slice(0, 10)}`, noteId, user.id, reason, details, (/* @__PURE__ */ new Date()).toISOString());
        db.prepare("UPDATE notes SET report_count = report_count + 1 WHERE id = ?").run(noteId);
        const noteRow = db.prepare("SELECT report_count FROM notes WHERE id = ?").get(noteId);
        if (noteRow && noteRow.report_count >= AUTO_HIDE_REPORT_THRESHOLD) {
          db.prepare("UPDATE notes SET status = 'hidden_review' WHERE id = ?").run(noteId);
          autoHidden = true;
        }
      })();
      res.json({ ok: true, autoHidden });
    } catch {
      res.status(409).json({ error: "You already reported this note" });
    }
  });
  router.post("/:id/refund", requireAuth, actionLimiter, (req, res) => {
    const buyer = req.user;
    const noteId = req.params.id;
    const reason = String(req.body?.reason || "").trim().slice(0, 400);
    if (reason.length < 8) {
      res.status(400).json({ error: "Explain why the note is wrong or unreadable (8+ characters)" });
      return;
    }
    const purchase = db.prepare("SELECT * FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0").get(buyer.id, noteId);
    if (!purchase || purchase.price_coins <= 0) {
      res.status(400).json({ error: "No eligible paid unlock found for this note" });
      return;
    }
    if (!isWithinRefundWindow(purchase.created_at)) {
      res.status(400).json({ error: "Coin refund requests must be submitted within 24 hours of unlocking" });
      return;
    }
    const existing = db.prepare("SELECT id FROM refund_requests WHERE purchase_id = ?").get(purchase.id);
    if (existing) {
      res.status(409).json({ error: "A refund request for this unlock already exists" });
      return;
    }
    db.prepare(
      `INSERT INTO refund_requests (id, purchase_id, note_id, buyer_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    ).run(`rfd_${crypto5.randomUUID().slice(0, 10)}`, purchase.id, noteId, buyer.id, reason, (/* @__PURE__ */ new Date()).toISOString());
    res.status(201).json({ ok: true, message: "Coin refund request sent to admin for review." });
  });
  return router;
}

// server/routes/ai.ts
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function buildNoteContents(note, promptText) {
  if (note.file_type === "structured") {
    const plain = extractNotePlainText(note);
    return `${promptText}

--- NOTE CONTENT ---
${plain}`;
  }
  const safePath = resolveSafePrivatePath(note.file_path);
  const parts = [
    { text: `${promptText}

Note Title: ${note.title}
Subject: ${note.subject}
Exam: ${note.exam_class}
Description: ${note.description}` }
  ];
  if (note.file_type === "image") {
    const files = JSON.parse(fs4.readFileSync(safePath, "utf8"));
    for (const rel of files.slice(0, 4)) {
      const imgPath = resolveSafePrivatePath(rel);
      const ext = path4.extname(imgPath).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      parts.push({
        inlineData: {
          mimeType,
          data: fs4.readFileSync(imgPath).toString("base64")
        }
      });
    }
  } else if (note.file_type === "pdf") {
    const pdfData = fs4.readFileSync(safePath);
    if (pdfData.byteLength <= 6 * 1024 * 1024) {
      parts.push({
        inlineData: {
          mimeType: "application/pdf",
          data: pdfData.toString("base64")
        }
      });
    }
  }
  return { parts };
}
function createAiRouter() {
  const router = express4.Router();
  const aiLimiter = createRateLimiter("gemini_ai", 20, 60 * 1e3);
  router.post("/:id/ai-kit", requireAuth, aiLimiter, async (req, res) => {
    const user = req.user;
    const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (!userHasFullAccess(user.id, note)) {
      res.status(403).json({ error: "Unlock this note first to use AI Study Studio" });
      return;
    }
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const rewardsToday = db.prepare(
      "SELECT COUNT(*) as c FROM quiz_attempts WHERE user_id = ? AND reward_coins > 0 AND substr(created_at, 1, 10) = ?"
    ).get(user.id, todayStr).c;
    const alreadyRewarded = Boolean(
      db.prepare("SELECT 1 FROM quiz_attempts WHERE user_id = ? AND note_id = ? AND reward_coins > 0").get(user.id, note.id)
    );
    const cached = db.prepare("SELECT * FROM note_ai_kits WHERE note_id = ?").get(note.id);
    if (cached) {
      const flashcards = JSON.parse(cached.flashcards_json);
      const quiz = JSON.parse(cached.quiz_json);
      res.json({
        summary: cached.summary,
        flashcards,
        quiz: quiz.map((q) => ({ question: q.question, options: q.options })),
        // omit answers until submit
        alreadyRewarded,
        rewardsToday,
        maxDailyRewards: QUIZ_MAX_DAILY_REWARDS
      });
      return;
    }
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets."
      });
      return;
    }
    try {
      const contents = buildNoteContents(
        note,
        "Generate a concise study kit strictly from this note: (1) a clear exam-focused summary (3-4 sentences), (2) exactly 10 study flashcards (front and back), and (3) exactly 5 multiple-choice quiz questions with 4 options each, correctIndex (0-3), and a 1-sentence explanation."
      );
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents,
        config: {
          systemInstruction: "You are an academic study assistant. Base every summary point, flashcard, and quiz question strictly on the provided note material.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              flashcards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: { type: Type.STRING },
                    back: { type: Type.STRING }
                  },
                  required: ["front", "back"]
                }
              },
              quiz: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING }
                  },
                  required: ["question", "options", "correctIndex", "explanation"]
                }
              }
            },
            required: ["summary", "flashcards", "quiz"]
          }
        }
      });
      const parsed = JSON.parse((response.text ?? "{}").trim());
      const flashcards = (parsed.flashcards || []).slice(0, 10);
      const quiz = (parsed.quiz || []).slice(0, 5);
      db.prepare(
        `INSERT OR REPLACE INTO note_ai_kits (note_id, summary, flashcards_json, quiz_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(note.id, parsed.summary || "", JSON.stringify(flashcards), JSON.stringify(quiz), (/* @__PURE__ */ new Date()).toISOString());
      res.json({
        summary: parsed.summary || "",
        flashcards,
        quiz: quiz.map((q) => ({ question: q.question, options: q.options })),
        alreadyRewarded,
        rewardsToday,
        maxDailyRewards: QUIZ_MAX_DAILY_REWARDS
      });
    } catch (err) {
      const msg = err.message || "Gemini AI request failed";
      if (msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED")) {
        res.status(403).json({ error: "Check your GEMINI_API_KEY in Settings > Secrets." });
        return;
      }
      res.status(502).json({ error: `Could not generate AI Study Kit: ${msg}` });
    }
  });
  router.post("/:id/quiz/submit", requireAuth, aiLimiter, (req, res) => {
    const user = req.user;
    const noteId = req.params.id;
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const kit = db.prepare("SELECT quiz_json FROM note_ai_kits WHERE note_id = ?").get(noteId);
    if (!kit) {
      res.status(404).json({ error: "Generate the AI quiz first" });
      return;
    }
    const quiz = JSON.parse(kit.quiz_json);
    if (answers.length !== quiz.length) {
      res.status(400).json({ error: `Please answer all ${quiz.length} questions` });
      return;
    }
    let score = 0;
    const corrections = quiz.map((q, idx) => {
      const selected = Number(answers[idx]);
      const isCorrect = selected === q.correctIndex;
      if (isCorrect) score++;
      return {
        selectedIndex: selected,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation
      };
    });
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const result = db.transaction(() => {
      const alreadyRewarded = Boolean(
        db.prepare("SELECT 1 FROM quiz_attempts WHERE user_id = ? AND note_id = ? AND reward_coins > 0").get(user.id, noteId)
      );
      const rewardsToday = db.prepare(
        "SELECT COUNT(*) as c FROM quiz_attempts WHERE user_id = ? AND reward_coins > 0 AND substr(created_at, 1, 10) = ?"
      ).get(user.id, todayStr).c;
      const evalRes = evaluateQuizReward({
        score,
        totalQuestions: quiz.length,
        alreadyRewardedForNote: alreadyRewarded,
        rewardsEarnedToday: rewardsToday
      });
      db.prepare(
        `INSERT INTO quiz_attempts (id, user_id, note_id, score, total_questions, reward_coins, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(`qz_${crypto6.randomUUID().slice(0, 10)}`, user.id, noteId, score, quiz.length, evalRes.coinsAwarded, now);
      if (evalRes.coinsAwarded > 0) {
        db.prepare(
          "UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?"
        ).run(evalRes.coinsAwarded, evalRes.coinsAwarded, user.id);
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'quiz_reward', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto6.randomUUID().slice(0, 10)}`,
          user.id,
          evalRes.coinsAwarded,
          `Scored ${score}/${quiz.length} on AI Note Quiz`,
          noteId,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'quiz_reward', 'note', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto6.randomUUID().slice(0, 10)}`,
          user.id,
          noteId,
          evalRes.coinsAwarded,
          JSON.stringify({ score, total: quiz.length }),
          now
        );
      }
      const updatedBalance = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(user.id).coins_balance;
      return {
        ...evalRes,
        alreadyRewarded,
        rewardsToday: rewardsToday + (evalRes.coinsAwarded > 0 ? 1 : 0),
        updatedBalance
      };
    })();
    const newlyUnlocked = checkAndUnlockAchievements(user.id);
    res.json({
      score,
      total: quiz.length,
      passed: result.passed,
      coinsAwarded: result.coinsAwarded,
      alreadyRewarded: result.alreadyRewarded,
      rewardsToday: result.rewardsToday,
      maxDailyRewards: QUIZ_MAX_DAILY_REWARDS,
      coinsBalance: result.updatedBalance,
      corrections,
      newlyUnlocked
    });
  });
  router.post("/:id/ask", requireAuth, aiLimiter, async (req, res) => {
    const user = req.user;
    const question = String(req.body?.question || "").trim().slice(0, 500);
    if (question.length < 3) {
      res.status(400).json({ error: "Enter a question about this note" });
      return;
    }
    const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (!userHasFullAccess(user.id, note)) {
      res.status(403).json({ error: "Unlock this note first to ask questions about it" });
      return;
    }
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets."
      });
      return;
    }
    try {
      const contents = buildNoteContents(note, `Student question: ${question}`);
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents,
        config: {
          systemInstruction: 'You are "Ask this note", a strict study tutor. Answer ONLY using facts, formulas, and explanations present in the provided note content. Do not bring in outside knowledge. If the answer is not in the note, reply clearly: "This topic is not covered in this note." Keep answers clear and concise.'
        }
      });
      res.json({ answer: (response.text ?? "").trim() || "No answer returned." });
    } catch (err) {
      const msg = err.message || "Gemini AI error";
      res.status(502).json({ error: `Could not answer question: ${msg}` });
    }
  });
  return router;
}

// server/routes/chat.ts
import crypto7 from "node:crypto";
import express5 from "express";
function buildDmId(u1, u2) {
  const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
  return [`dm_${a}_${b}`, a, b];
}
function isBlockedBetween(u1, u2) {
  return Boolean(
    db.prepare("SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)").get(u1, u2, u2, u1)
  );
}
function hydrateMessage(row) {
  let payload = {};
  let seenBy = [];
  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch {
    payload = {};
  }
  try {
    seenBy = JSON.parse(row.seen_by_json || "[]");
  } catch {
    seenBy = [];
  }
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    // Never expose email in chat
    senderAvatar: row.sender_avatar,
    senderFrame: row.sender_frame,
    messageType: row.message_type,
    body: row.is_deleted ? "[Message removed by moderator]" : row.body,
    imageData: row.is_deleted ? "" : row.image_data,
    payload,
    seenBy,
    isDeleted: Boolean(row.is_deleted),
    createdAt: row.created_at
  };
}
function createChatRouter() {
  const router = express5.Router();
  const messageLimiter = createRateLimiter("chat_msg", 20, 60 * 1e3);
  const transferLimiter = createRateLimiter("chat_transfer", 15, 60 * 1e3);
  router.get("/rooms", requireGoogleAuth, (req, res) => {
    const user = req.user;
    const rooms = db.prepare("SELECT * FROM chat_rooms ORDER BY rowid ASC").all();
    const mutedRows = new Set(
      db.prepare("SELECT room_id FROM chat_mutes WHERE user_id = ?").all(user.id).map((r) => r.room_id)
    );
    const blockedIds = new Set(
      db.prepare("SELECT blocked_id FROM user_blocks WHERE blocker_id = ?").all(user.id).map((r) => r.blocked_id)
    );
    const dmRows = db.prepare(
      `SELECT dt.*,
         ua.name as name_a, ua.equipped_avatar as avatar_a, ua.equipped_frame as frame_a, ua.is_minor as minor_a,
         ub.name as name_b, ub.equipped_avatar as avatar_b, ub.equipped_frame as frame_b, ub.is_minor as minor_b
         FROM dm_threads dt
         JOIN users ua ON ua.id = dt.user_a
         JOIN users ub ON ub.id = dt.user_b
         WHERE dt.user_a = ? OR dt.user_b = ?
         ORDER BY dt.created_at DESC`
    ).all(user.id, user.id);
    const dms = dmRows.map((d) => {
      const otherIsB = d.user_a === user.id;
      const peerId = otherIsB ? d.user_b : d.user_a;
      return {
        id: d.id,
        peerId,
        peerName: otherIsB ? d.name_b : d.name_a,
        peerAvatar: otherIsB ? d.avatar_b : d.avatar_a,
        peerFrame: otherIsB ? d.frame_b : d.frame_a,
        peerIsMinor: Boolean(otherIsB ? d.minor_b : d.minor_a),
        requesterId: d.requester_id,
        isIncomingRequest: d.status === "pending" && d.requester_id !== user.id,
        status: d.status,
        isMuted: mutedRows.has(d.id),
        isBlocked: blockedIds.has(peerId)
      };
    });
    const peers = db.prepare(
      `SELECT id, name, equipped_avatar as avatar, equipped_frame as frame, is_minor as isMinor
         FROM users
         WHERE id != ? AND is_banned = 0 AND auth_provider = 'google'
         ORDER BY coins_earned_total DESC
         LIMIT 25`
    ).all(user.id);
    res.json({
      rooms: rooms.map((r) => ({ ...r, isMuted: mutedRows.has(r.id) })),
      dms,
      peers: peers.map((p) => ({
        ...p,
        isMinor: Boolean(p.isMinor),
        isOnline: getOnlineUserIds().includes(p.id),
        isBlocked: blockedIds.has(p.id)
      })),
      onlineUserIds: getOnlineUserIds()
    });
  });
  router.post("/dm/start", requireGoogleAuth, (req, res) => {
    const user = req.user;
    const peerId = String(req.body?.peerId || "");
    if (!peerId || peerId === user.id) {
      res.status(400).json({ error: "Select another student to message" });
      return;
    }
    const peer = db.prepare("SELECT id, name, is_minor, is_banned, auth_provider FROM users WHERE id = ?").get(peerId);
    if (!peer || peer.is_banned || peer.auth_provider !== "google") {
      res.status(404).json({ error: "User unavailable for chat" });
      return;
    }
    if (isBlockedBetween(user.id, peer.id)) {
      res.status(403).json({ error: "Messaging is blocked between these accounts" });
      return;
    }
    const [dmId, userA, userB] = buildDmId(user.id, peer.id);
    const existing = db.prepare("SELECT * FROM dm_threads WHERE id = ?").get(dmId);
    if (existing) {
      res.json({ thread: existing });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(dmId, userA, userB, user.id, now);
    db.prepare(
      `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
       VALUES (?, ?, 'New Chat Request', ?, 0, ?)`
    ).run(
      `ntf_${crypto7.randomUUID().slice(0, 10)}`,
      peer.id,
      `${user.name} wants to start a private study chat with you.`,
      now
    );
    broadcastToUser(peer.id, { type: "dm:request", threadId: dmId, fromName: user.name });
    res.status(201).json({ thread: { id: dmId, status: "pending", requester_id: user.id } });
  });
  router.post("/dm/:threadId/respond", requireGoogleAuth, (req, res) => {
    const user = req.user;
    const decision = req.body?.accept === true ? "accepted" : "declined";
    const thread = db.prepare("SELECT * FROM dm_threads WHERE id = ?").get(req.params.threadId);
    if (!thread || thread.user_a !== user.id && thread.user_b !== user.id) {
      res.status(404).json({ error: "Chat request not found" });
      return;
    }
    if (thread.requester_id === user.id) {
      res.status(403).json({ error: "Wait for the recipient to accept your request" });
      return;
    }
    db.prepare("UPDATE dm_threads SET status = ? WHERE id = ?").run(decision, thread.id);
    broadcastToUser(thread.requester_id, {
      type: "dm:responded",
      threadId: thread.id,
      status: decision
    });
    res.json({ ok: true, status: decision });
  });
  router.get("/rooms/:roomId/messages", requireGoogleAuth, (req, res) => {
    const user = req.user;
    const roomId = req.params.roomId;
    const before = String(req.query.before || "").trim();
    if (!roomId.startsWith("room_")) {
      const thread = db.prepare("SELECT * FROM dm_threads WHERE id = ?").get(roomId);
      if (!thread || thread.user_a !== user.id && thread.user_b !== user.id) {
        res.status(403).json({ error: "Unauthorized chat room" });
        return;
      }
    }
    const blockedIds = db.prepare("SELECT blocked_id FROM user_blocks WHERE blocker_id = ?").all(user.id).map((r) => r.blocked_id);
    let query = `
      SELECT m.*, u.name as sender_name, u.equipped_avatar as sender_avatar, u.equipped_frame as sender_frame
      FROM chat_messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.room_id = ?
    `;
    const params = [roomId];
    if (before) {
      query += " AND m.created_at < ?";
      params.push(before);
    }
    query += " ORDER BY m.created_at DESC LIMIT 50";
    const rows = db.prepare(query).all(...params).filter((r) => !blockedIds.includes(r.sender_id)).reverse();
    res.json({
      messages: rows.map(hydrateMessage),
      hasMore: rows.length === 50
    });
  });
  router.post("/rooms/:roomId/seen", requireGoogleAuth, (req, res) => {
    const user = req.user;
    const roomId = req.params.roomId;
    const recent = db.prepare("SELECT id, seen_by_json FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 30").all(roomId);
    const updatedIds = [];
    const updateStmt = db.prepare("UPDATE chat_messages SET seen_by_json = ? WHERE id = ?");
    for (const msg of recent) {
      try {
        const seen = JSON.parse(msg.seen_by_json || "[]");
        if (!seen.includes(user.id)) {
          seen.push(user.id);
          updateStmt.run(JSON.stringify(seen), msg.id);
          updatedIds.push(msg.id);
        }
      } catch {
      }
    }
    if (updatedIds.length > 0) {
      broadcastToRoom(roomId, { type: "chat:seen", roomId, userId: user.id, messageIds: updatedIds });
    }
    res.json({ ok: true });
  });
  router.post("/rooms/:roomId/messages", requireGoogleAuth, messageLimiter, (req, res) => {
    const user = req.user;
    if (user.is_chat_muted) {
      res.status(403).json({ error: "Your chat privileges are muted pending admin review" });
      return;
    }
    const roomId = req.params.roomId;
    const rawBody = String(req.body?.body || "");
    const imageData = String(req.body?.imageData || "");
    const optimisticId = String(req.body?.optimisticId || "");
    if (!roomId.startsWith("room_")) {
      const thread = db.prepare("SELECT * FROM dm_threads WHERE id = ?").get(roomId);
      if (!thread || thread.user_a !== user.id && thread.user_b !== user.id) {
        res.status(403).json({ error: "Unauthorized chat room" });
        return;
      }
      const peerId = thread.user_a === user.id ? thread.user_b : thread.user_a;
      if (isBlockedBetween(user.id, peerId)) {
        res.status(403).json({ error: "Cannot message a blocked user" });
        return;
      }
      if (thread.status === "declined") {
        res.status(403).json({ error: "This chat request was declined" });
        return;
      }
      if (thread.status === "pending") {
        const peerRow = db.prepare("SELECT is_minor FROM users WHERE id = ?").get(peerId);
        if (peerRow?.is_minor) {
          res.status(403).json({
            error: "Under-18 safety: you cannot message this student until they accept your chat request."
          });
          return;
        }
        const existingMsgs = db.prepare("SELECT COUNT(*) as c FROM chat_messages WHERE room_id = ?").get(roomId).c;
        if (existingMsgs >= 1) {
          res.status(403).json({
            error: "Message request pending. Wait for the user to accept before sending more messages."
          });
          return;
        }
      }
    }
    let cleanedBody = "";
    if (rawBody.trim()) {
      const mod = moderateChatMessage(rawBody);
      if (!mod.ok) {
        res.status(400).json({ error: mod.reason });
        return;
      }
      cleanedBody = mod.cleanedText;
    }
    let safeImage = "";
    if (imageData) {
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)) {
        res.status(400).json({ error: "Only PNG, JPG, or WebP images are supported in chat" });
        return;
      }
      const approxBytes = Math.ceil(imageData.length * 3 / 4);
      if (approxBytes > CHAT_MAX_IMAGE_BYTES) {
        res.status(400).json({ error: "Chat image must be 2 MB or smaller" });
        return;
      }
      safeImage = imageData;
    }
    if (!cleanedBody && !safeImage) {
      res.status(400).json({ error: "Send a message or image" });
      return;
    }
    const msgId = `msg_${crypto7.randomUUID().slice(0, 10)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const messageType = safeImage ? "image" : "text";
    db.prepare(
      `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, image_data, payload_json, seen_by_json, is_deleted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, 0, ?)`
    ).run(msgId, roomId, user.id, messageType, cleanedBody, safeImage, JSON.stringify([user.id]), now);
    const hydrated = hydrateMessage({
      id: msgId,
      room_id: roomId,
      sender_id: user.id,
      message_type: messageType,
      body: cleanedBody,
      image_data: safeImage,
      payload_json: "{}",
      seen_by_json: JSON.stringify([user.id]),
      is_deleted: 0,
      created_at: now,
      sender_name: user.name,
      sender_avatar: user.equipped_avatar,
      sender_frame: user.equipped_frame
    });
    broadcastToRoom(roomId, { type: "chat:message", roomId, message: hydrated, optimisticId });
    if (!roomId.startsWith("room_")) {
      const thread = db.prepare("SELECT user_a, user_b FROM dm_threads WHERE id = ?").get(roomId);
      const peerId = thread.user_a === user.id ? thread.user_b : thread.user_a;
      const muted = db.prepare("SELECT 1 FROM chat_mutes WHERE user_id = ? AND room_id = ?").get(peerId, roomId);
      if (!muted) {
        broadcastToUser(peerId, { type: "chat:unread", roomId, fromName: user.name });
      }
    }
    res.status(201).json({ message: hydrated, optimisticId });
  });
  router.post("/share-note", requireGoogleAuth, messageLimiter, (req, res) => {
    const user = req.user;
    if (user.is_chat_muted) {
      res.status(403).json({ error: "Your chat is muted" });
      return;
    }
    const roomId = String(req.body?.roomId || "");
    const noteId = String(req.body?.noteId || "");
    const note = db.prepare("SELECT id, title, subject, price_coins, cover_image FROM notes WHERE id = ? AND status = 'approved'").get(noteId);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const payload = {
      noteId: note.id,
      title: note.title,
      subject: note.subject,
      priceCoins: note.price_coins,
      coverImage: note.cover_image || `/api/notes/${note.id}/preview`
    };
    const msgId = `msg_${crypto7.randomUUID().slice(0, 10)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
       VALUES (?, ?, ?, 'note_card', ?, ?, ?, ?)`
    ).run(msgId, roomId, user.id, `Shared a study note: ${note.title}`, JSON.stringify(payload), JSON.stringify([user.id]), now);
    const hydrated = hydrateMessage({
      id: msgId,
      room_id: roomId,
      sender_id: user.id,
      message_type: "note_card",
      body: `Shared a study note: ${note.title}`,
      image_data: "",
      payload_json: JSON.stringify(payload),
      seen_by_json: JSON.stringify([user.id]),
      is_deleted: 0,
      created_at: now,
      sender_name: user.name,
      sender_avatar: user.equipped_avatar,
      sender_frame: user.equipped_frame
    });
    broadcastToRoom(roomId, { type: "chat:message", roomId, message: hydrated });
    res.status(201).json({ message: hydrated });
  });
  router.post("/gift-note", requireGoogleAuth, transferLimiter, (req, res) => {
    const sender = req.user;
    const receiverId = String(req.body?.receiverId || "");
    const noteId = String(req.body?.noteId || "");
    const roomId = String(req.body?.roomId || "");
    if (!receiverId || receiverId === sender.id) {
      res.status(400).json({ error: "Choose another student to gift this note to" });
      return;
    }
    const receiver = db.prepare("SELECT id, name, is_banned FROM users WHERE id = ?").get(receiverId);
    if (!receiver || receiver.is_banned) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }
    const note = db.prepare("SELECT * FROM notes WHERE id = ? AND status = 'approved'").get(noteId);
    if (!note) {
      res.status(404).json({ error: "Note not available" });
      return;
    }
    try {
      const result = db.transaction(() => {
        const alreadyOwned = db.prepare("SELECT id FROM purchases WHERE buyer_id = ? AND note_id = ? AND refunded = 0").get(receiver.id, note.id);
        if (alreadyOwned || note.uploader_id === receiver.id) {
          throw new Error("RECEIVER_ALREADY_OWNS");
        }
        const price = note.is_free_sample ? 0 : note.price_coins;
        const freshSender = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(sender.id);
        if (freshSender.coins_balance < price) {
          throw new Error("INSUFFICIENT_COINS");
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const isOfficial = note.is_gemini_note === 1 || note.is_pyq === 1;
        const split = calculateCoinUnlockSplit(price);
        const uploaderCoins = isOfficial ? 0 : split.uploaderCoins;
        const burnedCoins = price - uploaderCoins;
        if (price > 0) {
          db.prepare("UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?").run(price, sender.id);
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'spent', 'note_gift_sent', ?, ?, ?, ?)`
          ).run(`tx_${crypto7.randomUUID().slice(0, 10)}`, sender.id, -price, `Gifted "${note.title}" to ${receiver.name}`, note.id, now);
        }
        if (uploaderCoins > 0) {
          db.prepare(
            "UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?"
          ).run(uploaderCoins, uploaderCoins, note.uploader_id);
          db.prepare("UPDATE notes SET total_earned_coins = total_earned_coins + ? WHERE id = ?").run(
            uploaderCoins,
            note.id
          );
        }
        db.prepare("UPDATE notes SET sales_count = sales_count + 1 WHERE id = ?").run(note.id);
        db.prepare(
          `INSERT INTO purchases (id, buyer_id, note_id, price_coins, uploader_coins, burned_coins, refunded, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(buyer_id, note_id) DO UPDATE SET refunded = 0`
        ).run(`pur_${crypto7.randomUUID().slice(0, 10)}`, receiver.id, note.id, price, uploaderCoins, burnedCoins, now);
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'gift_note', 'note', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto7.randomUUID().slice(0, 10)}`,
          sender.id,
          note.id,
          price,
          JSON.stringify({ receiverId: receiver.id }),
          now
        );
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Note Gift Received!', ?, 0, ?)`
        ).run(
          `ntf_${crypto7.randomUUID().slice(0, 10)}`,
          receiver.id,
          `${sender.name} gifted you "${note.title}"! It is now unlocked in My Library.`,
          now
        );
        const targetRoomId = roomId || buildDmId(sender.id, receiver.id)[0];
        if (targetRoomId.startsWith("dm_")) {
          const [dmId, ua, ub] = buildDmId(sender.id, receiver.id);
          db.prepare(
            `INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
             VALUES (?, ?, ?, ?, 'accepted', ?)`
          ).run(dmId, ua, ub, sender.id, now);
        }
        const payload = {
          noteId: note.id,
          title: note.title,
          subject: note.subject,
          priceCoins: price,
          receiverName: receiver.name
        };
        const msgId = `msg_${crypto7.randomUUID().slice(0, 10)}`;
        db.prepare(
          `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
           VALUES (?, ?, ?, 'note_gift', ?, ?, ?, ?)`
        ).run(
          msgId,
          targetRoomId,
          sender.id,
          `Gifted "${note.title}" to ${receiver.name}!`,
          JSON.stringify(payload),
          JSON.stringify([sender.id]),
          now
        );
        const hydrated = hydrateMessage({
          id: msgId,
          room_id: targetRoomId,
          sender_id: sender.id,
          message_type: "note_gift",
          body: `Gifted "${note.title}" to ${receiver.name}!`,
          image_data: "",
          payload_json: JSON.stringify(payload),
          seen_by_json: JSON.stringify([sender.id]),
          is_deleted: 0,
          created_at: now,
          sender_name: sender.name,
          sender_avatar: sender.equipped_avatar,
          sender_frame: sender.equipped_frame
        });
        return {
          coinsBalance: freshSender.coins_balance - price,
          targetRoomId,
          hydrated
        };
      })();
      broadcastToRoom(result.targetRoomId, { type: "chat:message", roomId: result.targetRoomId, message: result.hydrated });
      broadcastToUser(receiver.id, { type: "note:gifted", noteTitle: note.title, fromName: sender.name });
      checkAndUnlockAchievements(receiver.id);
      res.json({ ok: true, coinsBalance: result.coinsBalance, message: result.hydrated });
    } catch (err) {
      const msg = err.message;
      if (msg === "RECEIVER_ALREADY_OWNS") {
        res.status(400).json({ error: `${receiver.name} already owns this note` });
        return;
      }
      if (msg === "INSUFFICIENT_COINS") {
        res.status(400).json({ error: "Not enough Coins to gift this note" });
        return;
      }
      res.status(500).json({ error: "Could not complete note gift" });
    }
  });
  router.post("/send-coins", requireGoogleAuth, transferLimiter, (req, res) => {
    const sender = req.user;
    const receiverId = String(req.body?.receiverId || "");
    const roomId = String(req.body?.roomId || "");
    const amountCoins = parsePositiveIntCoins(req.body?.amountCoins);
    const senderDeviceId = String(req.headers["x-device-id"] || sender.device_id || "").slice(0, 64);
    if (amountCoins === null) {
      res.status(400).json({ error: "Enter a valid whole number of Coins" });
      return;
    }
    if (!receiverId || receiverId === sender.id) {
      res.status(400).json({ error: "Select another student to send Coins to" });
      return;
    }
    const receiver = db.prepare("SELECT id, name, is_banned, device_id FROM users WHERE id = ?").get(receiverId);
    if (!receiver || receiver.is_banned) {
      res.status(404).json({ error: "Recipient not found" });
      return;
    }
    try {
      const result = db.transaction(() => {
        const freshSender = db.prepare("SELECT coins_balance, created_at, device_id FROM users WHERE id = ?").get(sender.id);
        const completedUnlocks = db.prepare("SELECT COUNT(*) as c FROM purchases WHERE buyer_id = ? AND refunded = 0").get(sender.id).c;
        const todayPrefix = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const sentToday = db.prepare(
          "SELECT COALESCE(SUM(amount_coins), 0) as total FROM coin_transfers WHERE sender_id = ? AND substr(created_at, 1, 10) = ?"
        ).get(sender.id, todayPrefix).total;
        const errMsg = validateCoinTransferEligibility({
          amountCoins,
          senderBalance: freshSender.coins_balance,
          senderCreatedAtIso: freshSender.created_at,
          senderCompletedUnlocks: completedUnlocks,
          senderSentTodayCoins: sentToday,
          senderDeviceId: senderDeviceId || freshSender.device_id,
          receiverDeviceId: receiver.device_id
        });
        if (errMsg) {
          throw new Error(`VALIDATION:${errMsg}`);
        }
        const recentSamePair = db.prepare(
          "SELECT COUNT(*) as c FROM coin_transfers WHERE sender_id = ? AND receiver_id = ? AND datetime(created_at) >= datetime('now', '-24 hours')"
        ).get(sender.id, receiver.id).c;
        const flaggedSuspicious = recentSamePair >= 2 ? 1 : 0;
        const flagReason = flaggedSuspicious ? `${recentSamePair + 1} transfers from ${sender.name} to ${receiver.name} within 24h` : "";
        const now = (/* @__PURE__ */ new Date()).toISOString();
        db.prepare("UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?").run(amountCoins, sender.id);
        db.prepare("UPDATE users SET coins_balance = coins_balance + ? WHERE id = ?").run(amountCoins, receiver.id);
        db.prepare(
          `INSERT INTO coin_transfers (id, sender_id, receiver_id, amount_coins, flagged_suspicious, flag_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `ctr_${crypto7.randomUUID().slice(0, 10)}`,
          sender.id,
          receiver.id,
          amountCoins,
          flaggedSuspicious,
          flagReason,
          now
        );
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'coin_transfer_sent', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto7.randomUUID().slice(0, 10)}`,
          sender.id,
          -amountCoins,
          `Sent \u{1FA99}${amountCoins} to ${receiver.name}`,
          receiver.id,
          now
        );
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'coin_transfer_received', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto7.randomUUID().slice(0, 10)}`,
          receiver.id,
          amountCoins,
          `Received \u{1FA99}${amountCoins} from ${sender.name}`,
          sender.id,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'coin_transfer', 'user', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto7.randomUUID().slice(0, 10)}`,
          sender.id,
          receiver.id,
          amountCoins,
          JSON.stringify({ flaggedSuspicious, flagReason }),
          now
        );
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Coins Received!', ?, 0, ?)`
        ).run(
          `ntf_${crypto7.randomUUID().slice(0, 10)}`,
          receiver.id,
          `${sender.name} sent you \u{1FA99}${amountCoins}!`,
          now
        );
        const targetRoomId = roomId || buildDmId(sender.id, receiver.id)[0];
        if (targetRoomId.startsWith("dm_")) {
          const [dmId, ua, ub] = buildDmId(sender.id, receiver.id);
          db.prepare(
            `INSERT OR IGNORE INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
             VALUES (?, ?, ?, ?, 'accepted', ?)`
          ).run(dmId, ua, ub, sender.id, now);
        }
        const payload = {
          amountCoins,
          senderName: sender.name,
          receiverName: receiver.name,
          receiverId: receiver.id
        };
        const msgId = `msg_${crypto7.randomUUID().slice(0, 10)}`;
        db.prepare(
          `INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
           VALUES (?, ?, ?, 'coin_receipt', ?, ?, ?, ?)`
        ).run(
          msgId,
          targetRoomId,
          sender.id,
          `Sent \u{1FA99}${amountCoins} to ${receiver.name}`,
          JSON.stringify(payload),
          JSON.stringify([sender.id]),
          now
        );
        const hydrated = hydrateMessage({
          id: msgId,
          room_id: targetRoomId,
          sender_id: sender.id,
          message_type: "coin_receipt",
          body: `Sent \u{1FA99}${amountCoins} to ${receiver.name}`,
          image_data: "",
          payload_json: JSON.stringify(payload),
          seen_by_json: JSON.stringify([sender.id]),
          is_deleted: 0,
          created_at: now,
          sender_name: sender.name,
          sender_avatar: sender.equipped_avatar,
          sender_frame: sender.equipped_frame
        });
        return {
          coinsBalance: freshSender.coins_balance - amountCoins,
          targetRoomId,
          hydrated
        };
      })();
      broadcastToRoom(result.targetRoomId, { type: "chat:message", roomId: result.targetRoomId, message: result.hydrated });
      broadcastToUser(receiver.id, { type: "coin:received", amountCoins, fromName: sender.name });
      res.json({ ok: true, coinsBalance: result.coinsBalance, message: result.hydrated });
    } catch (err) {
      const msg = err.message;
      if (msg.startsWith("VALIDATION:")) {
        res.status(400).json({ error: msg.replace("VALIDATION:", "") });
        return;
      }
      res.status(500).json({ error: "Coin transfer failed" });
    }
  });
  router.post("/rooms/:roomId/mute", requireGoogleAuth, (req, res) => {
    const userId = req.user.id;
    const roomId = req.params.roomId;
    const existing = db.prepare("SELECT 1 FROM chat_mutes WHERE user_id = ? AND room_id = ?").get(userId, roomId);
    if (existing) {
      db.prepare("DELETE FROM chat_mutes WHERE user_id = ? AND room_id = ?").run(userId, roomId);
      res.json({ muted: false });
    } else {
      db.prepare("INSERT INTO chat_mutes (user_id, room_id, created_at) VALUES (?, ?, ?)").run(
        userId,
        roomId,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      res.json({ muted: true });
    }
  });
  router.post("/users/:userId/block", requireGoogleAuth, (req, res) => {
    const blockerId = req.user.id;
    const blockedId = req.params.userId;
    if (blockerId === blockedId) {
      res.status(400).json({ error: "You cannot block yourself" });
      return;
    }
    const existing = db.prepare("SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?").get(blockerId, blockedId);
    if (existing) {
      db.prepare("DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?").run(blockerId, blockedId);
      res.json({ blocked: false });
    } else {
      db.prepare("INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(
        blockerId,
        blockedId,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      res.json({ blocked: true });
    }
  });
  router.post("/messages/:messageId/report", requireGoogleAuth, (req, res) => {
    const reporter = req.user;
    const reason = String(req.body?.reason || "spam").trim().slice(0, 200);
    const msg = db.prepare("SELECT id, room_id, sender_id FROM chat_messages WHERE id = ?").get(req.params.messageId);
    if (!msg) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (msg.sender_id === reporter.id) {
      res.status(400).json({ error: "You cannot report your own message" });
      return;
    }
    try {
      let autoMuted = false;
      db.transaction(() => {
        db.prepare(
          `INSERT INTO chat_reports (id, message_id, room_id, reported_user_id, reporter_id, reason, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
        ).run(`crep_${crypto7.randomUUID().slice(0, 10)}`, msg.id, msg.room_id, msg.sender_id, reporter.id, reason, (/* @__PURE__ */ new Date()).toISOString());
        db.prepare("UPDATE users SET chat_report_count = chat_report_count + 1 WHERE id = ?").run(msg.sender_id);
        const u = db.prepare("SELECT chat_report_count FROM users WHERE id = ?").get(msg.sender_id);
        if (u.chat_report_count >= CHAT_AUTO_MUTE_REPORT_THRESHOLD) {
          db.prepare("UPDATE users SET is_chat_muted = 1 WHERE id = ?").run(msg.sender_id);
          autoMuted = true;
        }
      })();
      res.json({ ok: true, autoMuted });
    } catch {
      res.status(409).json({ error: "You already reported this message" });
    }
  });
  return router;
}

// server/routes/community.ts
import crypto8 from "node:crypto";
import express6 from "express";
function createCommunityRouter() {
  const router = express6.Router();
  const limiter = createRateLimiter("community", 30, 60 * 1e3);
  router.get("/leaderboard", (_req, res) => {
    const rows = db.prepare(
      `SELECT u.id, u.name, u.equipped_avatar, u.equipped_frame, u.coins_earned_total,
         (SELECT COUNT(*) FROM notes n WHERE n.uploader_id = u.id AND n.status = 'approved') as approved_uploads,
         (SELECT COALESCE(SUM(n.sales_count), 0) FROM notes n WHERE n.uploader_id = u.id) as total_sales,
         (SELECT COALESCE(AVG(NULLIF(n.rating_avg, 0)), 0) FROM notes n WHERE n.uploader_id = u.id AND n.rating_count > 0) as avg_rating
         FROM users u
         WHERE u.role = 'student' AND u.is_banned = 0
         ORDER BY u.coins_earned_total DESC, total_sales DESC
         LIMIT 15`
    ).all();
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
        level: getCreatorLevel(r.approved_uploads).level
      }))
    });
  });
  router.post("/users/:id/follow", requireAuth, (req, res) => {
    const followerId = req.user.id;
    const targetId = req.params.id;
    if (followerId === targetId) {
      res.status(400).json({ error: "You cannot follow yourself" });
      return;
    }
    const existing = db.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?").get(followerId, targetId);
    if (existing) {
      db.prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?").run(followerId, targetId);
      res.json({ following: false });
    } else {
      db.prepare("INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)").run(
        followerId,
        targetId,
        (/* @__PURE__ */ new Date()).toISOString()
      );
      res.json({ following: true });
    }
  });
  router.get("/notifications", requireAuth, (req, res) => {
    const items = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").all(req.user.id);
    res.json({ notifications: items });
  });
  router.post("/notifications/read", requireAuth, (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user.id);
    res.json({ ok: true });
  });
  router.get("/exam-countdown", requireAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM user_exams WHERE user_id = ?").get(req.user.id);
    if (!row) {
      res.json({ exam: null });
      return;
    }
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    res.json({
      exam: {
        examName: row.exam_name,
        examDate: row.exam_date,
        reminderDays: row.reminder_days,
        daysLeft: calculateExamCountdownDays(row.exam_date, todayStr)
      }
    });
  });
  router.put("/exam-countdown", requireAuth, (req, res) => {
    const examName = String(req.body?.examName || "").trim().slice(0, 60);
    const examDate = String(req.body?.examDate || "").trim();
    const reminderDays = Math.min(90, Math.max(1, Number(req.body?.reminderDays || 14)));
    if (!examName || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      res.status(400).json({ error: "Select an exam and valid date (YYYY-MM-DD)" });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO user_exams (user_id, exam_name, exam_date, reminder_days, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET exam_name = excluded.exam_name, exam_date = excluded.exam_date, reminder_days = excluded.reminder_days, updated_at = excluded.updated_at`
    ).run(req.user.id, examName, examDate, reminderDays, now);
    const todayStr = now.slice(0, 10);
    res.json({
      ok: true,
      exam: {
        examName,
        examDate,
        reminderDays,
        daysLeft: calculateExamCountdownDays(examDate, todayStr)
      }
    });
  });
  router.get("/gemini-requests", (req, res) => {
    const userId = req.user?.id;
    const rows = db.prepare(
      `SELECT gr.*, u.name as requester_name
         FROM gemini_requests gr
         JOIN users u ON u.id = gr.user_id
         ORDER BY gr.status ASC, gr.votes_count DESC, gr.created_at DESC`
    ).all();
    const myVotes = userId ? new Set(
      db.prepare("SELECT request_id FROM gemini_request_votes WHERE user_id = ?").all(userId).map((r) => r.request_id)
    ) : /* @__PURE__ */ new Set();
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
        createdAt: r.created_at
      }))
    });
  });
  router.post("/gemini-requests", requireAuth, limiter, (req, res) => {
    const topic = String(req.body?.topic || "").trim().slice(0, 120);
    const subject = String(req.body?.subject || "").trim().slice(0, 40);
    const examClass = String(req.body?.examClass || "").trim().slice(0, 40);
    if (topic.length < 5 || !subject || !examClass) {
      res.status(400).json({ error: "Topic (5+ chars), subject, and exam are required" });
      return;
    }
    const id = `greq_${crypto8.randomUUID().slice(0, 10)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO gemini_requests (id, user_id, topic, subject, exam_class, votes_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 'open', ?)`
      ).run(id, req.user.id, topic, subject, examClass, now);
      db.prepare(
        "INSERT INTO gemini_request_votes (request_id, user_id, created_at) VALUES (?, ?, ?)"
      ).run(id, req.user.id, now);
    })();
    res.status(201).json({ ok: true, id });
  });
  router.post("/gemini-requests/:id/vote", requireAuth, limiter, (req, res) => {
    const reqId = req.params.id;
    const userId = req.user.id;
    const existing = db.prepare("SELECT 1 FROM gemini_request_votes WHERE request_id = ? AND user_id = ?").get(reqId, userId);
    db.transaction(() => {
      if (existing) {
        db.prepare("DELETE FROM gemini_request_votes WHERE request_id = ? AND user_id = ?").run(reqId, userId);
        db.prepare("UPDATE gemini_requests SET votes_count = MAX(0, votes_count - 1) WHERE id = ?").run(reqId);
      } else {
        db.prepare(
          "INSERT INTO gemini_request_votes (request_id, user_id, created_at) VALUES (?, ?, ?)"
        ).run(reqId, userId, (/* @__PURE__ */ new Date()).toISOString());
        db.prepare("UPDATE gemini_requests SET votes_count = votes_count + 1 WHERE id = ?").run(reqId);
      }
    })();
    res.json({ voted: !existing });
  });
  router.get("/doubts", (_req, res) => {
    const doubts = db.prepare(
      `SELECT d.*, u.name as author_name, u.equipped_avatar as author_avatar
         FROM doubts d
         JOIN users u ON u.id = d.user_id
         ORDER BY d.status DESC, d.created_at DESC
         LIMIT 40`
    ).all();
    const answersStmt = db.prepare(
      `SELECT da.*, u.name as author_name, u.equipped_avatar as author_avatar
       FROM doubt_answers da
       JOIN users u ON u.id = da.user_id
       WHERE da.doubt_id = ?
       ORDER BY da.is_best DESC, da.created_at ASC`
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
        answers: answersStmt.all(d.id).map((a) => ({
          id: a.id,
          userId: a.user_id,
          authorName: a.author_name,
          authorAvatar: a.author_avatar,
          body: a.body,
          isBest: Boolean(a.is_best),
          rewardCoins: a.reward_coins,
          createdAt: a.created_at
        }))
      }))
    });
  });
  router.post("/doubts", requireAuth, limiter, (req, res) => {
    const title = String(req.body?.title || "").trim().slice(0, 140);
    const body = String(req.body?.body || "").trim().slice(0, 1e3);
    const subject = String(req.body?.subject || "").trim().slice(0, 40);
    const examClass = String(req.body?.examClass || "").trim().slice(0, 40);
    if (title.length < 6 || body.length < 10 || !subject || !examClass) {
      res.status(400).json({ error: "Provide a clear question title, details, subject, and exam" });
      return;
    }
    const id = `dbt_${crypto8.randomUUID().slice(0, 10)}`;
    db.prepare(
      `INSERT INTO doubts (id, user_id, subject, exam_class, title, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
    ).run(id, req.user.id, subject, examClass, title, body, (/* @__PURE__ */ new Date()).toISOString());
    res.status(201).json({ ok: true, id });
  });
  router.post("/doubts/:id/answers", requireAuth, limiter, (req, res) => {
    const doubt = db.prepare("SELECT id, user_id FROM doubts WHERE id = ?").get(req.params.id);
    if (!doubt) {
      res.status(404).json({ error: "Doubt not found" });
      return;
    }
    const body = String(req.body?.body || "").trim().slice(0, 1e3);
    if (body.length < 5) {
      res.status(400).json({ error: "Answer must be at least 5 characters" });
      return;
    }
    const id = `ans_${crypto8.randomUUID().slice(0, 10)}`;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO doubt_answers (id, doubt_id, user_id, body, is_best, reward_coins, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?)`
    ).run(id, doubt.id, req.user.id, body, now);
    if (doubt.user_id !== req.user.id) {
      db.prepare(
        `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
         VALUES (?, ?, 'New Doubt Answer', ?, 0, ?)`
      ).run(`ntf_${crypto8.randomUUID().slice(0, 10)}`, doubt.user_id, `${req.user.name} answered your doubt!`, now);
    }
    res.status(201).json({ ok: true, id });
  });
  router.post("/doubts/:id/best-answer", requireAuth, limiter, (req, res) => {
    const asker = req.user;
    const answerId = String(req.body?.answerId || "");
    const rewardCoins = parsePositiveIntCoins(req.body?.rewardCoins);
    if (rewardCoins === null) {
      res.status(400).json({ error: "Enter a valid whole number of Coins (1 to 5)" });
      return;
    }
    const errMsg = validateDoubtRewardCoins(rewardCoins);
    if (errMsg) {
      res.status(400).json({ error: errMsg });
      return;
    }
    try {
      const updatedBalance = db.transaction(() => {
        const doubt = db.prepare("SELECT * FROM doubts WHERE id = ?").get(req.params.id);
        if (!doubt) throw new Error("NOT_FOUND");
        if (doubt.user_id !== asker.id) throw new Error("FORBIDDEN");
        if (doubt.status === "resolved") throw new Error("ALREADY_RESOLVED");
        const answer = db.prepare("SELECT * FROM doubt_answers WHERE id = ? AND doubt_id = ?").get(answerId, doubt.id);
        if (!answer) throw new Error("ANSWER_NOT_FOUND");
        if (answer.user_id === asker.id) throw new Error("SELF_REWARD");
        const freshAsker = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(asker.id);
        if (freshAsker.coins_balance < rewardCoins) throw new Error("INSUFFICIENT_COINS");
        const now = (/* @__PURE__ */ new Date()).toISOString();
        db.prepare("UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?").run(rewardCoins, asker.id);
        db.prepare(
          "UPDATE users SET coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?"
        ).run(rewardCoins, rewardCoins, answer.user_id);
        db.prepare("UPDATE doubts SET best_answer_id = ?, status = 'resolved' WHERE id = ?").run(answer.id, doubt.id);
        db.prepare("UPDATE doubt_answers SET is_best = 1, reward_coins = ? WHERE id = ?").run(rewardCoins, answer.id);
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'doubt_reward_sent', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto8.randomUUID().slice(0, 10)}`,
          asker.id,
          -rewardCoins,
          `Rewarded best answer on "${doubt.title}"`,
          doubt.id,
          now
        );
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'doubt_reward_received', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto8.randomUUID().slice(0, 10)}`,
          answer.user_id,
          rewardCoins,
          `Best answer reward on "${doubt.title}"`,
          doubt.id,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'doubt_best_answer', 'doubt', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto8.randomUUID().slice(0, 10)}`,
          asker.id,
          doubt.id,
          rewardCoins,
          JSON.stringify({ receiverId: answer.user_id, answerId: answer.id }),
          now
        );
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Doubt Reward!', ?, 0, ?)`
        ).run(
          `ntf_${crypto8.randomUUID().slice(0, 10)}`,
          answer.user_id,
          `${asker.name} marked your answer as Best and sent +\u{1FA99}${rewardCoins}!`,
          now
        );
        return freshAsker.coins_balance - rewardCoins;
      })();
      const helperUserId = db.prepare("SELECT user_id FROM doubt_answers WHERE id = ?").get(answerId)?.user_id;
      if (helperUserId) checkAndUnlockAchievements(helperUserId);
      res.json({ ok: true, coinsBalance: updatedBalance });
    } catch (err) {
      const msg = err.message;
      const map = {
        NOT_FOUND: [404, "Doubt not found"],
        FORBIDDEN: [403, "Only the question author can pick the best answer"],
        ALREADY_RESOLVED: [400, "Best answer was already rewarded"],
        ANSWER_NOT_FOUND: [404, "Answer not found"],
        SELF_REWARD: [400, "You cannot reward your own answer"],
        INSUFFICIENT_COINS: [400, "Not enough Coins to send that reward"]
      };
      const [status, text] = map[msg] || [500, "Could not reward answer"];
      res.status(status).json({ error: text });
    }
  });
  return router;
}

// server/routes/wallet.ts
import crypto9 from "node:crypto";
import express7 from "express";
function createWalletRouter() {
  const router = express7.Router();
  const redeemLimiter = createRateLimiter("redeem", 10, 5 * 60 * 1e3);
  const actionLimiter = createRateLimiter("wallet_action", 25, 60 * 1e3);
  router.get("/", requireAuth, (req, res) => {
    const user = req.user;
    const category = String(req.query.category || "all");
    let where = "user_id = ?";
    const params = [user.id];
    if (["earned", "spent", "redeemed"].includes(category)) {
      where += " AND category = ?";
      params.push(category);
    }
    const transactions = db.prepare(
      `SELECT id, category, type, amount_coins, description, ref_id, created_at
         FROM coin_transactions
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT 80`
    ).all(...params);
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const streakInfo = calculateDailyStreakReward(user.streak_days, user.last_streak_date, todayStr);
    const spinInfo = isSpinEligible(user.last_spin_at);
    const referredCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE referred_by = ?").get(user.id).c;
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
      transactions
    });
  });
  router.post("/streak", requireAuth, actionLimiter, (req, res) => {
    const user = req.user;
    const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const result = db.transaction(() => {
        const fresh = db.prepare("SELECT streak_days, last_streak_date, coins_balance FROM users WHERE id = ?").get(user.id);
        const reward = calculateDailyStreakReward(fresh.streak_days, fresh.last_streak_date, todayStr);
        if (!reward.eligible) {
          throw new Error("ALREADY_CLAIMED");
        }
        db.prepare(
          `UPDATE users SET streak_days = ?, last_streak_date = ?, coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ?
           WHERE id = ?`
        ).run(reward.newStreak, todayStr, reward.coinsAwarded, reward.coinsAwarded, user.id);
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'earned', 'daily_streak', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto9.randomUUID().slice(0, 10)}`,
          user.id,
          reward.coinsAwarded,
          reward.isSevenDayBonus ? `Day ${reward.newStreak} Streak (+1 daily + 3 7-day bonus!)` : `Day ${reward.newStreak} Daily Streak`,
          todayStr,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'daily_streak', 'user', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto9.randomUUID().slice(0, 10)}`,
          user.id,
          user.id,
          reward.coinsAwarded,
          JSON.stringify({ streak: reward.newStreak, isSevenDayBonus: reward.isSevenDayBonus }),
          now
        );
        return {
          ...reward,
          coinsBalance: fresh.coins_balance + reward.coinsAwarded
        };
      })();
      const newlyUnlocked = checkAndUnlockAchievements(user.id);
      res.json({ ok: true, ...result, newlyUnlocked });
    } catch (err) {
      if (err.message === "ALREADY_CLAIMED") {
        res.status(400).json({ error: "Today\u2019s daily streak Coins are already claimed. Come back tomorrow!" });
        return;
      }
      res.status(500).json({ error: "Failed to claim streak" });
    }
  });
  router.post("/spin", requireAuth, actionLimiter, (req, res) => {
    const user = req.user;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const result = db.transaction(() => {
        const fresh = db.prepare("SELECT last_spin_at, coins_balance FROM users WHERE id = ?").get(user.id);
        const eligibility = isSpinEligible(fresh.last_spin_at);
        if (!eligibility.eligible) {
          throw new Error(`COOLDOWN:${eligibility.nextSpinAt}`);
        }
        const pick = pickSpinWheelSlice();
        db.prepare(
          "UPDATE users SET last_spin_at = ?, coins_balance = coins_balance + ?, coins_earned_total = coins_earned_total + ? WHERE id = ?"
        ).run(now, pick.coins, pick.coins, user.id);
        if (pick.coins > 0) {
          db.prepare(
            `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
             VALUES (?, ?, 'earned', 'daily_spin', ?, ?, 'spin_wheel', ?)`
          ).run(
            `tx_${crypto9.randomUUID().slice(0, 10)}`,
            user.id,
            pick.coins,
            `Daily Spin Wheel reward (+${pick.coins} Coins)`,
            now
          );
        }
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'daily_spin', 'user', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto9.randomUUID().slice(0, 10)}`,
          user.id,
          user.id,
          pick.coins,
          JSON.stringify({ sliceIndex: pick.sliceIndex }),
          now
        );
        return {
          sliceIndex: pick.sliceIndex,
          coinsAwarded: pick.coins,
          coinsBalance: fresh.coins_balance + pick.coins,
          nextSpinAt: new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString()
        };
      })();
      const newlyUnlocked = checkAndUnlockAchievements(user.id);
      res.json({ ok: true, ...result, newlyUnlocked });
    } catch (err) {
      const msg = err.message;
      if (msg.startsWith("COOLDOWN:")) {
        res.status(400).json({ error: "Spin wheel available once every 24 hours. Try again later!" });
        return;
      }
      res.status(500).json({ error: "Could not spin wheel" });
    }
  });
  router.post("/redeem", requireAuth, redeemLimiter, (req, res) => {
    const user = req.user;
    const code = normalizeCode(String(req.body?.code || ""));
    if (!code || code.length < 3) {
      res.status(400).json({ error: "Enter a valid redeem code" });
      return;
    }
    const freshUser = db.prepare("SELECT redeem_failed_attempts, redeem_locked_until, coins_balance FROM users WHERE id = ?").get(user.id);
    if (isRedeemLocked(freshUser.redeem_failed_attempts, freshUser.redeem_locked_until)) {
      res.status(429).json({
        error: `Too many wrong attempts. Redeem codes are locked for ${REDEEM_LOCK_MINUTES} minutes.`
      });
      return;
    }
    const codeRow = db.prepare("SELECT * FROM redeem_codes WHERE code = ?").get(code);
    if (!codeRow || !codeRow.is_active || Date.parse(codeRow.expires_at) < Date.now()) {
      const nextAttempts = freshUser.redeem_failed_attempts + 1;
      const lockedUntil = nextAttempts >= REDEEM_MAX_ATTEMPTS ? new Date(Date.now() + REDEEM_LOCK_MINUTES * 60 * 1e3).toISOString() : null;
      db.prepare("UPDATE users SET redeem_failed_attempts = ?, redeem_locked_until = ? WHERE id = ?").run(
        nextAttempts,
        lockedUntil,
        user.id
      );
      const remaining = Math.max(0, REDEEM_MAX_ATTEMPTS - nextAttempts);
      res.status(400).json({
        error: remaining === 0 ? `Code invalid or expired. Locked for ${REDEEM_LOCK_MINUTES} minutes.` : `Invalid or expired code (${remaining} attempts remaining).`
      });
      return;
    }
    if (codeRow.used_count >= codeRow.usage_limit) {
      res.status(400).json({ error: "This redeem code has reached its usage limit" });
      return;
    }
    try {
      const result = db.transaction(() => {
        const alreadyUsed = db.prepare("SELECT 1 FROM redeem_usages WHERE code_id = ? AND user_id = ?").get(codeRow.id, user.id);
        if (alreadyUsed) {
          throw new Error("ALREADY_REDEEMED");
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        db.prepare("INSERT INTO redeem_usages (id, code_id, user_id, created_at) VALUES (?, ?, ?, ?)").run(
          `ru_${crypto9.randomUUID().slice(0, 10)}`,
          codeRow.id,
          user.id,
          now
        );
        db.prepare("UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?").run(codeRow.id);
        db.prepare(
          "UPDATE users SET coins_balance = coins_balance + ?, redeem_failed_attempts = 0, redeem_locked_until = NULL WHERE id = ?"
        ).run(codeRow.value_coins, user.id);
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'redeemed', 'redeem_code', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto9.randomUUID().slice(0, 10)}`,
          user.id,
          codeRow.value_coins,
          `Redeemed code ${codeRow.code}${codeRow.note ? ` (${codeRow.note})` : ""}`,
          codeRow.id,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'redeem_code', 'redeem_code', ?, ?, ?, ?)`
        ).run(
          `aud_${crypto9.randomUUID().slice(0, 10)}`,
          user.id,
          codeRow.id,
          codeRow.value_coins,
          JSON.stringify({ code: codeRow.code }),
          now
        );
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
           VALUES (?, ?, 'Code Redeemed!', ?, 0, ?)`
        ).run(
          `ntf_${crypto9.randomUUID().slice(0, 10)}`,
          user.id,
          `Code ${codeRow.code} added +\u{1FA99}${codeRow.value_coins} to your balance.`,
          now
        );
        const updatedBalance = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(user.id).coins_balance;
        return { updatedBalance };
      })();
      res.json({
        ok: true,
        coinsAdded: codeRow.value_coins,
        note: codeRow.note,
        coinsBalance: result.updatedBalance
      });
    } catch (err) {
      if (err.message === "ALREADY_REDEEMED") {
        res.status(409).json({ error: "You have already redeemed this code" });
        return;
      }
      res.status(500).json({ error: "Could not redeem code" });
    }
  });
  router.get("/shop", requireAuth, (req, res) => {
    const user = req.user;
    const items = db.prepare("SELECT * FROM shop_items ORDER BY kind, price_coins").all();
    const ownedIds = new Set(
      db.prepare("SELECT item_id FROM user_inventory WHERE user_id = ?").all(user.id).map((r) => r.item_id)
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
        equipped: it.kind === "theme" && user.equipped_theme === it.key || it.kind === "avatar" && user.equipped_avatar === it.key || it.kind === "frame" && user.equipped_frame === it.key
      }))
    });
  });
  router.post("/shop/:id/buy", requireAuth, actionLimiter, (req, res) => {
    const user = req.user;
    const item = db.prepare("SELECT * FROM shop_items WHERE id = ?").get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Shop item not found" });
      return;
    }
    try {
      const updatedBalance = db.transaction(() => {
        const owned = db.prepare("SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?").get(user.id, item.id);
        if (owned) throw new Error("ALREADY_OWNED");
        const fresh = db.prepare("SELECT coins_balance FROM users WHERE id = ?").get(user.id);
        if (fresh.coins_balance < item.price_coins) throw new Error("INSUFFICIENT_COINS");
        const now = (/* @__PURE__ */ new Date()).toISOString();
        db.prepare("UPDATE users SET coins_balance = coins_balance - ? WHERE id = ?").run(item.price_coins, user.id);
        db.prepare("INSERT INTO user_inventory (user_id, item_id, purchased_at) VALUES (?, ?, ?)").run(
          user.id,
          item.id,
          now
        );
        const col = item.kind === "theme" ? "equipped_theme" : item.kind === "avatar" ? "equipped_avatar" : "equipped_frame";
        db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(item.key, user.id);
        db.prepare(
          `INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
           VALUES (?, ?, 'spent', 'shop_purchase', ?, ?, ?, ?)`
        ).run(
          `tx_${crypto9.randomUUID().slice(0, 10)}`,
          user.id,
          -item.price_coins,
          `Bought ${item.name} in Coin Shop`,
          item.id,
          now
        );
        db.prepare(
          `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, amount_coins, metadata, created_at)
           VALUES (?, ?, 'shop_purchase', 'shop_item', ?, ?, '{}', ?)`
        ).run(`aud_${crypto9.randomUUID().slice(0, 10)}`, user.id, item.id, item.price_coins, now);
        return fresh.coins_balance - item.price_coins;
      })();
      res.json({ ok: true, coinsBalance: updatedBalance });
    } catch (err) {
      const msg = err.message;
      if (msg === "ALREADY_OWNED") {
        res.status(409).json({ error: "You already own this item" });
        return;
      }
      if (msg === "INSUFFICIENT_COINS") {
        res.status(400).json({ error: "Not enough Coins for this item" });
        return;
      }
      res.status(500).json({ error: "Purchase failed" });
    }
  });
  router.post("/shop/:id/equip", requireAuth, (req, res) => {
    const user = req.user;
    const item = db.prepare("SELECT * FROM shop_items WHERE id = ?").get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    const owned = db.prepare("SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ?").get(user.id, item.id);
    if (!owned) {
      res.status(403).json({ error: "Unlock this item in the Coin Shop first" });
      return;
    }
    const col = item.kind === "theme" ? "equipped_theme" : item.kind === "avatar" ? "equipped_avatar" : "equipped_frame";
    db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(item.key, user.id);
    res.json({ ok: true });
  });
  return router;
}

// server.ts
async function startServer() {
  initDatabase();
  setInterval(() => {
    try {
      purgeExpiredChatHistory();
    } catch {
    }
  }, 60 * 60 * 1e3);
  const app = express8();
  app.set("trust proxy", 1);
  app.use(express8.json({ limit: "4mb" }));
  app.use("/api", csrfProtection);
  app.use("/api", attachOptionalUser);
  app.use("/api/auth", createAuthRouter());
  app.use("/api/notes", createNotesRouter());
  app.use("/api/notes", createAiRouter());
  app.use("/api/wallet", createWalletRouter());
  app.use("/api/community", createCommunityRouter());
  app.use("/api/chat", createChatRouter());
  app.use("/api/admin", createAdminRouter());
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "NoteSwap" });
  });
  const server = http.createServer(app);
  const wss = new WebSocketServer2({ server, path: "/ws" });
  setupWebSocketHub(wss);
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path5.resolve(process.cwd(), "dist");
    app.use(express8.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path5.join(distDir, "index.html"));
    });
  }
  const PORT = Number(process.env.PORT || 3e3);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`NoteSwap server running on http://localhost:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start NoteSwap server:", err);
  process.exit(1);
});
