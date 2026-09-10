import { motion } from 'framer-motion';
import { Car, Home, Plane, Sparkles, Wind, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

const DEFAULT_MESSAGES = [
  'Connecting to Lloyd’s database…',
  'Calculating optimal premium…',
  'Applying online discounts…',
  'Finalizing your quote…',
];

/**
 * Visual artwork shown on the loader. Pure presentation tokens — these
 * describe the *shape* being animated, not the product. Frontend products
 * map their identity to one of these in `WizardPresentationProfile`.
 *
 *  - `sparkle`: legacy default, neutral fallback.
 *  - `vehicle`: car gliding across the track (motor).
 *  - `plane`:   plane gliding across the track (travel).
 *  - `house`:   stationary home with pulsing protection rings (home).
 */
export type QuoteLoadingVariant = 'sparkle' | 'vehicle' | 'plane' | 'house';

export interface QuoteLoadingProps {
  /**
   * Optional headline shown above the spinner. When provided, replaces the
   * cycling messages with a single static line.
   */
  title?: string;
  /** Optional secondary line. Only used when `title` is supplied. */
  subtitle?: string;
  /** Cycle through a list of phase messages instead of `title`. */
  messages?: string[];
  /** Cycle interval in ms. */
  intervalMs?: number;
  /** Artwork variant. Defaults to `sparkle` for backwards-compat. */
  variant?: QuoteLoadingVariant;
}

const TRAVEL_ICONS: Record<Exclude<QuoteLoadingVariant, 'house'>, LucideIcon> = {
  sparkle: Sparkles,
  vehicle: Car,
  plane: Plane,
};

/**
 * Animated full-viewport quote loading screen. Defaults to a cycling
 * "calculating your quote" experience; consumers can supply a static
 * `title`/`subtitle` for shorter contexts.
 */
export function QuoteLoading(props: QuoteLoadingProps = {}) {
  const { title, subtitle, messages, intervalMs = 800, variant = 'sparkle' } = props;
  const cycle = messages && messages.length > 0 ? messages : DEFAULT_MESSAGES;
  const [textIndex, setTextIndex] = useState(0);

  useEffect(() => {
    if (title) return;
    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % cycle.length);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [cycle.length, intervalMs, title]);

  return (
    <div className="w-full h-[60vh] flex flex-col items-center justify-center relative overflow-hidden bg-white/50 backdrop-blur-sm">
      <div className="absolute inset-0 opacity-10">
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute h-[1px] bg-blue-900 w-full"
            style={{ top: `${20 + i * 15}%` }}
            animate={{ x: ['-100%', '100%'], opacity: [0, 1, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2, ease: 'linear' }}
          />
        ))}
      </div>

      <div className="relative w-full max-w-2xl h-32 flex items-center justify-center mb-12">
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-transparent via-blue-200 to-transparent w-full"
            animate={{ x: ['-100%', '100%'] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        </div>

        {variant === 'house' ? (
          <HouseArtwork />
        ) : (
          <TravelingArtwork icon={TRAVEL_ICONS[variant]} />
        )}
      </div>

      <motion.div
        key={title ? 'static' : textIndex}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="text-lg font-medium text-blue-900/80 tracking-wide text-center px-4"
      >
        {title || cycle[textIndex]}
      </motion.div>
      {title && subtitle ? (
        <div className="mt-2 text-sm font-semibold text-slate-500 text-center px-4">{subtitle}</div>
      ) : null}

      <div className="flex gap-1 mt-4">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-blue-500"
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Horizontally-traveling icon with a trailing "wind" glyph. Used for the
 * `sparkle`, `vehicle`, and `plane` variants — anything that benefits from
 * a left-to-right motion metaphor (calculation in motion).
 */
function TravelingArtwork({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <motion.div
      className="absolute text-[#004a8a]"
      initial={{ left: '-10%' }}
      animate={{ left: '110%' }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', times: [0, 1] }}
      style={{ bottom: '2px' }}
    >
      <motion.div
        className="absolute -left-8 top-1 text-blue-200"
        animate={{ opacity: [0, 1, 0], x: [-5, 0] }}
        transition={{ duration: 0.5, repeat: Infinity }}
      >
        <Wind className="w-6 h-6 rotate-180" />
      </motion.div>
      <Icon className="w-12 h-12" strokeWidth={1.5} />
    </motion.div>
  );
}

/**
 * Stationary home with concentric "protection" rings expanding outward.
 * A house doesn't *travel* across the page; it's the still point we cover.
 * The breathing scale + staggered rings communicate active protection
 * being applied — the right metaphor for home insurance rating.
 */
function HouseArtwork() {
  return (
    <div className="relative flex items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border border-blue-300"
          style={{ width: 72, height: 72 }}
          animate={{ scale: [1, 2.4], opacity: [0.55, 0] }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            delay: i * 0.8,
            ease: 'easeOut',
          }}
        />
      ))}
      <motion.div
        className="relative text-[#004a8a]"
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Home className="w-12 h-12" strokeWidth={1.5} />
      </motion.div>
    </div>
  );
}
