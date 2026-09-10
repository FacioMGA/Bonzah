import React from 'react';
import { useClaimsDeskController } from '@/src/modules/claims/desk/controller/useClaimsDeskController';

export type ClaimsDeskController = ReturnType<typeof useClaimsDeskController>;

const ClaimsDeskControllerContext = React.createContext<ClaimsDeskController | null>(null);

type ClaimsDeskControllerProviderProps = {
  controller: ClaimsDeskController;
  children: React.ReactNode;
};

export function ClaimsDeskControllerProvider(props: ClaimsDeskControllerProviderProps) {
  const { controller, children } = props;
  return <ClaimsDeskControllerContext.Provider value={controller}>{children}</ClaimsDeskControllerContext.Provider>;
}

export function useClaimsDeskCtrl() {
  const ctrl = React.useContext(ClaimsDeskControllerContext);
  if (!ctrl) {
    throw new Error('useClaimsDeskCtrl must be used within ClaimsDeskControllerProvider');
  }
  return ctrl;
}
