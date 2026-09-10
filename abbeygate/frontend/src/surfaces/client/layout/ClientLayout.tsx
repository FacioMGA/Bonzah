import React, { Suspense } from 'react';

import { Button } from '@/src/shared/ui';
import type { AppUser } from '@/src/shared/types/session';
import { ClientAccountMenu } from '@/src/surfaces/client/layout/ClientAccountMenu';

type ClientLayoutProps = {
  children: React.ReactNode;
  user: AppUser | null;
  onLogout: () => void;
};

export function ClientLayout({ children, user, onLogout }: ClientLayoutProps) {
  return (
    <div className="h-screen overflow-hidden bg-brand-canvas">
      <main className="h-full flex flex-col min-w-0">
        <header className="sticky top-0 z-40 h-20 bg-brand-primary border-b border-brand-primary/80 shadow-none shrink-0">
          <div className="h-full px-6 sm:px-8 lg:px-14">
            <div className="h-full max-w-7xl mx-auto flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="inline-flex items-center rounded-xl p-0 bg-transparent hover:bg-transparent active:bg-transparent"
                onClick={() => { window.location.href = '/client'; }}
              >
                <img
                  src="/assets/branding/long-logo.svg"
                  alt="FacioMGA"
                  className="block h-12 sm:h-14 w-auto object-contain brightness-0 invert"
                />
              </Button>
              <div className="flex items-center gap-3">
                <div className="shrink-0">
                  {user && <ClientAccountMenu user={user} onLogout={onLogout} />}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto px-6 sm:px-8 lg:px-14 pb-12 w-full">
          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="text-slate-400 font-bold">Loading...</div></div>}>
            {children}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
