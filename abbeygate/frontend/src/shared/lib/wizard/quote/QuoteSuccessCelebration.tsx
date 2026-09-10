import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export type QuoteSuccessCelebrationVariant = 'confetti' | 'subtle' | 'none';

export interface QuoteSuccessCelebrationProps {
  /** Visual style. `'none'` renders nothing. */
  variant: QuoteSuccessCelebrationVariant;
  /** Stable identifier for the current quote — celebration fires once per key. */
  triggerKey: string;
  /** Optional namespace for the once-per-quote sessionStorage gate. */
  storagePrefix?: string;
  /** Total time the animation is allowed to run before being unmounted. */
  durationMs?: number;
}

/**
 * Domain-neutral quote-success celebration moment.
 *
 * `'confetti'` — energetic falling particles (motor parity).
 * `'subtle'` — soft expanding halo + faint twinkles (home: protection / trust).
 * `'none'`   — render nothing (opt-out).
 *
 * Uses `sessionStorage` so the moment fires once per quote per browser
 * session, mirroring the motor `facio.confetti_shown.${quoteReference}`
 * gate that lived inline in `Step4Quote`.
 */
export function QuoteSuccessCelebration({
  variant,
  triggerKey,
  storagePrefix = 'facio.quote-celebration-shown',
  durationMs,
}: QuoteSuccessCelebrationProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (variant === 'none') return;
    if (!triggerKey) return;
    let cancelled = false;
    const key = `${storagePrefix}.${triggerKey}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'true');
    } catch {
      // sessionStorage may be disabled (private mode); fall through.
    }
    setActive(true);
    const lifeMs = durationMs ?? (variant === 'confetti' ? 6000 : 2400);
    const handle = window.setTimeout(() => {
      if (!cancelled) setActive(false);
    }, lifeMs);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [durationMs, storagePrefix, triggerKey, variant]);

  if (!active || variant === 'none') return null;
  if (variant === 'confetti') return <Confetti />;
  return <SubtleHalo />;
}

function Confetti() {
  const particles = Array.from({ length: 50 }).map((_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 3 + Math.random() * 2,
    color: ['bg-red-400', 'bg-blue-400', 'bg-yellow-400', 'bg-emerald-400', 'bg-purple-400'][
      Math.floor(Math.random() * 5)
    ],
    shape: Math.random() > 0.5 ? 'rounded-full' : 'rounded-sm',
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden" aria-hidden>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ y: -20, x: `${p.x}vw`, opacity: 1, rotate: 0 }}
          animate={{
            y: '110vh',
            rotate: 360 * (Math.random() > 0.5 ? 1 : -1),
            x: `${p.x + (Math.random() * 10 - 5)}vw`,
          }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'linear' }}
          className={`absolute w-2.5 h-2.5 ${p.color} ${p.shape} opacity-80`}
        />
      ))}
    </div>
  );
}

function SubtleHalo() {
  // Calmer protection-oriented moment: a soft expanding halo and a few
  // gentle twinkles in the upper viewport. No noise, no chaos.
  const sparkles = Array.from({ length: 6 }).map((_, i) => ({
    id: i,
    x: 20 + Math.random() * 60,
    y: 10 + Math.random() * 30,
    delay: 0.2 + Math.random() * 0.6,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden" aria-hidden>
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        initial={{ width: 40, height: 40, opacity: 0.45 }}
        animate={{ width: 520, height: 520, opacity: 0 }}
        transition={{ duration: 1.8, ease: 'easeOut' }}
        style={{
          background: 'radial-gradient(circle, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0) 70%)',
        }}
      />
      {sparkles.map((s) => (
        <motion.div
          key={s.id}
          className="absolute w-1.5 h-1.5 rounded-full bg-emerald-300"
          style={{ left: `${s.x}%`, top: `${s.y}%` }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0], scale: [0.4, 1.4, 0.4] }}
          transition={{ duration: 1.6, delay: s.delay, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}
