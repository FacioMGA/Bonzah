import { AnimatePresence, motion } from 'framer-motion';
import { WizardButton as Button } from '@/src/shared/ui';

export interface WizardErrorItem {
  /** Stable unique identifier for the row (typically the field path). */
  path: string;
  /** Human-readable label for the field; not shown when `message` already includes context. */
  label?: string;
  /** Validation message. */
  message: string;
  /** Optional click handler for the row (typically scrolls/focuses the field). */
  onFocus?: () => void;
}

export interface QuoteWizardErrorSummaryProps {
  errors: WizardErrorItem[];
  title?: string;
  /** Receive the container DOM node so the caller can scroll/focus it. */
  setContainerEl?: (node: HTMLDivElement | null) => void;
}

/**
 * Product-agnostic error summary banner shown at the top of a step when
 * validation fails. Errors come from the product's Zod schema projected to
 * `WizardErrorItem` tuples by the product's step validator.
 *
 * Each row is keyboard- and click-actionable (`onFocus`) so consumers can
 * implement scroll-to-field without forking the component.
 */
export function QuoteWizardErrorSummary({ errors, title, setContainerEl }: QuoteWizardErrorSummaryProps) {
  return (
    <AnimatePresence>
      {errors.length > 0 ? (
        <div
          ref={setContainerEl}
          tabIndex={-1}
          role="alert"
          aria-live="polite"
          className="max-w-4xl mx-auto px-5 mb-8 outline-none"
        >
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <h3 className="text-red-800 mb-2 text-sm font-medium">{title || 'Please fix the following to continue'}</h3>
                  <ul className="text-sm text-red-700 space-y-1">
                    {errors.map((err) => (
                      <li key={`${err.path}:${err.message}`}>
                        {err.onFocus ? (
                          <Button
                            type="button"
                            variant="link"
                            className="text-red-700 hover:text-red-800 hover:underline"
                            onClick={err.onFocus}
                          >
                            • {err.label ? `${err.label}: ` : ''}{err.message}
                          </Button>
                        ) : (
                          <span>• {err.label ? `${err.label}: ` : ''}{err.message}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
