import type { Language } from './types';

const dict = {
  en: {
    brand: 'NoteSwap',
    home: 'Home',
    search: 'Search',
    chat: 'Chat',
    upload: 'Upload',
    wallet: 'Wallet',
    profile: 'Profile',
    library: 'Library',
    doubts: 'Doubts',
    leaderboard: 'Leaderboard',
    admin: 'Admin',
    signIn: 'Sign in',
    signOut: 'Sign out',
    heroTitle: 'Private study notes, unlocked with Coins.',
    heroSubtitle:
      'Preview locked notes safely, unlock full pages with virtual Coins, earn 50% when classmates unlock your notes, and revise with Gemini AI flashcards & quizzes.',
    browseNotes: 'Explore Notes',
    uploadNotesCta: 'Upload & Earn Coins',
    searchPlaceholder: 'Search Physics, DSA, NEET, JEE, PYQs...',
    trending: 'Trending',
    newlyAdded: 'Newly Added',
    topRated: 'Top Rated',
    freeSamples: 'Free Samples',
    geminiNotes: 'Gemini Notes',
    pyqs: 'PYQ Papers',
    forYourExam: 'Notes for Your Exam',
    unlockFor: 'Unlock for',
    freeSample: 'Free Sample',
    unlocked: 'Unlocked',
    openViewer: 'Open Secure Viewer',
    officialGemini: 'Official Gemini Note',
    previousYearPaper: 'Previous Year Paper',
    coinsDisclaimer:
      'Virtual Coins have no real-world cash value and cannot be bought, sold, or cashed out.',
    dailyStreak: 'Daily Streak',
    claimStreak: 'Claim Today’s Coin',
    streakClaimed: 'Claimed Today',
    spinWheel: 'Daily Spin Wheel',
    spinNow: 'Spin (0–5 Coins)',
    redeemCode: 'Redeem Code',
    applyCode: 'Redeem',
    all: 'All',
    earned: 'Earned',
    spent: 'Spent',
    redeemed: 'Redeemed',
    noNotesFound: 'No student notes available yet.',
    tryDifferentSearch: 'Upload the first student study note to start earning Coins, or adjust your filters.',
    viewerWarning:
      'Protected Viewer · Downloads disabled & buyer watermark embedded. Screenshots cannot be fully blocked by any browser.',
  },
  hi: {
    brand: 'NoteSwap',
    home: 'होम',
    search: 'खोजें',
    chat: 'चैट',
    upload: 'अपलोड',
    wallet: 'वॉलेट',
    profile: 'प्रोफ़ाइल',
    library: 'लाइब्रेरी',
    doubts: 'डाउट्स',
    leaderboard: 'लीडरबोर्ड',
    admin: 'एडमिन',
    signIn: 'साइन इन',
    signOut: 'लॉग आउट',
    heroTitle: 'निजी स्टडी नोट्स, कॉइन्स से अनलॉक करें।',
    heroSubtitle:
      'सुरक्षित प्रीव्यू देखें, वर्चुअल कॉइन्स से नोट्स अनलॉक करें, अपने नोट्स से 50% कॉइन्स कमाएँ और Gemini AI क्विज़ व फ्लैशकार्ड से तैयारी करें।',
    browseNotes: 'नोट्स देखें',
    uploadNotesCta: 'नोट्स अपलोड करें',
    searchPlaceholder: 'फिजिक्स, DSA, NEET, JEE, PYQ खोजें...',
    trending: 'ट्रेंडिंग',
    newlyAdded: 'नए नोट्स',
    topRated: 'टॉप रेटेड',
    freeSamples: 'फ्री सैंपल',
    geminiNotes: 'Gemini नोट्स',
    pyqs: 'पिछले पेपर (PYQ)',
    forYourExam: 'आपकी परीक्षा के लिए नोट्स',
    unlockFor: 'अनलॉक करें',
    freeSample: 'फ्री सैंपल',
    unlocked: 'अनलॉक्ड',
    openViewer: 'सुरक्षित व्यूअर खोलें',
    officialGemini: 'आधिकारिक Gemini नोट',
    previousYearPaper: 'पिछले वर्ष का पेपर',
    coinsDisclaimer:
      'वर्चुअल कॉइन्स का कोई नकद मूल्य नहीं है और इन्हें खरीदा या कैश नहीं किया जा सकता।',
    dailyStreak: 'दैनिक स्ट्रीक',
    claimStreak: 'आज का कॉइन लें',
    streakClaimed: 'आज का लिया गया',
    spinWheel: 'दैनिक स्पिन व्हील',
    spinNow: 'स्पिन करें (0–5 कॉइन्स)',
    redeemCode: 'रिडीम कोड',
    applyCode: 'लागू करें',
    all: 'सभी',
    earned: 'कमाए',
    spent: 'खर्च किए',
    redeemed: 'रिडीम किए',
    noNotesFound: 'अभी कोई छात्र नोट उपलब्ध नहीं है।',
    tryDifferentSearch: 'कॉइन्स कमाने के लिए पहला स्टडी नोट अपलोड करें या फ़िल्टर बदलें।',
    viewerWarning:
      'सुरक्षित व्यूअर · डाउनलोड बंद है और वॉटरमार्क जुड़ा है। ब्राउज़र में स्क्रीनशॉट पूरी तरह रोका नहीं जा सकता।',
  },
} as const;

export function t(lang: Language, key: keyof typeof dict.en): string {
  return dict[lang][key] || dict.en[key];
}

export const AVATAR_MAP: Record<string, string> = {
  scholar: '🎓',
  owl: '🦉',
  rocket: '🚀',
  atom: '⚛️',
};

export const FRAME_CLASS_MAP: Record<string, string> = {
  none: 'ring-1 ring-slate-200 dark:ring-slate-700',
  gold: 'ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-slate-900',
  emerald: 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900',
};

export function getAccentClasses(theme: string) {
  switch (theme) {
    case 'emerald':
      return {
        btn: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        text: 'text-emerald-600 dark:text-emerald-400',
        softBg: 'bg-emerald-50 dark:bg-emerald-950/40',
        border: 'border-emerald-200 dark:border-emerald-800',
      };
    case 'amber':
      return {
        btn: 'bg-amber-600 hover:bg-amber-700 text-white',
        text: 'text-amber-600 dark:text-amber-400',
        softBg: 'bg-amber-50 dark:bg-amber-950/40',
        border: 'border-amber-200 dark:border-amber-800',
      };
    case 'rose':
      return {
        btn: 'bg-rose-600 hover:bg-rose-700 text-white',
        text: 'text-rose-600 dark:text-rose-400',
        softBg: 'bg-rose-50 dark:bg-rose-950/40',
        border: 'border-rose-200 dark:border-rose-800',
      };
    default:
      return {
        btn: 'bg-indigo-600 hover:bg-indigo-700 text-white',
        text: 'text-indigo-600 dark:text-indigo-400',
        softBg: 'bg-indigo-50 dark:bg-indigo-950/40',
        border: 'border-indigo-200 dark:border-indigo-800',
      };
  }
}
