import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Check, Download, Info, Mail, Shield } from 'lucide-react';
import { WizardButton as Button } from '@/src/shared/ui';
import type { QuoteHeroHeaderVariants } from './QuoteHeroHeader';
import { formatPremium } from './quoteFormat';

export interface PremiumCardBadge {
  /** Short label shown in the chip (e.g. "Excess €250"). */
  label: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Visual tone for the chip. Defaults to `'neutral'`. */
  tone?: 'neutral' | 'emerald' | 'sky' | 'amber';
}

export interface PremiumCardInclusion {
  /** Short bullet copy (e.g. "Comprehensive Protection"). */
  label: string;
}

export interface PremiumCardActions {
  /** Primary CTA label (e.g. "Secure this price"). */
  primaryLabel: string;
  onPrimary: () => void;
  /** Optional info / debug button. */
  onInfo?: () => void;
  /** Optional email button. */
  email?: {
    onClick: () => void;
    busy?: boolean;
    isHovered?: boolean;
    onHoverChange?: (hovered: boolean) => void;
  };
  /** Optional download button. */
  download?: {
    onClick: () => void;
    busy?: boolean;
  };
}

export interface PremiumCardProps {
  variants: QuoteHeroHeaderVariants;
  /** Card title (e.g. "Comprehensive Coverage"). */
  title: string;
  /** Optional badges shown beneath the title. */
  badges?: PremiumCardBadge[];
  /** Annual premium amount (already in the currency unit). */
  annualPremium: number;
  currency: string;
  /** Bullet inclusions shown above the CTA row. */
  inclusions: PremiumCardInclusion[];
  actions: PremiumCardActions;
  /** Footer note shown beneath the CTA row. */
  footnotePrimary?: string;
  /** Secondary footer note. */
  footnoteSecondary?: string;
}

const BADGE_TONE_CLASSES: Record<NonNullable<PremiumCardBadge['tone']>, string> = {
  neutral: 'bg-gray-50 text-gray-700 border-gray-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  sky: 'bg-blue-50 text-blue-700 border-blue-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
};

/**
 * Domain-neutral premium card. Generalized from motor's `Step4PriceCard`.
 *
 * Drops motor-only literals ("Comprehensive Protection", "Windscreen Cover
 * Included...") in favor of an `inclusions` array so each product owns
 * its own copy. Hover micro-motion (CTA arrow nudge, email icon tilt,
 * download icon bob) is preserved.
 */
export function PremiumCard({
  variants,
  title,
  badges = [],
  annualPremium,
  currency,
  inclusions,
  actions,
  footnotePrimary,
  footnoteSecondary,
}: PremiumCardProps) {
  return (
    <motion.div
      custom={1}
      initial="hidden"
      animate="visible"
      variants={variants}
      className="relative bg-white rounded-3xl p-8 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden group"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-50/50 to-transparent rounded-bl-full -z-0 opacity-50" />

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-xl font-medium text-gray-900">{title}</h3>
            {badges.length > 0 ? (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {badges.map((badge, idx) => (
                  <span
                    key={`${badge.label}-${idx}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${BADGE_TONE_CLASSES[badge.tone || 'neutral']}`}
                  >
                    {badge.icon}
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {actions.onInfo ? (
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onInfo?.();
                }}
                variant="secondary"
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100/50 transition-colors"
                title="View Breakdown"
              >
                <Info className="w-5 h-5 text-gray-400" />
              </Button>
            ) : null}
            <div className="w-10 h-10 bg-[#004a8a] rounded-full flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>

        <div className="flex items-baseline gap-1 mb-8">
          <span className="text-4xl md:text-6xl font-bold text-gray-900 tracking-tight">
            {formatPremium(annualPremium, currency)}
          </span>
          <span className="text-gray-400 font-medium ml-2">/ year</span>
        </div>

        {inclusions.length > 0 ? (
          <div className="space-y-4 mb-10">
            {inclusions.map((item, idx) => (
              <div
                key={`${item.label}-${idx}`}
                className="flex items-center gap-3 text-gray-700 group-hover:translate-x-1 transition-transform duration-300"
                style={{ transitionDelay: `${idx * 75}ms` }}
              >
                <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <span className="text-[15px]">{item.label}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-gray-100">
          <motion.div className="flex-1" whileHover="hover">
            <Button
              variant="primary"
              onClick={actions.onPrimary}
              className="!h-14 !text-lg !px-8 shadow-xl shadow-blue-900/10 hover:shadow-blue-900/20 !rounded-xl w-full"
            >
              <span className="mr-2">{actions.primaryLabel}</span>
              <motion.div
                variants={{
                  hover: {
                    x: [0, 6, 0],
                    transition: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' },
                  },
                }}
                className="flex items-center justify-center"
              >
                <ArrowRight className="w-5 h-5" />
              </motion.div>
            </Button>
          </motion.div>

          {(actions.email || actions.download) ? (
            <div className="flex gap-2 shrink-0">
              {actions.email ? (
                <motion.div>
                  <Button
                    variant="outline"
                    className="!h-14 !w-14 !px-0 !rounded-xl"
                    onClick={actions.email.onClick}
                    disabled={Boolean(actions.email.busy)}
                    onMouseEnter={() => actions.email?.onHoverChange?.(true)}
                    onMouseLeave={() => actions.email?.onHoverChange?.(false)}
                    onPointerEnter={() => actions.email?.onHoverChange?.(true)}
                    onPointerLeave={() => actions.email?.onHoverChange?.(false)}
                    onTouchEnd={() => actions.email?.onHoverChange?.(false)}
                    onTouchCancel={() => actions.email?.onHoverChange?.(false)}
                  >
                    {actions.email.busy ? (
                      <div className="flex items-center justify-center" aria-label="Sending email">
                        <span className="inline-block h-5 w-5 rounded-full border-2 border-slate-300 border-t-brand-primary animate-spin" />
                      </div>
                    ) : (
                      <motion.div
                        animate={{
                          rotate: actions.email.isHovered ? -10 : 0,
                          scale: actions.email.isHovered ? 1.12 : 1,
                        }}
                        transition={{ type: 'spring', stiffness: 380, damping: 24, mass: 0.6 }}
                        className="flex items-center justify-center"
                      >
                        <Mail className="w-5 h-5" />
                      </motion.div>
                    )}
                  </Button>
                </motion.div>
              ) : null}

              {actions.download ? (
                <motion.div whileHover="hover">
                  <Button
                    variant="outline"
                    className="!h-14 !w-14 !px-0 !rounded-xl"
                    onClick={actions.download.onClick}
                    disabled={Boolean(actions.download.busy)}
                  >
                    <motion.div
                      variants={{
                        hover: {
                          y: [0, -3, 0],
                          transition: { duration: 1, repeat: Infinity, ease: 'easeInOut' },
                        },
                      }}
                      className="flex items-center justify-center"
                    >
                      <Download className="w-5 h-5" />
                    </motion.div>
                  </Button>
                </motion.div>
              ) : null}
            </div>
          ) : null}
        </div>

        {footnotePrimary ? (
          <p className="text-center text-xs text-gray-400 mt-4">{footnotePrimary}</p>
        ) : null}
        {footnoteSecondary ? (
          <p className="text-center text-[11px] text-gray-500 mt-1">{footnoteSecondary}</p>
        ) : null}
      </div>
    </motion.div>
  );
}
