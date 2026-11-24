import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateReferralCode,
  WELCOME_BONUS_COINS,
} from './domain';

const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });
const DB_PATH = path.join(STORAGE_DIR, 'noteswap.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
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

export function purgeExpiredChatHistory(): void {
  db.prepare(
    `DELETE FROM chat_messages WHERE datetime(created_at) < datetime('now', '-30 days')`,
  ).run();
}

function seedInitialData(): void {
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  if (userCount > 0) return;

  const now = new Date().toISOString();
  const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const futureExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const examSoon = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const seedUsers = [
    {
      id: 'usr_admin',
      google_id: 'google_admin_hitz90541',
      name: 'NoteSwap Admin',
      email: 'hitz90541@gmail.com',
      role: 'admin',
      is_minor: 0,
      device_id: 'dev_seed_admin',
      coins_balance: 100,
      coins_earned_total: 0,
      streak_days: 3,
      last_streak_date: yesterday,
      referral_code: 'ADMIN1',
    },
    {
      id: 'usr_arjun',
      google_id: 'google_arjun_1042',
      name: 'Arjun Mehta',
      email: 'arjun@student.edu.in',
      role: 'student',
      is_minor: 0,
      device_id: 'dev_seed_arjun',
      coins_balance: 34,
      coins_earned_total: 10,
      streak_days: 6,
      last_streak_date: yesterday,
      referral_code: generateReferralCode('Arjun', '1042'),
    },
    {
      id: 'usr_priya',
      google_id: 'google_priya_2084',
      name: 'Priya Sharma',
      email: 'priya@iitb.ac.in',
      role: 'student',
      is_minor: 0,
      device_id: 'dev_seed_priya',
      coins_balance: 54,
      coins_earned_total: 10,
      streak_days: 4,
      last_streak_date: yesterday,
      referral_code: generateReferralCode('Priya', '2084'),
    },
    {
      id: 'usr_rohan',
      google_id: 'google_rohan_3099',
      name: 'Rohan Verma',
      email: 'rohan@aiims.edu',
      role: 'student',
      is_minor: 1, // Minor account to test stranger DM safety guard
      device_id: 'dev_seed_rohan',
      coins_balance: 35,
      coins_earned_total: 10,
      streak_days: 2,
      last_streak_date: yesterday,
      referral_code: generateReferralCode('Rohan', '3099'),
    },
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

  db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`).run('coins_burned_total', '0');
  db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`).run('coins_minted_total', '30');
  db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`).run(
    'admin_passcode_hash',
    '43d357d372d0a2fb106974077d055345:2224bb614870f005c921f3c0e0d3eb88d7d15937994c7976fc66e7a39c1fb8249bc854f72891db251fcedb5eaf83a04b556b7332799ff7f14a09a91dcc8dfb38',
  );

  // Notes are never pre-seeded; all notes in the marketplace are uploaded by students.

  const insertReq = db.prepare(`
    INSERT INTO gemini_requests (id, user_id, topic, subject, exam_class, votes_count, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `);
  insertReq.run('greq_1', 'usr_arjun', 'Operating Systems Deadlocks, Paging & Virtual Memory', 'Computer Science', 'B.Tech / GATE CS', 18, now);
  insertReq.run('greq_2', 'usr_rohan', 'Human Physiology & Neural Control NCERT Mindmaps', 'Biology', 'NEET & Class 12', 14, now);
  insertReq.run('greq_3', 'usr_priya', 'Modern Indian History Timeline (1857–1947)', 'General Studies', 'UPSC / SSC / CUET', 9, now);
  db.prepare(`INSERT INTO gemini_request_votes (request_id, user_id, created_at) VALUES ('greq_1', 'usr_arjun', ?)`).run(now);

  const insertTx = db.prepare(`
    INSERT INTO coin_transactions (id, user_id, category, type, amount_coins, description, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertTx.run('tx_1', 'usr_arjun', 'earned', 'welcome_bonus', WELCOME_BONUS_COINS, 'Welcome bonus on first Google login', 'signup', now);

  const insertCode = db.prepare(`
    INSERT INTO redeem_codes (id, code, value_coins, usage_limit, used_count, per_user_limit, expires_at, note, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCode.run('rc_diwali', 'DIWALI20', 20, 100, 0, 1, futureExpiry, 'Diwali Study Boost', 1, now);
  insertCode.run('rc_study10', 'STUDY10', 10, 50, 0, 1, futureExpiry, 'Exam Week Bonus', 1, now);

  const insertShop = db.prepare(`
    INSERT INTO shop_items (id, kind, key, name, description, price_coins, preview_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertShop.run('shp_theme_emerald', 'theme', 'emerald', 'Emerald Focus Theme', 'Crisp botanical emerald accent across cards and buttons.', 8, '#059669');
  insertShop.run('shp_theme_amber', 'theme', 'amber', 'Royal Amber Theme', 'Warm scholar gold accent for exam season.', 10, '#d97706');
  insertShop.run('shp_theme_rose', 'theme', 'rose', 'Crimson Ink Theme', 'Bold crimson notebook highlight accent.', 10, '#e11d48');
  insertShop.run('shp_avatar_owl', 'avatar', 'owl', 'Night Owl Scholar', 'Late-night revision specialist avatar.', 6, '🦉');
  insertShop.run('shp_avatar_rocket', 'avatar', 'rocket', 'Top Ranker Rocket', 'High-velocity exam sprint avatar.', 8, '🚀');
  insertShop.run('shp_avatar_atom', 'avatar', 'atom', 'Quantum Mind', 'Physics & STEM specialist emblem.', 8, '⚛️');
  insertShop.run('shp_frame_gold', 'frame', 'gold', 'Golden Scholar Ring', 'Radiant gold border ring around your profile badge.', 12, 'ring-amber-400');
  insertShop.run('shp_frame_emerald', 'frame', 'emerald', 'Emerald Circuit Frame', 'Sleek emerald double-ring profile frame.', 10, 'ring-emerald-500');

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

  // Seed Chat Rooms
  const insertRoom = db.prepare(`
    INSERT INTO chat_rooms (id, slug, name, category, description)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertRoom.run('room_lounge', 'study-lounge', 'Study Lounge', 'Global', 'Open room for study motivation, quick tips, and note recommendations.');
  insertRoom.run('room_jee', 'jee', 'JEE Main & Adv', 'Exam', 'Physics, Calculus, Organic Chemistry, and JEE mock test prep.');
  insertRoom.run('room_neet', 'neet', 'NEET & Class 12', 'Exam', 'NCERT Biology, Chemistry, and Class 12 board revision.');
  insertRoom.run('room_gate', 'gate-cs', 'GATE CS & B.Tech', 'Subject', 'DSA, OS, DBMS, System Design, and placement preparation.');
  insertRoom.run('room_upsc', 'upsc-cuet', 'UPSC & CUET', 'Exam', 'Polity, History, Current Affairs, and CUET UG prep.');

  // Seed accepted DM thread between Arjun and Priya
  db.prepare(`
    INSERT INTO dm_threads (id, user_a, user_b, requester_id, status, created_at)
    VALUES ('dm_arjun_priya', 'usr_arjun', 'usr_priya', 'usr_arjun', 'accepted', ?)
  `).run(threeDaysAgo);

  const insertMsg = db.prepare(`
    INSERT INTO chat_messages (id, room_id, sender_id, message_type, body, payload_json, seen_by_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMsg.run(
    'msg_seed_1',
    'room_lounge',
    'usr_priya',
    'text',
    'Welcome to Study Lounge! Looking forward to swapping handwritten notes with everyone.',
    '{}',
    JSON.stringify(['usr_arjun', 'usr_priya']),
    now,
  );
  insertMsg.run(
    'msg_seed_2',
    'dm_arjun_priya',
    'usr_priya',
    'text',
    'Hey Arjun, let me know which Physics topics you are revising this week!',
    '{}',
    JSON.stringify(['usr_arjun', 'usr_priya']),
    now,
  );

  db.prepare(`
    INSERT INTO notifications (id, user_id, title, message, is_read, created_at)
    VALUES ('notif_1', 'usr_arjun', 'Welcome to NoteSwap!', 'You received 10 Coins on signup. Upload your first study note or try the Daily Spin Wheel!', 0, ?)
  `).run(now);
}
