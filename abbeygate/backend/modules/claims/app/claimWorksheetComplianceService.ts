import {
  computeClaimComplianceGaps,
  resolveLossCountry,
} from '../domain/claimCompliance.js';

type ProjectionLike = {
  status?: string;
  cr0107Denial?: string;
  deniedAt?: string | null;
  closedAt?: string | null;
};

export function buildClaimWorksheetCompliance(args: {
  claimData: Record<string, unknown>;
  fnolSnapshot: Record<string, unknown>;
  projection: ProjectionLike;
}) {
  const resolvedLossCountry = resolveLossCountry(args.claimData, args.fnolSnapshot);
  const complianceGaps = computeClaimComplianceGaps({
    claimData: args.claimData,
    fnolSnapshot: args.fnolSnapshot,
    projection: args.projection,
    resolvedLossCountry,
  });
  return { resolvedLossCountry, complianceGaps };
}
