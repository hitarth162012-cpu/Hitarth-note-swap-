# NoteSwap — Virtual Coin Study Note Marketplace & Live Study Community

**NoteSwap** is a mobile-first full-stack web application where students share, preview, unlock, and study private academic notes using an in-app virtual **Coin (`🪙`)** economy (zero real money, no payment gateways, and no cash value).

---

## Features

- **Virtual Coin Economy (`🪙`)**:
  - **🪙10 Welcome Bonus** on first Google login
  - **Daily Streak** (`🪙1/day`, `+🪙3` bonus on 7-day streak) & **24h Server-Decided Spin Wheel** (`🪙0–5`)
  - **Upload Rewards** (`🪙0–2` per approved note) & **50% Creator Split** (`Math.floor(price / 2)`, remainder removed from circulation)
  - **Redeem Codes** with server-side validation, `per_user_limit = 1`, rate limiting, 5-attempt lockout, and confetti animation
  - **Referral Bonus** (`+🪙5` each after referred friend's first paid unlock)
  - **Coin Shop** for custom accent themes, avatars, and profile frames
  - **24-Hour Coin Refunds** reviewed by Admin
- **Private Note Protection & Secure Viewer**:
  - Private files stored in `storage/private_notes/` and served only via short-lived HMAC-signed URLs after purchase verification
  - Blurred low-res page 1 teaser previews prior to unlock
  - In-app viewer with disabled download buttons, disabled right-click/text-selection, and dynamic buyer watermark overlay
- **Gemini AI Study Assistant (`@google/genai`)**:
  - Server-side **Summary**, **10 Interactive Flashcards**, and **5-Question Quiz** (scoring `>= 4/5` awards `+🪙1`, max 3 quiz rewards/day)
  - **Ask This Note**: grounded Q&A answering strictly from the unlocked note's content
- **Live Study Chat & Sharing (`ws`)**:
  - Public **Study Lounge** + exam/subject rooms + 1-to-1 DMs with typing indicators, online presence, sent/seen ticks, 50-message pagination, and image attachments (max 2 MB)
  - **Send Coins (`🪙1–50`)** with anti-abuse safeguards (`24h+` account age, `1+` completed unlock, `🪙100/day` cap, same-device block, suspicious pattern flagging)
  - **Gift a Note** & **Share Note Preview Card** (never leaks private files or signed URLs)
  - Under-18 DM safety mode, first-stranger message requests, 20 msgs/min rate limit, profanity/external-link filtering, auto-mute at 3 reports, and 30-day message retention
- **Engagement & Admin Console**:
  - Doubt Forum (`🪙1–5` best-answer reward), Exam Countdown + *"Notes for Your Exam"*, PYQs, Official Gemini Notes & Bundles, Gemini Topic Requests, Leaderboard, Dark Mode, English + Hindi (`EN | हिं`)
  - Admin Dashboard with Top Subjects, 24h Peak Activity Hours, Zero-Result Search Keywords, Review Queue, Redeem Codes, Refunds, and Reported-Chats-Only Moderation

---

## Folder Structure

```text
├── server.ts                  # Express + WebSocket + Vite dev/prod server (port 3000)
├── server/
│   ├── db.ts                  # SQLite schema (better-sqlite3) & deterministic seed data
│   ├── domain.ts              # Pure Coin math, streak, spin wheel, anti-abuse & moderation rules
│   ├── domain.test.ts         # Node test suite for domain logic
│   ├── security.ts            # scrypt hashing, HMAC session tokens, cookies, rate limits, CSRF
│   ├── noteRenderer.ts        # Blurred SVG teaser & watermarked study page renderer
│   ├── achievements.ts        # Achievement definitions & unlock evaluator
│   ├── ws.ts                  # WebSocket hub for rooms, presence, typing, and live events
│   └── routes/
│       ├── auth.ts            # Google login, Email OTP, Demo switch, Admin first-run claim
│       ├── notes.ts           # Feed/search, private viewer URLs, upload dedup, atomic unlock, refunds
│       ├── ai.ts              # Server-side Gemini AI summary, flashcards, quiz, grounded Q&A
│       ├── wallet.ts          # Wallet balance, daily streak, spin wheel, redeem codes, Coin Shop
│       ├── community.ts       # Leaderboard, follows, notifications, exam countdown, doubts, requests
│       └── chat.ts            # Rooms, DMs, Send Coins, Gift Note, Share Card, safety reports
├── src/
│   ├── App.tsx                # Root SPA router, theme/language state, WebSocket notifications
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── i18n.ts                # English & Hindi translations + theme/avatar maps
│   ├── lib/api.ts             # CSRF & Device-ID aware fetch wrapper
│   ├── components/            # Header, BottomNav, NoteCard, SecureViewer, AuthModal, CoinEffects
│   └── pages/                 # Home, Search, NoteDetail, Upload, Wallet, Library, Doubts, Leaderboard, Chat, Profile, Admin
└── storage/
    ├── noteswap.db            # SQLite database (auto-created & seeded on startup)
    └── private_notes/         # Private note files & uploads (never statically served)
```

---

## Database Schema Overview (`server/db.ts`)

- **Core Users & Economy**: `users`, `coin_transactions`, `audit_logs`, `redeem_codes`, `redeem_usages`, `shop_items`, `user_inventory`, `user_achievements`, `app_settings`
- **Notes & Learning**: `notes`, `purchases`, `refund_requests`, `reviews`, `bookmarks`, `reports`, `note_ai_kits`, `quiz_attempts`, `gemini_bundles`, `gemini_bundle_items`, `gemini_requests`, `gemini_request_votes`
- **Community & Engagement**: `doubts`, `doubt_answers`, `user_exams`, `follows`, `notifications`, `search_logs`, `otp_challenges`
- **Live Chat & Safety**: `chat_rooms`, `dm_threads`, `chat_messages`, `chat_mutes`, `user_blocks`, `chat_reports`, `coin_transfers`

---

## Setup & Deployment

### Environment Variables (`.env.example`)
- `GEMINI_API_KEY` — Required for AI Summary, Flashcards, Quiz, and Ask-This-Note features
- `APP_URL` — Hosting origin URL
- `GOOGLE_CLIENT_ID` *(optional)* — Enable live Google OAuth token verification (falls back to Google Sign-In Test Mode when omitted)
- `ADMIN_PASSCODE` *(optional)* — Pre-set admin passcode (otherwise first-run Admin Claim sets it securely in SQLite)

### Commands
```bash
npm install
npx tsx --test server/domain.test.ts   # Run unit tests
npm run dev                            # Start dev server on http://localhost:3000
npm run build && npm start             # Production build & start
```
