import React, { createContext, useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

export type AppMode = 'operate' | 'configure';

type BoModeContextValue = {
  mode: AppMode;
};

const BoModeContext = createContext<BoModeContextValue | null>(null);

export function getAppModeFromPathname(pathname: string): AppMode {
  return pathname.startsWith('/configure') ? 'configure' : 'operate';
}

export function isConfigureModePathname(pathname: string): boolean {
  return getAppModeFromPathname(pathname) === 'configure';
}

export function BoModeProvider({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const value = useMemo<BoModeContextValue>(() => ({
    mode: getAppModeFromPathname(pathname),
  }), [pathname]);

  return (
    <BoModeContext.Provider value={value}>
      {children}
    </BoModeContext.Provider>
  );
}

export function useBoMode(): BoModeContextValue {
  const value = useContext(BoModeContext);
  if (!value) {
    throw new Error('useBoMode must be used within a BoModeProvider');
  }
  return value;
}
