import type { ClaimsDeskViewModel } from '@/src/modules/claims/model/types';

type BuildClaimsDeskViewModelArgs = {
  routeClaimId: string;
  activeTab: string;
  worksheet: unknown;
  caseMode: boolean;
};

export function buildClaimsDeskViewModel(args: BuildClaimsDeskViewModelArgs): ClaimsDeskViewModel {
  const routeClaimId = String(args.routeClaimId || '');
  return {
    routeClaimId,
    isDetailView: Boolean(routeClaimId),
    activeTab: String(args.activeTab || 'overview'),
    hasWorksheet: Boolean(args.worksheet),
    caseMode: Boolean(args.caseMode),
  };
}
