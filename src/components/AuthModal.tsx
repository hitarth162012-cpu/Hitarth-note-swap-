import { useState } from 'react';
import { X, Shield, Sparkles, Mail, KeyRound, AlertCircle } from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  auth,
  createUserWithEmailAndPassword,
  googleProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  syncUserToFirestore,
  updateProfile,
} from '../lib/firebase';
import type { UserProfile } from '../types';

interface AuthModalProps {
  open: boolean;
  googleConfigured: boolean;
  adminSetupRequired: boolean;
  onClose: () => void;
  onAuthenticated: (user: UserProfile, welcomeBonus?: number) => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
  onAskGeminiHelp?: (errorText: string, contextPage: string) => void;
}

function mapFirebaseAuthError(err: unknown): { message: string; isOperationNotAllowed: boolean } {
  const code = (err as { code?: string })?.code || '';
  const raw = (err as Error)?.message || 'Authentication failed';
  switch (code) {
    case 'auth/operation-not-allowed':
      return {
        message:
          'Firebase Email/Password sign-in is not yet enabled in Firebase Console. Enable Email/Password in Sign-in methods or use the Instant 6-Digit Email Code below.',
        isOperationNotAllowed: true,
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        message: 'Incorrect email or password. Try again, reset password, or use the 6-Digit Email Code.',
        isOperationNotAllowed: false,
      };
    case 'auth/email-already-in-use':
      return {
        message: 'An account already exists for this email. Switch to Sign In instead.',
        isOperationNotAllowed: false,
      };
    case 'auth/weak-password':
      return {
        message: 'Password must be at least 6 characters long.',
        isOperationNotAllowed: false,
      };
    case 'auth/popup-closed-by-user':
      return {
        message: 'Google sign-in popup was closed before completing login.',
        isOperationNotAllowed: false,
      };
    case 'auth/popup-blocked':
      return {
        message: 'Browser blocked the Google sign-in popup. Allow popups for this site and try again.',
        isOperationNotAllowed: false,
      };
    case 'auth/unauthorized-domain':
      return {
        message:
          'This domain is not yet added to Firebase Authorized Domains. Add it in Firebase Console > Authentication > Settings, or use Email Sign-In.',
        isOperationNotAllowed: false,
      };
    default:
      return { message: raw, isOperationNotAllowed: false };
  }
}

export function AuthModal({
  open,
  googleConfigured,
  adminSetupRequired,
  onClose,
  onAuthenticated,
  onToast,
  onAskGeminiHelp,
}: AuthModalProps) {
  const [mode, setMode] = useState<'google' | 'email' | 'admin'>('google');
  const [emailSubMode, setEmailSubMode] = useState<'password' | 'otp'>('password');
  const [isRegister, setIsRegister] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [isMinor, setIsMinor] = useState(false);

  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [previewOtp, setPreviewOtp] = useState<string | null>(null);

  const [adminPasscode, setAdminPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showOtpFallbackBtn, setShowOtpFallbackBtn] = useState(false);

  if (!open) return null;

  function recordError(msg: string, showFallback = false) {
    setAuthError(msg);
    setShowOtpFallbackBtn(showFallback);
    onToast('error', msg);
  }

  async function handleFirebaseGooglePopup() {
    setBusy(true);
    setAuthError(null);
    setShowOtpFallbackBtn(false);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken();
      const res = await apiRequest<{ user: UserProfile; isNewUser?: boolean; welcomeCoins?: number }>(
        '/api/auth/firebase',
        {
          method: 'POST',
          body: JSON.stringify({
            idToken,
            displayName: cred.user.displayName || name || undefined,
            referralCode,
            isMinor,
          }),
        },
      );
      await syncUserToFirestore({
        fbUser: cred.user,
        displayName: res.user.name,
        authProvider: 'google',
        role: res.user.role,
        avatar: res.user.equippedAvatar,
      });
      onAuthenticated(res.user, res.isNewUser ? res.welcomeCoins : undefined);
      onToast(
        'success',
        res.isNewUser
          ? `Welcome to NoteSwap! +🪙${res.welcomeCoins || 10} bonus credited.`
          : `Signed in as ${res.user.name}`,
      );
      onClose();
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      recordError(mapped.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleFirebaseEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAuthError(null);
    setShowOtpFallbackBtn(false);
    try {
      const cleanEmail = email.trim();
      const cred = isRegister
        ? await createUserWithEmailAndPassword(auth, cleanEmail, password)
        : await signInWithEmailAndPassword(auth, cleanEmail, password);

      if (isRegister && name.trim().length >= 2) {
        await updateProfile(cred.user, { displayName: name.trim() }).catch(() => {});
      }

      const idToken = await cred.user.getIdToken();
      const res = await apiRequest<{ user: UserProfile; isNewUser?: boolean; welcomeCoins?: number }>(
        '/api/auth/firebase',
        {
          method: 'POST',
          body: JSON.stringify({
            idToken,
            displayName: name.trim() || cred.user.displayName || undefined,
            referralCode,
            isMinor,
          }),
        },
      );

      await syncUserToFirestore({
        fbUser: cred.user,
        displayName: res.user.name,
        authProvider: 'firebase_email',
        role: res.user.role,
        avatar: res.user.equippedAvatar,
      });

      onAuthenticated(res.user, res.isNewUser ? res.welcomeCoins : undefined);
      onToast(
        'success',
        res.isNewUser
          ? `Welcome to NoteSwap! +🪙${res.welcomeCoins || 10} bonus credited.`
          : `Signed in as ${res.user.name}`,
      );
      onClose();
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      recordError(mapped.message, mapped.isOperationNotAllowed);
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      recordError('Enter your email address first to reset your password.');
      return;
    }
    setBusy(true);
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      onToast('success', 'Password reset email sent! Check your inbox.');
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      recordError(mapped.message, mapped.isOperationNotAllowed);
    } finally {
      setBusy(false);
    }
  }

  async function handleDemoStudent(userId: 'usr_arjun' | 'usr_priya') {
    setBusy(true);
    setAuthError(null);
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/auth/demo-student', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      onAuthenticated(res.user);
      onToast('success', `Signed in as ${res.user.name}`);
      onClose();
    } catch (err) {
      recordError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestOtp() {
    setBusy(true);
    setAuthError(null);
    setShowOtpFallbackBtn(false);
    try {
      const res = await apiRequest<{ sent: boolean; previewOtp?: string }>('/api/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setOtpSent(true);
      setPreviewOtp(res.previewOtp || null);
      onToast('info', 'Verification code generated.');
    } catch (err) {
      recordError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAuthError(null);
    try {
      const res = await apiRequest<{ user: UserProfile; isNewUser?: boolean; welcomeCoins?: number }>(
        '/api/auth/otp/verify',
        {
          method: 'POST',
          body: JSON.stringify({ email, otp, name }),
        },
      );
      onAuthenticated(res.user, res.isNewUser ? res.welcomeCoins : undefined);
      onToast(
        'success',
        res.isNewUser
          ? `Welcome to NoteSwap! +🪙${res.welcomeCoins || 10} bonus credited.`
          : `Signed in as ${res.user.name}`,
      );
      onClose();
    } catch (err) {
      recordError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setAuthError(null);
    try {
      const res = await apiRequest<{ user: UserProfile }>('/api/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ passcode: adminPasscode }),
      });
      onAuthenticated(res.user);
      onToast('success', 'Signed in to NoteSwap Admin');
      onClose();
    } catch (err) {
      recordError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-sm sm:items-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 id="auth-modal-title" className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Sign in to NoteSwap
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          First sign-in awards <strong className="text-emerald-600 dark:text-emerald-400">🪙10 Welcome Coins</strong> and unlocks Live Study Chat &amp; Gemini Tutor.
        </p>

        {/* Mode Switcher */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('google');
              setAuthError(null);
            }}
            className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
              mode === 'google'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Google
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('email');
              setAuthError(null);
            }}
            className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
              mode === 'email'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Firebase Email
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('admin');
              setAuthError(null);
            }}
            className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors ${
              mode === 'admin'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Admin
          </button>
        </div>

        {/* Inline Error Alert + Gemini Troubleshooting Button */}
        {authError && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span className="leading-relaxed">{authError}</span>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {showOtpFallbackBtn && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('email');
                    setEmailSubMode('otp');
                    setAuthError(null);
                  }}
                  className="min-h-[32px] rounded-lg bg-slate-900 px-3 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
                >
                  Use 6-Digit Email Code Instead
                </button>
              )}
              {onAskGeminiHelp && (
                <button
                  type="button"
                  onClick={() => onAskGeminiHelp(authError, 'Sign In')}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-rose-700 px-3 text-[11px] font-semibold text-white hover:bg-rose-800"
                >
                  <Sparkles className="h-3 w-3" />
                  Ask Gemini for Help
                </button>
              )}
            </div>
          </div>
        )}

        {mode === 'google' && (
          <div className="mt-5 space-y-4">
            <button
              type="button"
              disabled={busy}
              onClick={handleFirebaseGooglePopup}
              className="flex w-full min-h-[46px] items-center justify-center gap-2.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              <span>{busy ? 'Connecting to Google...' : 'Continue with Google (Firebase)'}</span>
            </button>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/50">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {googleConfigured ? 'Firebase Auth & Google Sign-In ready' : 'Firebase Sign-In'}
              </p>
              <div>
                <label htmlFor="google-ref" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Referral Code (optional · both get 🪙5 after 1st unlock)
                </label>
                <input
                  id="google-ref"
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  placeholder="e.g. ARJUN1042"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-mono-num text-sm uppercase text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400 min-h-[36px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMinor}
                  onChange={(e) => setIsMinor(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <span>I am under 18 (blocks stranger DMs until I accept a chat request)</span>
              </label>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Quick Student Preview Accounts
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDemoStudent('usr_arjun')}
                  className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Arjun (🪙34 · Day 6)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDemoStudent('usr_priya')}
                  className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Priya (🪙54 · Creator)
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'email' && (
          <div className="mt-5 space-y-4">
            {/* Sub-mode switcher: Firebase Email+Password vs Instant 6-Digit Email Code */}
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => {
                  setEmailSubMode('password');
                  setAuthError(null);
                }}
                className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  emailSubMode === 'password'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Email &amp; Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmailSubMode('otp');
                  setAuthError(null);
                }}
                className={`inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  emailSubMode === 'otp'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                6-Digit Email Code
              </button>
            </div>

            {emailSubMode === 'password' ? (
              <form onSubmit={handleFirebaseEmailSubmit} className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {isRegister ? 'Create Student Account' : 'Sign In with Firebase Email'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRegister((v) => !v);
                      setAuthError(null);
                    }}
                    className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {isRegister ? 'Have an account? Sign in' : 'New student? Create account'}
                  </button>
                </div>

                {isRegister && (
                  <div>
                    <label htmlFor="fb-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Student Name
                    </label>
                    <input
                      id="fb-name"
                      type="text"
                      required
                      minLength={2}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ananya Verma"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="fb-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Email Address
                  </label>
                  <input
                    id="fb-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student@gmail.com"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="fb-pass" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Password (6+ chars)
                    </label>
                    {!isRegister && (
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        className="text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    id="fb-pass"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[44px] rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {busy
                    ? 'Please wait...'
                    : isRegister
                      ? 'Create Firebase Account'
                      : 'Sign In with Email'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Instant email verification code — works right away with any email and unlocks Live Chat &amp; 🪙10 Welcome Coins.
                </p>
                <div>
                  <label htmlFor="otp-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Email Address
                  </label>
                  <input
                    id="otp-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@college.edu"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                {!otpSent ? (
                  <button
                    type="button"
                    disabled={busy || !email}
                    onClick={handleRequestOtp}
                    className="w-full min-h-[44px] rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
                  >
                    {busy ? 'Generating Code...' : 'Send 6-Digit Code'}
                  </button>
                ) : (
                  <>
                    {previewOtp && (
                      <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-200">
                        Your 6-Digit Code: <strong className="font-mono-num">{previewOtp}</strong>
                      </div>
                    )}
                    <div>
                      <label htmlFor="otp-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Your Name
                      </label>
                      <input
                        id="otp-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Student Name"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="otp-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        6-Digit Code
                      </label>
                      <input
                        id="otp-code"
                        type="text"
                        required
                        maxLength={6}
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        placeholder="123456"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono-num text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full min-h-[44px] rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      Verify &amp; Sign in
                    </button>
                  </>
                )}
              </form>
            )}
          </div>
        )}

        {mode === 'admin' && (
          <form onSubmit={handleAdminLogin} className="mt-5 space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <Shield className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {adminSetupRequired
                  ? 'First-run setup: choose an Admin passcode (4+ chars) to claim the Admin console.'
                  : 'Enter your Admin passcode to unlock student note moderation, redeem codes, and analytics.'}
              </span>
            </div>
            <div>
              <label htmlFor="admin-passcode" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {adminSetupRequired ? 'Set Admin Passcode' : 'Admin Passcode'}
              </label>
              <input
                id="admin-passcode"
                type="password"
                required
                minLength={4}
                value={adminPasscode}
                onChange={(e) => setAdminPasscode(e.target.value)}
                placeholder="••••••"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-indigo-600"
            >
              {adminSetupRequired ? 'Claim Admin Access' : 'Sign in as Admin'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
