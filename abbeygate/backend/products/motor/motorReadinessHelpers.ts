/**
 * Motor-specific readiness helpers.
 * These functions are used by the MotorProductAdapter for issue readiness validation.
 */
import type { IssueReadinessResult, IssueBlockerSeverity } from '../../modules/policy/domain/issueReadinessTypes.js';

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function additionalDriversConditionalRequirements(quoteData: unknown): IssueReadinessResult['conditionalRequirements'] {
  const qd = asRecord(quoteData);
  const hasAdditionalDrivers = toBool(qd.hasAdditionalDrivers);
  if (!hasAdditionalDrivers) return [];

  const driversRaw = Array.isArray(qd.additionalDrivers) ? qd.additionalDrivers : [];
  if (driversRaw.length === 0) {
    return [{
      code: 'ADDITIONAL_DRIVERS_REQUIRED',
      message: 'Please add at least one additional driver before continuing.',
      severity: 'BLOCK' as IssueBlockerSeverity,
    }];
  }

  const invalidEntries: Array<{ index: number; missing: string[] }> = [];
  driversRaw.forEach((driver, idx) => {
    const d = asRecord(driver);
    const missing: string[] = [];
    if (!String(d.firstName ?? '').trim()) missing.push('firstName');
    if (!String(d.lastName ?? '').trim()) missing.push('lastName');
    if (!String(d.dateOfBirth ?? '').trim()) missing.push('dateOfBirth');
    if (!String(d.licenseYears ?? '').trim()) missing.push('licenseYears');
    if (missing.length > 0) invalidEntries.push({ index: idx, missing });
  });

  if (invalidEntries.length === 0) return [];
  return [{
    code: 'ADDITIONAL_DRIVER_FIELDS_REQUIRED',
    message: 'Some additional drivers are missing required details.',
    severity: 'BLOCK' as IssueBlockerSeverity,
    details: { invalidEntries },
  }];
}
