import { motion } from 'framer-motion';

export interface QuoteBackgroundPalette {
  /** First gradient stop (e.g. `#f0f9ff`). */
  from: string;
  /** Middle gradient stop (e.g. `#ffffff`). */
  via: string;
  /** Final gradient stop (e.g. `#e0f2fe`). */
  to: string;
}

export interface AnimatedQuoteBackgroundProps {
  palette: QuoteBackgroundPalette;
  /** Opacity for the base gradient layer (0..1). Defaults to 0.8. */
  baseOpacity?: number;
}

/**
 * Persistent animated background layer for the quote review surface.
 *
 * Renders behind the entire viewport (`fixed inset-0 -z-10`). Two slow
 * loops drive a subtle "breathing sky" effect — the gradient pans
 * diagonally and a soft cloud overlay scales/drifts. Domain-neutral:
 * Motor and Home each pass their own palette via the catalog presentation
 * profile so the surface feels right per product without repeating CSS.
 */
export function AnimatedQuoteBackground({ palette, baseOpacity = 0.8 }: AnimatedQuoteBackgroundProps) {
  const gradient = `linear-gradient(135deg, ${palette.from} 0%, ${palette.via} 50%, ${palette.to} 100%)`;
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden>
      <motion.div
        className="absolute inset-0"
        animate={{ backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'] }}
        transition={{ duration: 20, ease: 'linear', repeat: Infinity }}
        style={{
          background: gradient,
          backgroundSize: '200% 200%',
          opacity: baseOpacity,
        }}
      />
      <motion.div
        className="absolute inset-0 opacity-40 mix-blend-overlay"
        animate={{ scale: [1, 1.05, 1], x: ['0%', '2%', '0%'] }}
        transition={{ duration: 15, ease: 'easeInOut', repeat: Infinity }}
        style={{
          backgroundImage:
            'radial-gradient(circle at 60% 40%, rgba(255,255,255,0.9) 0%, transparent 50%), ' +
            'radial-gradient(circle at 20% 80%, rgba(255,255,255,0.7) 0%, transparent 40%)',
        }}
      />
    </div>
  );
}
