import { motion } from 'framer-motion';
import { WizardButton as Button } from '@/src/shared/ui';

type HoverNav = 'back' | 'next' | null;

export interface QuoteWizardBottomNavProps {
  canBack: boolean;
  canNext: boolean;
  hoverNav: HoverNav;
  isSubmitting: boolean;
  onHoverNavChange: (next: HoverNav) => void;
  onBack: () => void;
  onNext: () => void;
  /** Override the "Continue" label for specific steps — e.g. "Get Quote" on the rating step. */
  nextLabel?: string;
  /** Keep the primary action visible but unavailable until the current step is ready. */
  nextDisabled?: boolean;
  /** Hide the nav entirely — used on terminal steps (success). */
  hidden?: boolean;
}

/**
 * Generic wizard bottom nav. Each product decides `nextLabel` per step.
 */
export function QuoteWizardBottomNav(props: QuoteWizardBottomNavProps) {
  const { canBack, canNext, hoverNav, isSubmitting, onHoverNavChange, onBack, onNext, nextLabel, nextDisabled, hidden } = props;
  if (hidden || (!canBack && !canNext)) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
        <div>
          {canBack ? (
            <Button
              variant="outline"
              onClick={onBack}
              className="!px-6 !h-controlMd"
              onMouseEnter={() => onHoverNavChange('back')}
              onMouseLeave={() => onHoverNavChange(null)}
            >
              <motion.svg
                className="w-5 h-5 text-gray-400 group-hover:text-brand"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                animate={hoverNav === 'back' ? { x: [0, -4, 0] } : { x: 0 }}
                transition={hoverNav === 'back' ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </motion.svg>
              <span className="ml-2">Back</span>
            </Button>
          ) : null}
        </div>
        <div>
          {canNext ? (
            <Button
              variant="primary"
              onClick={onNext}
              disabled={isSubmitting || Boolean(nextDisabled)}
              className="!px-6 !h-controlMd"
              onMouseEnter={() => onHoverNavChange('next')}
              onMouseLeave={() => onHoverNavChange(null)}
            >
              {isSubmitting ? 'Please wait...' : (
                <>
                  <span>{nextLabel || 'Continue'}</span>
                  <motion.svg
                    className="w-5 h-5 ml-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    animate={hoverNav === 'next' ? { x: [0, 4, 0] } : { x: 0 }}
                    transition={hoverNav === 'next' ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </motion.svg>
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
