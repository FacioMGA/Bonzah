import { TenantBrand } from '@/src/shared/lib/tenant/TenantBrand';
import React, { useCallback, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Button } from '@/src/shared/ui';
import { canAccessConfigureMode } from '@/src/modules/auth/session';
import {
  CONFIGURE_NAV_SECTIONS,
  OPERATE_NAV_ITEMS,
  WORKSPACE_SETTINGS_ENTRY,
  isNavItemActive,
} from '@/src/surfaces/bo/navigation';
import { useBoMode } from '@/src/surfaces/bo/mode';
import type { AppUser } from '@/src/shared/types/session';

type MobileNavDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  user?: AppUser | null;
};

export function MobileNavDrawer({ isOpen, onClose, onLogout, user }: MobileNavDrawerProps) {
  const { pathname } = useLocation();
  const { mode } = useBoMode();
  const drawerRef = useRef<HTMLDivElement>(null);
  const canConfigure = canAccessConfigureMode(user);

  // Close on route change
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPathRef.current && isOpen) {
      onClose();
    }
    prevPathRef.current = pathname;
  }, [pathname, isOpen, onClose]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Focus trap: focus drawer when opened
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [isOpen]);

  const handleBackdropClick = useCallback(() => onClose(), [onClose]);

  const renderNavLink = (item: { name: string; path: string; icon?: string; matchPrefix?: string }, emphasis: 'operate' | 'configure' | 'ghost' = 'operate') => {
    const active = isNavItemActive(pathname, item);
    const baseClass = emphasis === 'configure'
      ? active
        ? 'bg-violet-600 text-white shadow-lg shadow-violet-900/30'
        : 'text-slate-300 hover:bg-white/5 hover:text-white active:bg-white/10'
      : emphasis === 'ghost'
        ? active
          ? 'bg-white/10 text-white'
          : 'text-slate-300 hover:bg-white/5 hover:text-white active:bg-white/10'
        : active
          ? 'bg-brand-primary text-white shadow-lg shadow-black/20'
          : 'text-slate-400 hover:bg-brand-dark/40 hover:text-slate-200 active:bg-brand-dark/60';

    return (
      <NavLink
        key={item.name}
        to={item.path}
        className={[
          'flex items-center px-4 py-3 rounded-xl text-[14px] font-bold tracking-tight transition-all duration-200',
          baseClass,
          'animate-[nav-item-in_250ms_ease-out_both]',
        ].join(' ')}
      >
        {item.icon && (
          <svg className="mr-3 h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
          </svg>
        )}
        {item.name}
      </NavLink>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[55] lg:hidden">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[backdrop-in_200ms_ease-out_both]"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <nav
        ref={drawerRef}
        tabIndex={-1}
        className="absolute top-0 left-0 h-full bg-brand-deep shadow-2xl overflow-y-auto outline-none animate-[drawer-in_280ms_cubic-bezier(0.32,0.72,0,1)_both]"
        style={{ width: 'min(80vw, 320px)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        {/* Logo */}
        <div className="px-6 py-8 pb-4">
          <TenantBrand inverse className="h-12 w-auto" />
        </div>

        <div className="px-3 space-y-4">
          {mode === 'configure' ? (
            <div className="space-y-4">
              {CONFIGURE_NAV_SECTIONS.map((section) => (
                <section key={section.title} className="space-y-2">
                  <div className="px-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {section.title}
                  </div>
                  <div className="space-y-1.5">
                    {section.items.map((item) => renderNavLink(item, 'configure'))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            OPERATE_NAV_ITEMS.map((item) => renderNavLink(item, 'operate'))
          )}
        </div>

        <div className="mt-8 border-t border-white/10 px-4 pt-4 pb-8">
          <div className="rounded-2xl bg-white/5 px-4 py-3">
            {mode === 'operate' && canConfigure && (
              <div className="mb-4">{renderNavLink(WORKSPACE_SETTINGS_ENTRY, 'ghost')}</div>
            )}
            {mode === 'configure' && (
              <div className="mb-4">{renderNavLink({ ...WORKSPACE_SETTINGS_ENTRY, name: 'Back to Operations', path: '/' }, 'ghost')}</div>
            )}
            <div className="text-sm font-bold text-white">{user?.role || 'Back Office'}</div>
            <div className="mt-1 text-xs text-slate-300">Signed in on mobile</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onClose();
                onLogout();
              }}
              className="mt-3 w-full justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white hover:bg-white/10"
            >
              Logout
            </Button>
          </div>
        </div>
      </nav>
    </div>
  );
}
