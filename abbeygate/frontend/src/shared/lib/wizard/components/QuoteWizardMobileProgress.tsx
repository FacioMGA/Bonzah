export interface QuoteWizardMobileProgressProps {
  currentStep: number;
  steps: string[];
}

/**
 * Product-agnostic mobile progress indicator. Label source comes from props.
 *
 * ABY-58: when the wizard has many steps (Home: 8, Travel: 7) the per-step
 * label width on a 413px iPhone viewport is ~50px, which is narrower than
 * labels like "Construction" or "Sums insured". Rather than render every
 * label and let them overlap, we now show:
 *   - all step dots (with progress fill) on a single tight row
 *   - a single, prominent "Step N of M — <Active label>" caption above
 * That keeps the journey context visible without crowding, and mirrors the
 * desktop header's intent (which already hides labels behind dots).
 */
export function QuoteWizardMobileProgress({ currentStep, steps }: QuoteWizardMobileProgressProps) {
  const safeCurrent = Math.min(Math.max(currentStep, 1), steps.length);
  const activeLabel = steps[safeCurrent - 1] || '';
  return (
    <div
      className="mobile-only mobile-progress-bar sticky z-40"
      style={{
        // ABY-56: align under the header which now respects the iOS safe
        // area inset (`env(safe-area-inset-top)`). Without this, the
        // mobile progress bar slid up under the notch on iOS Safari.
        top: 'calc(80px + env(safe-area-inset-top, 0px))',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #f3f4f6',
        padding: '10px 0 12px',
      }}
    >
      <div className="max-w-4xl mx-auto px-5">
        <div className="flex items-baseline justify-between mb-2">
          <span style={{ fontSize: 11, fontWeight: 700, color: '#004a8a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Step {safeCurrent} of {steps.length}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', maxWidth: '70%', textAlign: 'right' }}>{activeLabel}</span>
        </div>
        <div className="relative flex justify-between w-full z-10">
          <div
            style={{
              position: 'absolute',
              top: 'calc(50% - 1px)',
              left: `${100 / (steps.length * 2)}%`,
              right: `${100 / (steps.length * 2)}%`,
              height: '2px',
              zIndex: -1,
            }}
          >
            <div style={{ position: 'absolute', inset: 0, backgroundColor: '#e5e7eb', borderRadius: '9999px' }} />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${((safeCurrent - 1) / Math.max(1, steps.length - 1)) * 100}%`,
                background: 'linear-gradient(to right, #004a8a, #3b82f6)',
                borderRadius: '9999px',
                transition: 'width 250ms ease',
              }}
            />
          </div>
          {steps.map((label, index) => {
            const s = index + 1;
            const active = s === safeCurrent;
            const completed = s < safeCurrent;
            return (
              <div key={label} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: `${100 / steps.length}%` }}>
                <div
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Step ${s}: ${label}`}
                  style={{
                    width: active ? '20px' : '14px',
                    height: active ? '20px' : '14px',
                    borderRadius: '50%',
                    border: active ? '2px solid #004a8a' : completed ? '2px solid #004a8a' : '1.5px solid #d1d5db',
                    color: active || completed ? '#004a8a' : '#9ca3af',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    fontWeight: 700,
                    backgroundColor: completed ? '#004a8a' : '#fff',
                    boxShadow: active ? '0 0 0 4px rgba(59,130,246,0.12)' : 'none',
                    transition: 'all 200ms ease',
                  }}
                >
                  {completed ? (
                    <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#ffffff" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : active ? (
                    <span style={{ color: '#004a8a' }}>{s}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
