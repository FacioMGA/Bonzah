import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Edit } from 'lucide-react';
import { WizardButton as Button } from '@/src/shared/ui';
import type { QuoteHeroHeaderVariants } from './QuoteHeroHeader';

export interface QuoteSummaryCard {
  /** Stable key for React reconciliation. */
  id: string;
  /** Leading icon (lucide or otherwise). */
  icon: ReactNode;
  /** Card label (e.g. "Main Driver", "Property"). */
  label: string;
  /** Primary line (bold). */
  primary: string;
  /** Optional secondary line. */
  secondary?: ReactNode;
  /** When provided, renders an Edit button. */
  onEdit?: () => void;
}

export interface QuoteSummarySidebarProps {
  variants: QuoteHeroHeaderVariants;
  /** Quote reference (e.g. AQ-12345). */
  reference?: string;
  /** "Valid until" already-formatted (e.g. "31/05/2026"). */
  validUntil?: string;
  /** Detail cards. Order matters. */
  cards: QuoteSummaryCard[];
  /** Footnote shown beneath the cards. */
  footnote?: string;
}

/**
 * Domain-neutral summary sidebar for the quote review page.
 *
 * Generalized from motor's right-column block (Driver / Vehicle / Period
 * cards). Each card is opaque to the shell — products pass whatever set
 * makes sense (Driver+Vehicle+Period for motor; Property+Cover+Period
 * for home; Trip+Travellers+Plan for travel).
 */
export function QuoteSummarySidebar({
  variants,
  reference,
  validUntil,
  cards,
  footnote,
}: QuoteSummarySidebarProps) {
  return (
    <motion.div custom={2} initial="hidden" animate="visible" variants={variants}>
      {(reference || validUntil) ? (
        <div className="mb-6 flex items-center justify-between text-xs text-gray-400 uppercase tracking-widest px-1">
          {reference ? (
            <span>
              Ref: <span className="text-gray-900 font-mono tracking-normal">{reference}</span>
            </span>
          ) : <span />}
          {validUntil ? <span>Valid until {validUntil}</span> : null}
        </div>
      ) : null}

      <div className="space-y-3">
        {cards.map((card) => (
          <div
            key={card.id}
            className="group bg-white rounded-xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2 text-[#004a8a]">
                {card.icon}
                <span className="text-sm font-semibold text-gray-900">{card.label}</span>
              </div>
              {card.onEdit ? (
                <Button
                  onClick={card.onEdit}
                  variant="secondary"
                  className="text-xs text-gray-400 hover:text-[#004a8a] transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100"
                >
                  <Edit className="w-3 h-3" /> Edit
                </Button>
              ) : null}
            </div>
            <div className="pl-6">
              <p className="text-gray-900 font-medium">{card.primary}</p>
              {card.secondary ? (
                <div className="text-xs text-gray-500 mt-1">{card.secondary}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {footnote ? (
        <div className="mt-8 text-center px-4">
          <p className="text-xs text-gray-400 leading-relaxed">{footnote}</p>
        </div>
      ) : null}
    </motion.div>
  );
}
