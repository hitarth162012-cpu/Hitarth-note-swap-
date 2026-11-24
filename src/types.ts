export type Language = 'en' | 'hi';

export type NavTab =
  | 'home'
  | 'search'
  | 'chat'
  | 'upload'
  | 'wallet'
  | 'profile'
  | 'library'
  | 'doubts'
  | 'leaderboard'
  | 'admin'
  | 'note';

export interface AchievementItem {
  key?: string;
  achievement_key?: string;
  title: string;
  description: string;
  icon: string;
  unlocked_at?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'student' | 'admin';
  authProvider: 'google' | 'firebase_email' | 'otp';
  isMinor: boolean;
  isChatMuted: boolean;
  coinsBalance: number;
  coinsEarnedTotal: number;
  streakDays: number;
  lastStreakDate: string | null;
  lastSpinAt: string | null;
  equippedTheme: 'indigo' | 'emerald' | 'amber' | 'rose' | string;
  equippedAvatar: string;
  equippedFrame: string;
  referralCode: string;
  approvedUploads: number;
  level: 'Beginner' | 'Contributor' | 'Top Uploader';
  nextLevelTarget: number | null;
  achievements: AchievementItem[];
  unreadNotifications: number;
  pendingDmRequests: number;
  examCountdown: {
    exam_name: string;
    exam_date: string;
    reminder_days: number;
    daysLeft: number;
  } | null;
  completedUnlocks: number;
  createdAt: string;
}

export interface NoteSummary {
  id: string;
  uploaderId: string;
  uploaderName: string;
  uploaderAvatar: string;
  uploaderFrame: string;
  uploaderLevel: string;
  title: string;
  subject: string;
  examClass: string;
  description: string;
  tags: string[];
  priceCoins: number;
  isFreeSample: boolean;
  isGeminiNote: boolean;
  isPyq: boolean;
  pyqYear: string;
  previewPagesCount: number;
  pageCount: number;
  fileType: 'structured' | 'image' | 'pdf';
  coverImage: string;
  status: string;
  rejectionReason: string;
  uploadRewardCoins: number;
  salesCount: number;
  totalEarnedCoins: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: string;
  isBookmarked?: boolean;
  isUnlocked?: boolean;
  isFollowingUploader?: boolean;
  canReview?: boolean;
  canRequestRefund?: boolean;
  refundStatus?: string | null;
  hasPreviewPages?: boolean;
  unlockedAt?: string;
  paidCoins?: number;
}

export interface GeminiBundle {
  id: string;
  title: string;
  description: string;
  bundlePriceCoins: number;
  regularTotalCoins: number;
  savingsCoins: number;
  allUnlocked: boolean;
  notes: Array<{ id: string; title: string; subject: string; priceCoins: number }>;
}

export interface NoteReview {
  id: string;
  rating: number;
  comment: string;
  createdAt: string;
  buyerName: string;
  buyerAvatar: string;
}

export interface CoinTransaction {
  id: string;
  category: 'earned' | 'spent' | 'redeemed';
  type: string;
  amount_coins: number;
  description: string;
  ref_id: string;
  created_at: string;
}

export interface ShopItem {
  id: string;
  kind: 'theme' | 'avatar' | 'frame';
  key: string;
  name: string;
  description: string;
  priceCoins: number;
  previewValue: string;
  owned: boolean;
  equipped: boolean;
}

export interface ChatRoom {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  isMuted: boolean;
}

export interface DmThread {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatar: string;
  peerFrame: string;
  peerIsMinor: boolean;
  requesterId: string;
  isIncomingRequest: boolean;
  status: 'pending' | 'accepted' | 'declined';
  isMuted: boolean;
  isBlocked: boolean;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderFrame: string;
  messageType: 'text' | 'image' | 'note_card' | 'note_gift' | 'coin_receipt';
  body: string;
  imageData?: string;
  payload: Record<string, unknown>;
  seenBy: string[];
  isDeleted: boolean;
  createdAt: string;
  optimistic?: boolean;
}

export interface DoubtItem {
  id: string;
  userId: string;
  authorName: string;
  authorAvatar: string;
  subject: string;
  examClass: string;
  title: string;
  body: string;
  bestAnswerId: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
  answers: Array<{
    id: string;
    userId: string;
    authorName: string;
    authorAvatar: string;
    body: string;
    isBest: boolean;
    rewardCoins: number;
    createdAt: string;
  }>;
}
