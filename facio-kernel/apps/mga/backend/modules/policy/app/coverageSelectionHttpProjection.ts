import {
  normalizeCoverageSelectionSnapshot,
  parseCoverageSelectionSnapshot,
  resolveEffectiveCoverageContract,
} from '../domain/coverageSelectionContract.js';

/**
 * Application-layer projection of the canonical coverage contract for HTTP
 * handlers. This preserves the surface boundary without duplicating rules.
 */
export function parseCoverageSelectionForHttp(value: unknown) {
  return parseCoverageSelectionSnapshot(value);
}

export function normalizeCoverageSelectionForHttp(
  args: Parameters<typeof normalizeCoverageSelectionSnapshot>[0]
) {
  return normalizeCoverageSelectionSnapshot(args);
}

export function resolveCoverageContractForHttp(
  args: Parameters<typeof resolveEffectiveCoverageContract>[0]
) {
  return resolveEffectiveCoverageContract(args);
}
