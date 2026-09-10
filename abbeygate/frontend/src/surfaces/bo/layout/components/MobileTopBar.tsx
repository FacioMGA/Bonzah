import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { resolveBoPageTitle } from '@/src/surfaces/bo/navigation';
import type { AppUser } from '@/src/shared/types/session';

type MobileTopBarProps = {
  user: AppUser;
  isDrawerOpen: boolean;
  onToggleDrawer: () => void;
};

export function MobileTopBar({ user: _user, isDrawerOpen, onToggleDrawer }: MobileTopBarProps) {
  const { pathname } = useLocation();
  const title = resolveBoPageTitle(pathname);

  // Scroll-aware blur effect
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = document.getElementById('bo-content-scroll');
    if (!el) return;
    const handleScroll = () => setScrolled(el.scrollTop > 8);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header
      className={[
        'flex lg:hidden items-center h-14 px-4 shrink-0 z-50 sticky top-0 transition-all duration-150',
        scrolled
          ? 'bg-brand-canvas/90 backdrop-blur-md shadow-sm border-b border-slate-200/60'
          : 'bg-brand-canvas border-b border-slate-900/5',
      ].join(' ')}
    >
      {/* Hamburger → X morph */}
      <button
        type="button"
        onClick={onToggleDrawer}
        className="relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-slate-100 active:bg-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        aria-label={isDrawerOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={isDrawerOpen}
      >
        <span className="sr-only">{isDrawerOpen ? 'Close menu' : 'Open menu'}</span>
        <span
          className={[
            'absolute block h-[2px] w-5 bg-slate-700 rounded-full transition-all',
            isDrawerOpen
              ? 'rotate-45 translate-y-0 duration-300'
              : '-translate-y-[5px] duration-300',
          ].join(' ')}
          style={isDrawerOpen ? { transitionTimingFunction: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)' } : undefined}
        />
        <span
          className={[
            'absolute block h-[2px] w-5 bg-slate-700 rounded-full transition-all duration-200',
            isDrawerOpen ? 'opacity-0 scale-x-0' : 'opacity-100 scale-x-100',
          ].join(' ')}
        />
        <span
          className={[
            'absolute block h-[2px] w-5 bg-slate-700 rounded-full transition-all',
            isDrawerOpen
              ? '-rotate-45 translate-y-0 duration-300'
              : 'translate-y-[5px] duration-300',
          ].join(' ')}
          style={isDrawerOpen ? { transitionTimingFunction: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)' } : undefined}
        />
      </button>

      <h2 className="flex-1 text-center text-sm font-bold text-slate-800 tracking-tight truncate px-2">
        {title}
      </h2>

      <span className="w-10 h-10 shrink-0" aria-hidden="true" />
    </header>
  );
}
