import { motion } from 'framer-motion';
import lloydsLogo from './lloyds.png';

import { TenantBrand, useOperatingTenant } from '@/src/shared/lib/tenant/TenantBrand';
import { safeBrandUrl } from '@/src/shared/lib/tenant/runtimeProfile';

export interface WizardHeaderProps {
  currentStep: number;
  totalSteps: number;
  steps: string[];
  brandLogo?: string;
  showLloydsLogo?: boolean;
}

/**
 * Product-agnostic wizard header with progress bar.
 *
 * Motor uses its own copy today; Home and Travel use this.
 * Branding assets resolvable via props so tenant variants can swap logos.
 */
export function Header({
  currentStep,
  totalSteps,
  steps,
  brandLogo,
  showLloydsLogo = false,
}: WizardHeaderProps) {
  const tenant = useOperatingTenant();
  const website = safeBrandUrl(tenant?.profile.runtimeSettings?.branding.websiteUrl);
  const name = tenant?.displayName || 'Facio Platform';
  const configuredLogo = safeBrandUrl(brandLogo);
  const brand = configuredLogo ? (
    <img
      src={configuredLogo}
      alt={name}
      style={{ height: '42px', maxWidth: '160px', objectFit: 'contain' }}
    />
  ) : (
    <TenantBrand className="max-h-12 max-w-40 object-contain" />
  );
  return (
    <div
      className="bg-white border-b border-gray-100 sticky top-0 z-50 shadow-sm"
      style={{
        // ABY-56: respect the iOS safe-area inset so the header is no
        // longer cut by the notch / status bar on iPhone Safari. The
        // inner row keeps its 80px height (the visual brand band) and
        // the safe-area is added on top via padding so the sticky `top:
        // 0` still anchors correctly.
        height: 'calc(80px + env(safe-area-inset-top, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        backgroundColor: '#ffffff',
        position: 'sticky',
        top: 0,
      }}
    >
      <div
        className="mx-auto flex w-full items-center justify-between px-5 md:px-8"
        style={{ maxWidth: '1400px', height: '80px' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            minWidth: '0',
            flexShrink: 0,
          }}
        >
          {website ? (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={'Open ' + name + ' website'}
            >
              {brand}
            </a>
          ) : (
            brand
          )}
        </div>

        <div className="hidden md:block flex-1" style={{ maxWidth: '760px', margin: '0 auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
              width: '100%',
              position: 'relative',
              zIndex: 10,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '11px',
                left: `${100 / steps.length / 2}%`,
                right: `${100 / steps.length / 2}%`,
                height: '2px',
                zIndex: -1,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: '#e5e7eb',
                  borderRadius: '9999px',
                }}
              />
              <motion.div
                initial={false}
                animate={{ width: `${((currentStep - 1) / Math.max(1, totalSteps - 1)) * 100}%` }}
                transition={{ type: 'spring', stiffness: 50, damping: 15 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: '100%',
                  background:
                    'linear-gradient(to right, var(--tenant-brand-primary, #334155), var(--tenant-brand-secondary, #64748b))',
                  borderRadius: '9999px',
                }}
              />
            </div>
            {steps.map((step, index) => {
              const isActive = index + 1 === currentStep;
              const isCompleted = index + 1 < currentStep;
              return (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    cursor: 'default',
                  }}
                >
                  <motion.div
                    animate={{
                      borderColor:
                        isActive || isCompleted
                          ? 'var(--tenant-brand-primary, #334155)'
                          : '#d1d5db',
                      backgroundColor: '#ffffff',
                      scale: isActive ? 1.25 : 1,
                      boxShadow: isActive ? '0 0 0 4px rgba(59, 130, 246, 0.1)' : 'none',
                    }}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      border: '1.5px solid',
                      color:
                        isActive || isCompleted
                          ? 'var(--tenant-brand-primary, #334155)'
                          : '#9ca3af',
                      zIndex: 20,
                      position: 'relative',
                    }}
                  >
                    {isCompleted ? (
                      <motion.svg
                        initial={{ scale: 0, rotate: -90 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        style={{ width: '12px', height: '12px' }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </motion.svg>
                    ) : (
                      <span className="relative z-10">{index + 1}</span>
                    )}
                  </motion.div>
                  <span
                    style={{
                      fontSize: '10px',
                      marginTop: '6px',
                      fontWeight: 500,
                      textTransform: 'uppercase',
                      color: isActive
                        ? 'var(--tenant-brand-primary, #334155)'
                        : isCompleted
                          ? '#111827'
                          : '#9ca3af',
                      display: 'block',
                      textAlign: 'center',
                      lineHeight: 1.2,
                      maxWidth: '150px',
                    }}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            minWidth: '0',
            flexShrink: 0,
          }}
        >
          {showLloydsLogo ? (
            <img
              src={lloydsLogo}
              alt="Lloyd's Coverholder"
              style={{ height: '28px', objectFit: 'contain' }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
