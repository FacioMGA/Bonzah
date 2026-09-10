import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { DashboardInsight, InsightType } from '@/src/modules/dashboard/model/types';

// ─── Suppression ─────────────────────────────────────────────────────────────
// Insights are auto-suppressed for 24h after the user dismisses or interacts.
// A material score change (≥20 pts) overrides the cooldown and re-shows the insight.

const SUP_PREFIX = 'insight_sup_';
const SUP_TTL_MS = 24 * 60 * 60 * 1_000;

type StoredSuppression = { suppressedAt: number; score: number };

function loadSuppressed(): Record<string, StoredSuppression> {
  try {
    return JSON.parse(localStorage.getItem('dashboard_suppressions') || '{}') as Record<string, StoredSuppression>;
  } catch { return {}; }
}

function saveSuppressed(map: Record<string, StoredSuppression>): void {
  try { localStorage.setItem('dashboard_suppressions', JSON.stringify(map)); } catch { /* noop */ }
}

function isSuppressed(key: string, currentScore: number, map: Record<string, StoredSuppression>): boolean {
  const entry = map[SUP_PREFIX + key];
  if (!entry) return false;
  // 24h expired → show again
  if (Date.now() - entry.suppressedAt > SUP_TTL_MS) return false;
  // Score changed materially (severity escalation) → show again
  if (Math.abs(currentScore - entry.score) >= 20) return false;
  return true;
}

function suppress(key: string, score: number, map: Record<string, StoredSuppression>): Record<string, StoredSuppression> {
  return { ...map, [SUP_PREFIX + key]: { suppressedAt: Date.now(), score } };
}

// ─── Design tokens per insight type ──────────────────────────────────────────

const TYPE_CONFIG: Record<InsightType, {
  border: string;
  badge: string;
  icon: string;
  glow: string;
}> = {
  CRITICAL: {
    border: 'border-l-4 border-rose-500',
    badge:  'bg-rose-100 text-rose-700 border border-rose-200',
    icon:   '🔴',
    glow:   'shadow-rose-100/60',
  },
  WARNING: {
    border: 'border-l-4 border-amber-400',
    badge:  'bg-amber-50 text-amber-700 border border-amber-200',
    icon:   '🟡',
    glow:   'shadow-amber-50/80',
  },
  OPPORTUNITY: {
    border: 'border-l-4 border-indigo-400',
    badge:  'bg-indigo-50 text-indigo-700 border border-indigo-200',
    icon:   '💡',
    glow:   'shadow-slate-50',
  },
};

// ─── InsightCard ──────────────────────────────────────────────────────────────
function InsightCard({
  insight,
  index,
  onDismiss,
}: {
  insight:   DashboardInsight;
  index:     number;
  onDismiss: (key: string, score: number) => void;
}) {
  const navigate = useNavigate();
  const cfg = TYPE_CONFIG[insight.type];

  // Status dot colors per type
  const dotColor = {
    CRITICAL:    'bg-rose-500',
    WARNING:     'bg-amber-400',
    OPPORTUNITY: 'bg-indigo-400',
  }[insight.type];

  return (
    <motion.div
      key={insight.suppressionKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12, transition: { duration: 0.18 } }}
      transition={{ delay: index * 0.06, duration: 0.28, ease: 'easeOut' }}
      className={[
        'group relative flex items-start gap-4 rounded-2xl bg-white border border-slate-200',
        cfg.border,
        `shadow-md ${cfg.glow}`,
        'px-5 py-4 overflow-hidden',
      ].join(' ')}
    >
      {/* Category label + colored dot */}
      <div className="shrink-0 flex flex-col items-center gap-1.5 pt-0.5 min-w-[10px]">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-black text-slate-900 leading-snug">{insight.title}</p>
        <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">{insight.description}</p>
      </div>

      {/* Action */}
      <div className="shrink-0 flex flex-col items-end gap-2">
        <motion.button
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            onDismiss(insight.suppressionKey, insight.priorityScore);
            navigate(insight.actionUrl);
          }}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-700 transition-colors whitespace-nowrap"
        >
          {insight.actionLabel} →
        </motion.button>

        {/* Dismiss */}
        <button
          type="button"
          onClick={() => onDismiss(insight.suppressionKey, insight.priorityScore)}
          className="text-[10px] text-slate-300 hover:text-slate-500 transition-colors"
          aria-label="Dismiss insight"
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}

// ─── DashboardInsightStrip ────────────────────────────────────────────────────
type Props = { insights: DashboardInsight[] };

export function DashboardInsightStrip({ insights }: Props) {
  const [suppressionMap, setSuppressionMap] = useState<Record<string, StoredSuppression>>(() => loadSuppressed());

  // Sync to localStorage whenever map changes
  useEffect(() => { saveSuppressed(suppressionMap); }, [suppressionMap]);

  const handleDismiss = useCallback((key: string, score: number) => {
    setSuppressionMap((prev) => suppress(key, score, prev));
  }, []);

  const visible = useMemo(
    () => insights.filter((i) => !isSuppressed(i.suppressionKey, i.priorityScore, suppressionMap)),
    [insights, suppressionMap],
  );

  if (visible.length === 0) return null;

  return (
    <section aria-label="Smart insights">
      <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.18em] mb-3">
        Insight{visible.length > 1 ? 's' : ''}
      </h2>
      <AnimatePresence mode="popLayout">
        <div className="space-y-2.5">
          {visible.map((insight, i) => (
            <InsightCard
              key={insight.suppressionKey}
              insight={insight}
              index={i}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      </AnimatePresence>
    </section>
  );
}
