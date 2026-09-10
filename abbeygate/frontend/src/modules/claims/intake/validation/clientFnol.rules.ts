import type { ClaimsContractDto, FnolForm } from '../model/clientFnol.types';

export type FnolGuidedRules = {
  requiresThirdPartyFor: string[];
  requiresPoliceFor: string[];
  requiresThirdParty: boolean;
  requiresPoliceRef: boolean;
};

export function resolveFnolGuidedRules(args: {
  contract?: ClaimsContractDto | null;
  incidentType: FnolForm['incidentType'] | string;
}): FnolGuidedRules {
  const { contract, incidentType } = args;
  const requiresThirdPartyFor = contract?.fnol?.rules?.requiresThirdPartyFor || ['collision'];
  const requiresPoliceFor = contract?.fnol?.rules?.requiresPoliceFor || ['theft', 'hit_and_run'];
  const incidentCfg = contract?.fnol?.incidentTypes?.find((x) => x.id === incidentType);
  const requiresThirdParty = incidentCfg
    ? Boolean(incidentCfg.thirdPartyStep)
    : requiresThirdPartyFor.includes(String(incidentType || ''));
  const requiresPoliceRef = requiresPoliceFor.includes(String(incidentType || ''));

  return {
    requiresThirdPartyFor,
    requiresPoliceFor,
    requiresThirdParty,
    requiresPoliceRef,
  };
}
