// Generic 2+ option pill switch used by motor wizard steps. Extracted
// from Step3VehicleIdentitySection so Step5IssueDetails can reuse the
// same Registration/VIN UX (ABY-235) without duplicating ~30 LOC of
// presentational markup. Behaviour is purely visual — owners of each
// caller still hold the state and side-effects (e.g. snap-back logic,
// VIN lookup) so this stays a presentational primitive.

import type React from 'react';

export type SegmentedOption<T extends string> = {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function SegmentedSwitch<T extends string>(props: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  className?: string;
}) {
  const activeIndex = Math.max(0, props.options.findIndex((option) => option.id === props.value));
  const optionCount = Math.max(props.options.length, 1);
  const sliderWidth = `calc((100% - 0.5rem) / ${optionCount})`;
  const sliderX = `${activeIndex * 100}%`;

  return (
    <div className={`relative h-[56.5px] overflow-hidden rounded-xl border border-slate-200/80 bg-white p-1 ${props.className || ''}`}>
      <div
        className="absolute inset-y-1 left-1 rounded-lg border border-brand-primary/35 bg-brand-primary/10 transition-transform duration-300 ease-out"
        style={{ width: sliderWidth, transform: `translateX(${sliderX})` }}
      />
      <div className="relative grid h-full" style={{ gridTemplateColumns: `repeat(${props.options.length}, minmax(0, 1fr))` }}>
        {props.options.map((option) => {
          const Icon = option.icon;
          const isActive = option.id === props.value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => props.onChange(option.id)}
              className={`h-full flex items-center justify-center gap-1.5 rounded-lg px-2 text-xs sm:text-sm font-semibold transition-colors duration-200 ${isActive ? 'text-brand-primary' : 'text-slate-700 hover:text-slate-900'}`}
            >
              <Icon className="h-4 w-4" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
