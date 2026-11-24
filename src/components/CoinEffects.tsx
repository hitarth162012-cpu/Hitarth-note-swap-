import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { AchievementItem } from '../types';

export function ConfettiBurst({ active, onDone }: { active: boolean; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#4f46e5', '#f59e0b', '#10b981', '#e11d48', '#38bdf8'];
    const particles = Array.from({ length: 72 }, () => ({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 180,
      y: canvas.height * 0.4,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      size: Math.random() * 7 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.25,
    }));

    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.42;
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
        ctx.restore();
      }
      if (frame < 85) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onDone();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, onDone]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50"
      aria-hidden="true"
    />
  );
}

export function CoinDeltaFloating({ delta }: { delta: { id: number; amount: number; label?: string } | null }) {
  return (
    <AnimatePresence mode="wait">
      {delta && (
        <motion.div
          key={delta.id}
          initial={{ opacity: 0, y: 12, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className={`pointer-events-none fixed right-6 top-20 z-50 rounded-xl px-4 py-2 font-mono-num text-sm font-bold shadow-lg ${
            delta.amount >= 0
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-900 text-amber-300 dark:bg-slate-800'
          }`}
          role="status"
        >
          {delta.amount >= 0 ? `+🪙${delta.amount}` : `-🪙${Math.abs(delta.amount)}`}
          {delta.label ? ` · ${delta.label}` : ''}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AchievementUnlockBanner({
  achievement,
  onClose,
}: {
  achievement: AchievementItem | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {achievement && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24 }}
          className="fixed bottom-20 right-4 z-50 max-w-sm rounded-2xl border border-amber-300 bg-white p-4 shadow-xl dark:border-amber-700/60 dark:bg-slate-900 md:bottom-6"
          role="status"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-2xl dark:bg-amber-950">
              {achievement.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                Achievement Unlocked
              </p>
              <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                {achievement.title}
              </p>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                {achievement.description}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Dismiss achievement notification"
              className="min-h-[36px] min-w-[36px] rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ✕
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
