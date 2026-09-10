// Issue-readiness validation diagnostics builder.
// Extracted from `../issueReadiness.ts` in sprint follow-up F4b so
// the orchestrator file stays under the file-size cap.

import type { IssueReadinessResult } from '../issueReadinessTypes.js';
import { hasMeaningfulValue, type UnknownRecord } from '../issueReadinessGuards.js';

export function valueAtPath(source: UnknownRecord, path: string): unknown {
  return String(path || '').split('.').filter(Boolean).reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return (current as UnknownRecord)[segment];
    }
    return undefined;
  }, source);
}

export function buildValidationDiagnostics(args: {
  productType: string | null;
  quoteData: UnknownRecord;
  missingForIssuedPack: Array<{ slug: string; label: string; customerHash?: string; boTab?: string }>;
  schemaIssues: Array<{ slug: string; message: string; path?: string }>;
  conditionalRequirements: IssueReadinessResult['conditionalRequirements'];
}): NonNullable<IssueReadinessResult['diagnostics']>['validation'] {
  const productType = String(args.productType || '').trim().toUpperCase() || undefined;
  const diagnostics: NonNullable<IssueReadinessResult['diagnostics']>['validation'] = [];
  for (const field of args.missingForIssuedPack) {
    const path = String(field.slug || '').trim();
    diagnostics.push({
      productType,
      field: path,
      validator: 'productAdapter.requiredFieldsForDocPack',
      readPath: `stateCurrent.snapshot.quoteData.${path}`,
      actualValuePresent: hasMeaningfulValue(valueAtPath(args.quoteData, path)),
      blocking: true,
      message: `${field.label || path} is required`,
    });
  }
  for (const issue of args.schemaIssues) {
    const path = String(issue.path || issue.slug || '').trim();
    diagnostics.push({
      productType,
      field: path,
      validator: 'productAdapter.validateForIssuance',
      readPath: `stateCurrent.snapshot.quoteData.${path}`,
      actualValuePresent: hasMeaningfulValue(valueAtPath(args.quoteData, path)),
      blocking: true,
      message: issue.message,
    });
  }
  for (const requirement of args.conditionalRequirements) {
    diagnostics.push({
      productType,
      field: requirement.code,
      validator: 'productAdapter.conditionalRequirements',
      readPath: 'stateCurrent.snapshot.quoteData',
      blocking: (requirement.severity || 'BLOCK') === 'BLOCK',
      message: requirement.message,
    });
  }
  return diagnostics;
}

export function formatConditionalRequirementsMessage(
  conditionalRequirements: IssueReadinessResult["conditionalRequirements"],
): string {
  const messages = Array.from(
    new Set(
      conditionalRequirements
        .map((requirement) => String(requirement.message || '').trim())
        .filter(Boolean),
    ),
  );
  if (messages.length === 0) return 'Complete the conditional underwriting requirements before issuing.';
  return `Complete these underwriting requirements before issuing: ${messages.join(' ')}`;
}
