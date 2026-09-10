export type {
  CreateCaseDraft,
  PolicyOption,

  TabKey,
} from '@/src/modules/claims/desk/model/types';

export type {
  DevelopmentType,
  DevFormState,
} from '@/src/modules/claims/case/model/worksheetTypes';

export type ClaimsDeskViewModel = {
  routeClaimId: string;
  isDetailView: boolean;
  activeTab: string;
  hasWorksheet: boolean;
  caseMode: boolean;
};
