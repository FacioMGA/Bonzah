import type { ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';

/**
 * Re-export of framer-motion's `Variants` shape under a stable name so
 * consumers don't need to import directly from `framer-motion` for the
 * common case of passing motion variants into the quote shell.
 */
export type QuoteHeroHeaderVariants = Variants;

export interface QuoteHeroHeaderProps {
  /** Eyebrow line shown above the headline (e.g. "Online Quote Ready"). */
  eyebrow: string;
  /** Eyebrow tone — controls the chip background. Defaults to `'emerald'`. */
  eyebrowTone?: 'emerald' | 'sky' | 'amber';
  /** Optional eyebrow icon. Defaults to `ShieldCheck`. */
  eyebrowIcon?: ReactNode;
  /** Big headline (e.g. "Your Motor Insurance Quote"). */
  headline: string;
  /** Sub-headline (e.g. "Tailored cover for your Mazda CX-5"). */
  subline: string;
  /** Status chip text (e.g. "Active"). Hidden when omitted. */
  statusLabel?: string;
  /** Status chip dot tone — defaults to emerald. */
  statusTone?: 'emerald' | 'sky' | 'amber';
  /** Motion variants — let callers share the same fade-in cadence as the rest of the page. */
  variants: QuoteHeroHeaderVariants;
}

const EYEBROW_TONE_CLASSES: Record<NonNullable<QuoteHeroHeaderProps['eyebrowTone']>, string> = {
  emerald: 'text-emerald-600',
  sky: 'text-[#004a8a]',
  amber: 'text-amber-700',
};

const STATUS_TONE_CLASSES: Record<NonNullable<QuoteHeroHeaderProps['statusTone']>, { wrap: string; dot: string }> = {
  emerald: { wrap: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' },
  sky: { wrap: 'bg-sky-50 text-[#004a8a] border-sky-100', dot: 'bg-sky-500' },
  amber: { wrap: 'bg-amber-50 text-amber-800 border-amber-100', dot: 'bg-amber-500' },
};

/**
 * Domain-neutral hero header for the quote review page.
 *
 * Generalized from motor's `Step4QuoteHeader`. All product-specific copy
 * (vehicle make/model, "home protection ready", etc.) flows in via props
 * so the same animated chip + heading treatment works for any product.
 */
export function QuoteHeroHeader({
  eyebrow,
  eyebrowTone = 'emerald',
  eyebrowIcon,
  headline,
  subline,
  statusLabel,
  statusTone = 'emerald',
  variants,
}: QuoteHeroHeaderProps) {
  const eyebrowToneClass = EYEBROW_TONE_CLASSES[eyebrowTone];
  const statusClasses = STATUS_TONE_CLASSES[statusTone];
  return (
    <motion.div
      custom={0}
      initial="hidden"
      animate="visible"
      variants={variants}
      className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4"
    >
      <div>
        <div className={`flex items-center gap-2 mb-2 ${eyebrowToneClass}`}>
          {eyebrowIcon ?? <ShieldCheck className="w-5 h-5" />}
          <span className="text-xs font-bold tracking-wider uppercase">{eyebrow}</span>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-gray-900 tracking-tight">{headline}</h1>
        <p className="text-gray-500 mt-2 text-lg">{subline}</p>
      </div>
      {statusLabel ? (
        <div className="text-right hidden md:block">
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-1">Status</p>
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${statusClasses.wrap}`}>
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${statusClasses.dot}`} />
            {statusLabel}
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
