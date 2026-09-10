import { asRecord } from '@/src/shared/lib/record';
export const MOTOR_LOSS_TYPE_OPTIONS = [
  { value: 'collision', label: 'Collision' },
  { value: 'theft', label: 'Theft' },
  { value: 'parked', label: 'Parked impact' },
  { value: 'vandalism', label: 'Vandalism' },
  { value: 'weather', label: 'Weather' },
  { value: 'windscreen', label: 'Windscreen' },
  { value: 'other', label: 'Other' },
] as const;

export const YES_NO_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

function readPath(snapshot: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => asRecord(acc)[segment], snapshot);
}

function normalizeBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return text === 'yes' || text === 'true';
}

export function getLossType(snapshot: Record<string, unknown>): string {
  return String(readPath(snapshot, 'incident.type') || '').trim().toLowerCase();
}

export function isThirdPartySectionVisible(snapshot: Record<string, unknown>): boolean {
  const lossType = getLossType(snapshot);
  return ['collision', 'parked', 'vandalism'].includes(lossType) || normalizeBool(readPath(snapshot, 'thirdParty.involved'));
}

export function isThirdPartyNameRequired(snapshot: Record<string, unknown>): boolean {
  return isThirdPartySectionVisible(snapshot) && normalizeBool(readPath(snapshot, 'thirdParty.involved'));
}

export function isPoliceReportRequired(snapshot: Record<string, unknown>): boolean {
  return getLossType(snapshot) === 'theft';
}

export function isWindscreenSectionVisible(snapshot: Record<string, unknown>): boolean {
  return getLossType(snapshot) === 'windscreen';
}
