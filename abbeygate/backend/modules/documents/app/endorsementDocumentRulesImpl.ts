type UnknownRecord = Record<string, unknown>;

export type EndorsementDocDecisionFlags = {
  certificateChanged: boolean;
  scheduleChanged: boolean;
  greenCardChanged: boolean;
  sofChanged: boolean;
  materialCoverChanged: boolean;
};

export type EndorsementDocDecision = {
  alwaysGenerateDelta: true;
  requiresEvidencePack: boolean;
  reasons: string[];
  flags: EndorsementDocDecisionFlags;
  changedFields: string[];
  unknownCriticalDiff: boolean;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function canonical(value: unknown): string {
  if (value === undefined) return '__undefined__';
  if (value === null) return '__null__';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return JSON.stringify(value.map((v) => canonical(v)));
  return JSON.stringify(value);
}

function rootQuoteData(snapshot: unknown): UnknownRecord {
  const snap = asRecord(snapshot);
  return asRecord(snap.quoteData);
}

function pickPath(snapshot: unknown, path: string[]): unknown {
  let node: unknown = snapshot;
  for (const segment of path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as UnknownRecord)[segment];
  }
  return node;
}

function changedAtAnyPath(
  baseline: unknown,
  endorsement: unknown,
  paths: string[][]
): { changed: boolean; path?: string } {
  for (const path of paths) {
    const prev = pickPath(baseline, path);
    const next = pickPath(endorsement, path);
    if (canonical(prev) !== canonical(next)) {
      return { changed: true, path: path.join('.') };
    }
  }
  return { changed: false };
}

const CERTIFICATE_PATHS: string[][] = [
  ['effectiveDate'],
  ['expiryDate'],
  ['quoteData', 'periodStartDate'],
  ['quoteData', 'periodEndDate'],
  ['quoteData', 'registrationNumber'],
  ['quoteData', 'make'],
  ['quoteData', 'model'],
  ['quoteData', 'firstName'],
  ['quoteData', 'lastName'],
  ['quoteData', 'dateOfBirth'],
  ['quoteData', 'addressLine'],
  ['quoteData', 'city'],
  ['quoteData', 'postCode'],
  ['quoteData', 'country'],
  ['quoteData', 'vehicleUse'],
  ['quoteData', 'licenseType'],
  ['quoteData', 'hasAdditionalDrivers'],
  ['quoteData', 'additionalDrivers'],
];

const SCHEDULE_PATHS: string[][] = [
  ['quoteData', 'coverRequired'],
  ['quoteData', 'requiredExcess'],
  ['quoteData', 'ncb'],
  ['quoteData', 'protectNCB'],
  ['quoteData', 'vehicleValue'],
  ['quoteData', 'uwAdjustments'],
  ['quoteData', 'uwAdjustment'],
  ['quoteData', 'programAddons'],
  ['quoteResponse', 'primaryOption'],
  ['quoteResponse', 'alternativeOptions'],
];

const GREEN_CARD_PATHS: string[][] = [
  ['effectiveDate'],
  ['expiryDate'],
  ['quoteData', 'periodStartDate'],
  ['quoteData', 'periodEndDate'],
  ['quoteData', 'registrationNumber'],
  ['quoteData', 'make'],
  ['quoteData', 'model'],
  ['quoteData', 'firstName'],
  ['quoteData', 'lastName'],
];

const SOF_PATHS: string[][] = [
  ['quoteData', 'hasClaims'],
  ['quoteData', 'claimsDetails'],
  ['quoteData', 'claimsCountLast5Years'],
  ['quoteData', 'claimsTotalCostLast5Years'],
  ['quoteData', 'maxFaultClaimCostLast5Years'],
  ['quoteData', 'hasConvictions'],
  ['quoteData', 'convictionsDetails'],
  ['quoteData', 'hasMajorConvictionLast5Years'],
  ['quoteData', 'convictionClass'],
  ['quoteData', 'majorConvictionWithinYears'],
  ['quoteData', 'occupation'],
  ['quoteData', 'whereDidYouHear'],
];

const MATERIAL_COVER_PATHS: string[][] = [
  ...SCHEDULE_PATHS,
  ['quoteData', 'vehicleUse'],
  ['quoteData', 'engineSize'],
  ['quoteData', 'kmsPerYear'],
];
const UW_ADJUSTMENT_PATHS = new Set<string>(['quoteData.uwAdjustments', 'quoteData.uwAdjustment']);

const KNOWN_PATHS = new Set<string>([
  ...CERTIFICATE_PATHS.map((p) => p.join('.')),
  ...SCHEDULE_PATHS.map((p) => p.join('.')),
  ...GREEN_CARD_PATHS.map((p) => p.join('.')),
  ...SOF_PATHS.map((p) => p.join('.')),
  ...MATERIAL_COVER_PATHS.map((p) => p.join('.')),
]);

function detectUnknownCriticalDiff(baseline: unknown, endorsement: unknown): boolean {
  const baselineQd = rootQuoteData(baseline);
  const endorsementQd = rootQuoteData(endorsement);
  const keys = new Set<string>([...Object.keys(baselineQd), ...Object.keys(endorsementQd)]);
  for (const key of keys) {
    const fullPath = `quoteData.${key}`;
    if (KNOWN_PATHS.has(fullPath)) continue;
    if (canonical(baselineQd[key]) !== canonical(endorsementQd[key])) return true;
  }
  return false;
}

export function detectChangedFields(baselineSnapshot: unknown, endorsementSnapshot: unknown): string[] {
  const changed = new Set<string>();
  for (const group of [CERTIFICATE_PATHS, SCHEDULE_PATHS, GREEN_CARD_PATHS, SOF_PATHS, MATERIAL_COVER_PATHS]) {
    const hit = changedAtAnyPath(baselineSnapshot, endorsementSnapshot, group);
    if (hit.changed && hit.path) changed.add(hit.path);
  }
  return Array.from(changed).sort((a, b) => a.localeCompare(b));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function extractPricingUwAdjustments(snapshot: unknown): unknown[] {
  const qd = rootQuoteData(snapshot);
  const raw = qd.uwAdjustments !== undefined ? qd.uwAdjustments : qd.uwAdjustment;
  const lines = asArray(raw);
  return lines
    .map((line) => asRecord(line))
    .filter((line) => {
      const lineType = String(line.lineType || '').trim().toLowerCase();
      if (!lineType) return true;
      return lineType !== 'schedule_note';
    })
    .map((line) => ({
      lineType: String(line.lineType || 'pricing'),
      type: String(line.type || ''),
      mode: String(line.mode || ''),
      value: Number(line.value || 0) || 0,
      scopeType: String(line.scopeType || ''),
      scopeRef: String(line.scopeRef || ''),
      reasonText: String(line.reasonText || line.reason || ''),
      schedulePresentation: String(line.schedulePresentation || ''),
    }));
}

function hasPricingImpactUwAdjustmentChange(baselineSnapshot: unknown, endorsementSnapshot: unknown): boolean {
  const before = extractPricingUwAdjustments(baselineSnapshot);
  const after = extractPricingUwAdjustments(endorsementSnapshot);
  return canonical(before) !== canonical(after);
}

export function decideEndorsementDocumentActions(input: {
  changedFields: string[];
  baselineSnapshot: unknown;
  endorsementSnapshot: unknown;
}): EndorsementDocDecision {
  const changedFieldSet = new Set(input.changedFields);
  const certificateChanged = CERTIFICATE_PATHS.some((p) => changedFieldSet.has(p.join('.')));
  const uwAdjustmentChanged = Array.from(UW_ADJUSTMENT_PATHS).some((path) => changedFieldSet.has(path));
  const nonUwScheduleChanged = SCHEDULE_PATHS
    .filter((p) => !UW_ADJUSTMENT_PATHS.has(p.join('.')))
    .some((p) => changedFieldSet.has(p.join('.')));
  const greenCardChanged = GREEN_CARD_PATHS.some((p) => changedFieldSet.has(p.join('.')));
  const sofChanged = SOF_PATHS.some((p) => changedFieldSet.has(p.join('.')));
  const nonUwMaterialChanged = MATERIAL_COVER_PATHS
    .filter((p) => !UW_ADJUSTMENT_PATHS.has(p.join('.')))
    .some((p) => changedFieldSet.has(p.join('.')));
  const pricingUwChanged = uwAdjustmentChanged && hasPricingImpactUwAdjustmentChange(
    input.baselineSnapshot,
    input.endorsementSnapshot
  );
  const scheduleChanged = nonUwScheduleChanged || pricingUwChanged;
  const materialCoverChanged = nonUwMaterialChanged || pricingUwChanged;
  const unknownCriticalDiff = detectUnknownCriticalDiff(input.baselineSnapshot, input.endorsementSnapshot);

  const reasons: string[] = [];
  if (certificateChanged) reasons.push('certificate_fields_changed');
  if (scheduleChanged) reasons.push('schedule_fields_changed');
  if (greenCardChanged) reasons.push('green_card_fields_changed');
  if (sofChanged) reasons.push('statement_of_fact_fields_changed');
  if (materialCoverChanged) reasons.push('material_cover_changed');
  if (unknownCriticalDiff) reasons.push('unknown_critical_diff_fallback');

  const requiresEvidencePack =
    certificateChanged ||
    scheduleChanged ||
    greenCardChanged ||
    sofChanged ||
    materialCoverChanged ||
    unknownCriticalDiff;

  return {
    alwaysGenerateDelta: true,
    requiresEvidencePack,
    reasons,
    flags: {
      certificateChanged,
      scheduleChanged,
      greenCardChanged,
      sofChanged,
      materialCoverChanged,
    },
    changedFields: [...input.changedFields].sort((a, b) => a.localeCompare(b)),
    unknownCriticalDiff,
  };
}

export function evaluateEndorsementDocumentActions(input: {
  baselineSnapshot: unknown;
  endorsementSnapshot: unknown;
}): EndorsementDocDecision {
  const changedFields = detectChangedFields(input.baselineSnapshot, input.endorsementSnapshot);
  return decideEndorsementDocumentActions({
    changedFields,
    baselineSnapshot: input.baselineSnapshot,
    endorsementSnapshot: input.endorsementSnapshot,
  });
}
