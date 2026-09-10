import React from 'react';

/**
 * Product icon lookup by iconKey (declared on ProductManifest.theme.iconKey).
 * Shared icon dictionary — adding a new product just requires picking an iconKey.
 */

type IconKey = 'car' | 'home' | 'plane' | 'briefcase' | 'heart' | 'generic';

const ICONS: Record<string, React.ReactNode> = {
  car: (
    <>
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 13l2-6a2 2 0 012-1h10a2 2 0 012 1l2 6" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 13v4a1 1 0 001 1h1" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M19 13v4a1 1 0 01-1 1h-1" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M7 18a2 2 0 104 0H7z" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M13 18a2 2 0 104 0h-4z" />
    </>
  ),
  home: (
    <>
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M10 21V14h4v7" />
    </>
  ),
  plane: (
    <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M2 12l20-8-8 20-2-8-10-4z" />
  ),
  briefcase: (
    <>
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 7h18v13a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" />
      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
    </>
  ),
  heart: (
    <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-4.35-7-10a4 4 0 017-2.65A4 4 0 0119 11c0 5.65-7 10-7 10z" />
  ),
  generic: (
    <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h10" />
  ),
};

export interface ProductIconProps {
  iconKey: string;
  className?: string;
}

export function ProductIcon({ iconKey, className }: ProductIconProps) {
  const key = (iconKey in ICONS ? iconKey : 'generic') as IconKey;
  return (
    <svg className={className ?? 'w-4 h-4 text-slate-500'} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      {ICONS[key]}
    </svg>
  );
}
