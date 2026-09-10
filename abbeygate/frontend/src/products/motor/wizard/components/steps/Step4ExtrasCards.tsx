import { motion } from 'framer-motion';

type Step4ExtrasCardsProps = {
  variants: {
    hidden: { opacity: number; y: number };
    visible: (i: number) => {
      opacity: number;
      y: number;
      transition: { delay: number; duration: number; ease: 'easeOut' };
    };
  };
  showVipExtra: boolean;
  showNcbExtra: boolean;
  hasAnyExtraCard: boolean;
  selectedHasVipRoadside: boolean;
  selectedHasNcbProtection: boolean;
  extrasLoading: boolean;
  applyingBundleId: string | null;
  vipDelta: number | null;
  ncbDelta: number | null;
  formatDelta: (delta: number | null) => string;
  onToggleVip: () => void;
  onToggleNcb: () => void;
};

function ExtraCard(props: {
  title: string;
  subtitle: string;
  selected: boolean;
  loading: boolean;
  busy: boolean;
  delta: number | null;
  formatDelta: (delta: number | null) => string;
  onClick: () => void;
}) {
  return (
    <motion.div
      whileHover={props.loading || props.busy ? undefined : { y: -2, scale: 1.004 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.6 }}
      className={`
        rounded-2xl px-6 py-5 border transition-all duration-200 relative overflow-hidden
        ${props.selected
          ? 'bg-brand-primary/10 border-brand-primary ring-[3px] ring-brand-primary/15 shadow-[0_12px_28px_-20px_rgba(0,74,138,0.45)]'
          : 'bg-white border-gray-100 shadow-[0_18px_40px_-26px_rgba(0,0,0,0.20)] hover:border-gray-200'}
        ${props.loading || props.busy ? 'cursor-default opacity-80' : 'cursor-pointer'}
      `}
      onClick={props.onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[16px] font-extrabold tracking-tight text-gray-900">
            {props.title}
          </p>
          <div className="mt-2 text-xs font-semibold text-slate-600">
            {props.subtitle}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-gray-900 text-lg font-extrabold tracking-tight">
            {props.selected ? 'Selected' : props.loading && props.delta === null ? 'Calculating…' : props.formatDelta(props.delta)}
          </div>
          {props.selected ? (
            <div className="text-slate-500 text-xs font-semibold">Included</div>
          ) : props.delta !== null ? (
            <div className="text-slate-500 text-xs font-semibold">
              per year
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

export function Step4ExtrasCards(props: Step4ExtrasCardsProps) {
  if (!props.hasAnyExtraCard) {
    return null;
  }

  return (
    <motion.div custom={2} initial="hidden" animate="visible" variants={props.variants}>
      <div className="flex items-center gap-2 mb-4 ml-1">
        <h4 className="text-gray-900 font-medium">Add Extras</h4>
      </div>
      <div className="space-y-4">
        {props.showVipExtra ? (
          <ExtraCard
            title="VIP Roadside Upgrade"
            subtitle="Priority roadside assistance and concierge support."
            selected={props.selectedHasVipRoadside}
            loading={props.extrasLoading}
            busy={props.applyingBundleId === 'extra-vip'}
            delta={props.vipDelta}
            formatDelta={props.formatDelta}
            onClick={props.onToggleVip}
          />
        ) : null}

        {props.showNcbExtra ? (
          <ExtraCard
            title="No Claim Bonus Protection"
            subtitle="Protect your No-Claim Bonus after eligible claims."
            selected={props.selectedHasNcbProtection}
            loading={props.extrasLoading}
            busy={props.applyingBundleId === 'extra-ncb'}
            delta={props.ncbDelta}
            formatDelta={props.formatDelta}
            onClick={props.onToggleNcb}
          />
        ) : null}
      </div>
    </motion.div>
  );
}
