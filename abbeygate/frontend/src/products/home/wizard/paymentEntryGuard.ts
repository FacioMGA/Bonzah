import {
  homeInformationStepIds,
  homeWizardStepIdByManifestSectionId,
} from './quoteWizard.constants';
import { asRecord } from '@/src/shared/lib/record';

export type HomePaymentEntryRedirect = {
  stepId: string;
  fieldPath: string;
  label: string;
};

function missingFieldsFromReadiness(readiness: unknown): unknown[] {
  const data = asRecord(readiness);
  const missingFields = data.missingFields;
  if (Array.isArray(missingFields)) return missingFields;
  const rawBlockers = data.blockers;
  const blockers = Array.isArray(rawBlockers) ? rawBlockers : [];
  for (const rawBlocker of blockers) {
    const blocker = asRecord(rawBlocker);
    const code = String(blocker.code || '');
    if (code !== 'DOCUMENT_FIELDS_MISSING' && code !== 'QUOTE_DATA_INVALID') continue;
    const details = asRecord(blocker.details);
    const missingForIssuedPack = details.missingForIssuedPack;
    if (Array.isArray(missingForIssuedPack)) return missingForIssuedPack;
    const blockerMissingFields = details.missingFields;
    if (Array.isArray(blockerMissingFields)) return blockerMissingFields;
    const schemaIssues = details.schemaIssues;
    if (Array.isArray(schemaIssues)) return schemaIssues;
  }
  return [];
}

/**
 * Convert the canonical public issue-readiness response into a Home wizard
 * destination. This is deliberately only a UI projection: issue-readiness
 * remains the backend's authoritative payment/issuance gate.
 */
export function resolveHomePaymentEntryRedirect(
  readiness: unknown,
): HomePaymentEntryRedirect | null {
  for (const rawField of missingFieldsFromReadiness(readiness)) {
    const field = asRecord(rawField);
    const manifestSectionId = String(field.customerHash || '').trim();
    const stepId = homeWizardStepIdByManifestSectionId[manifestSectionId] || manifestSectionId;
    const fieldPath = String(field.slug || '').trim();
    if (!homeInformationStepIds.includes(stepId) || !fieldPath) continue;
    return {
      stepId,
      fieldPath,
      label: String(field.label || fieldPath).trim(),
    };
  }
  return null;
}
