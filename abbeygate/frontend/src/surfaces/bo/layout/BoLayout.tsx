import React, { Suspense, useCallback, useState } from 'react';

import ProfileMenu from '@/src/surfaces/bo/layout/components/ProfileMenu';
import Sidebar from '@/src/surfaces/bo/layout/components/Sidebar';
import { MobileTopBar } from '@/src/surfaces/bo/layout/components/MobileTopBar';
import { MobileNavDrawer } from '@/src/surfaces/bo/layout/components/MobileNavDrawer';
import type { AppUser } from '@/src/shared/types/session';

type BoLayoutProps = {
  children: React.ReactNode;
  user: AppUser;
  onLogout: () => void;
};

export function BoLayout({ children, user, onLogout }: BoLayoutProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const toggleDrawer = useCallback(() => setIsDrawerOpen((v) => !v), []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  return (
    <div className="flex h-screen overflow-hidden bg-brand-canvas">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden lg:flex">
        <Sidebar user={user} />
      </div>

      {/* Mobile drawer overlay — fixed positioned, outside main flow */}
      <MobileNavDrawer isOpen={isDrawerOpen} onClose={closeDrawer} onLogout={onLogout} user={user} />

      <main className="flex-1 flex flex-col min-w-0 h-full">
        {/* Mobile top bar — visible below lg */}
        <MobileTopBar user={user} isDrawerOpen={isDrawerOpen} onToggleDrawer={toggleDrawer} />

        {/* Desktop header — hidden on mobile (MobileTopBar replaces it) */}
        <header className="hidden lg:flex sticky top-0 z-50 items-center justify-end h-20 px-10 bg-brand-canvas border-b border-slate-900/5 shadow-none shrink-0">
          <ProfileMenu user={user} onLogout={onLogout} />
        </header>

        <div id="bo-content-scroll" className="flex-1 overflow-auto overflow-x-hidden px-4 pb-6 md:px-6 lg:px-10 lg:pb-10">
          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-slate-400 font-bold">Loading...</div></div>}>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  );
}

