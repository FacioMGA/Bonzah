import { motion } from 'framer-motion';
import { Check, ShieldCheck, Star } from 'lucide-react';
import type { RecommendationCardModel } from './step4QuoteDomain';

type Step4RecommendationsPanelProps = {
  variants: {
    hidden: { opacity: number; y: number };
    visible: (i: number) => {
      opacity: number;
      y: number;
      transition: { delay: number; duration: number; ease: 'easeOut' };
    };
  };
  error: string | null;
  showLoading: boolean;
  recommendationCards: RecommendationCardModel[];
  onSelectRecommendation: (card: RecommendationCardModel) => void;
};

export function Step4RecommendationsPanel(props: Step4RecommendationsPanelProps) {
  if (props.error) {
    return (
      <motion.div custom={2} initial="hidden" animate="visible" variants={props.variants}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {props.error}
        </div>
      </motion.div>
    );
  }

  if (props.showLoading) {
    return (
      <motion.div custom={2} initial="hidden" animate="visible" variants={props.variants}>
        <div className="flex items-center gap-2 mb-4 ml-1">
          <h4 className="text-gray-900 font-medium">Other options</h4>
        </div>
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl px-6 py-5 border border-white/10 bg-[#070b18] animate-pulse shadow-[0_20px_40px_-24px_rgba(0,0,0,0.55)]"
              aria-hidden
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-64 bg-white/10 rounded mb-3" />
                  <div className="flex gap-2">
                    <div className="h-7 w-20 bg-white/10 rounded-full" />
                    <div className="h-7 w-28 bg-white/10 rounded-full" />
                  </div>
                  <div className="h-3 w-80 bg-white/10 rounded mt-3" />
                </div>
                <div className="text-right shrink-0">
                  <div className="h-5 w-24 bg-white/10 rounded mb-2 ml-auto" />
                  <div className="h-3 w-16 bg-white/10 rounded ml-auto" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (props.recommendationCards.length === 0) {
    return null;
  }

  return (
    <motion.div custom={2} initial="hidden" animate="visible" variants={props.variants}>
      <div className="flex items-center gap-2 mb-4 ml-1">
        <h4 className="text-gray-900 font-medium">Other options</h4>
      </div>

      <div className="space-y-4">
        {props.recommendationCards.map((card, idx) => {
          const { bundleId, copy, annualPremium, isSelected, isOriginal, isBusy } = card;
          const hoverLift = isSelected ? -1 : -2;
          const hoverScale = isSelected ? 1.002 : 1.004;
          return (
            <motion.div
              key={bundleId || idx}
              data-bundle-id={bundleId}
              data-is-original={isOriginal ? '1' : '0'}
              onClick={() => {
                if (!bundleId || isBusy) return;
                props.onSelectRecommendation(card);
              }}
              whileHover={isBusy ? undefined : { y: hoverLift, scale: hoverScale }}
              transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.6 }}
              className={`
                rounded-2xl px-6 py-5 border transition-all duration-200 relative overflow-hidden group
                ${isSelected
                  ? 'bg-[#070b18] border-emerald-300 ring-[4px] ring-emerald-300/35 shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_34px_80px_-44px_rgba(16,185,129,0.92)]'
                  : 'bg-white border-gray-100 shadow-[0_18px_40px_-26px_rgba(0,0,0,0.20)] hover:border-gray-200'}
                ${isBusy ? 'opacity-80 pointer-events-none' : 'cursor-pointer'}
              `}
            >
              <div
                aria-hidden
                className={`
                  pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300
                  ${isSelected ? 'opacity-100' : ''}
                `}
              >
                <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-gradient-to-br from-white/12 via-white/0 to-white/0 blur-2xl translate-x-0 translate-y-0 group-hover:translate-x-8 group-hover:translate-y-6 transition-transform duration-700" />
                <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-gradient-to-tr from-emerald-400/10 via-emerald-400/0 to-transparent blur-2xl translate-x-0 translate-y-0 group-hover:-translate-x-6 group-hover:-translate-y-4 transition-transform duration-700" />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p
                      className={`
                        text-[16px] font-extrabold tracking-tight
                        ${isSelected ? 'text-white' : 'text-gray-900'}
                      `}
                    >
                      {copy.title}
                    </p>

                    {isOriginal ? (
                      <span className={`
                        inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-widest
                        ${isSelected ? 'bg-white/10 text-white/80 border border-white/10' : 'bg-slate-50 text-slate-600 border border-slate-100'}
                      `}>
                        Original
                      </span>
                    ) : null}

                    {isSelected ? (
                      <span className="inline-flex items-center gap-2 text-[14px] font-extrabold text-emerald-200">
                        <span className="w-8 h-8 rounded-full bg-emerald-400/18 border border-emerald-300/40 flex items-center justify-center group-hover:scale-[1.04] transition-transform duration-300">
                          <Check className="w-5 h-5 group-hover:rotate-[-2deg] transition-transform duration-300" />
                        </span>
                        SELECTED
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {copy.badges.map((badge) => {
                      const base =
                        badge.kind === 'excess'
                          ? (isSelected
                            ? 'bg-white/8 text-white/95 border border-white/12'
                            : 'bg-slate-50 text-slate-700 border border-slate-100')
                          : badge.kind === 'ncb'
                            ? (isSelected
                              ? 'bg-emerald-500/12 text-emerald-100 border border-emerald-400/25'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-100')
                            : (isSelected
                              ? 'bg-amber-500/12 text-amber-100 border border-amber-400/25'
                              : 'bg-amber-50 text-amber-800 border border-amber-100');

                      return (
                        <span
                          key={`${bundleId}:${badge.kind}:${badge.label}`}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${base} transition-transform duration-300 group-hover:translate-y-[-1px]`}
                        >
                          {badge.kind === 'ncb' ? <ShieldCheck className="w-3.5 h-3.5 transition-transform duration-300 group-hover:scale-[1.05]" /> : null}
                          {badge.kind === 'vip' ? <Star className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-[8deg] group-hover:scale-[1.05]" /> : null}
                          {badge.label}
                        </span>
                      );
                    })}
                  </div>

                  {copy.tagline ? (
                    <div className={`mt-2 text-xs font-semibold ${isSelected ? 'text-white/75' : 'text-slate-600'}`}>
                      {copy.tagline}
                    </div>
                  ) : null}
                </div>

                <div className="text-right shrink-0">
                  <div className={`${isSelected ? 'text-white' : 'text-gray-900'} text-lg font-extrabold tracking-tight`}>
                    €{annualPremium.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className={`${isSelected ? 'text-white/70' : 'text-slate-500'} text-xs font-semibold`}>per year</div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
