import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

type UnknownRecord = Record<string, unknown>;

export type ClaimFormFieldMode = 'locked' | 'editable_prefilled' | 'blank_required' | 'blank_optional' | 'derived';
export type ClaimFormFieldType = 'text' | 'date' | 'select' | 'textarea' | 'checkbox';

export type ClaimFormField = {
  fieldId: string;
  section: string;
  label: string;
  type: ClaimFormFieldType;
  mode: ClaimFormFieldMode;
  required: boolean;
  valueSource: 'policy' | 'fnol' | 'user' | 'derived';
  prefill?: string | boolean | null;
  options?: Array<{ value: string; label: string }>;
  visibility?: string;
  validation?: string;
  riskSignals?: string;
};

export type ClaimFormPackage = {
  version: number;
  status: 'SENT' | 'OPEN' | 'COMPLETED';
  sentAt: string;
  sentByUserId?: string | null;
  openedAt?: string | null;
  completedAt?: string | null;
  context: {
    incidentType: string;
    claimType: string;
    country: string;
    namedDrivers: Array<{ id: string; name: string }>;
  };
  fields: ClaimFormField[];
  sourceSnapshot: {
    policyNumber: string;
    policyHolderName: string;
  };
};

export type ClaimFormSignal = {
  fieldId: string;
  signal: string;
  severity: 'low' | 'medium' | 'high';
  expected?: string | null;
  actual?: string | null;
  note?: string;
  triggeredAt: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function inferIncidentType(claimData: UnknownRecord): string {
  const claimForm = asRecord(claimData.claimForm);
  const incident = asRecord(claimForm.incident);
  const fromForm = asString(incident.type).toLowerCase();
  if (fromForm) return fromForm;
  const fnol = asRecord(claimData.fnol);
  const fromFnol = asString(fnol.incidentType).toLowerCase();
  if (fromFnol) return fromFnol;
  return 'collision';
}

function normalizeMode(value: string): ClaimFormFieldMode {
  const m = value.toLowerCase();
  if (m.includes('locked')) return 'locked';
  if (m.includes('prefill')) return 'editable_prefilled';
  if (m.includes('blank') && m.includes('required')) return 'blank_required';
  if (m.includes('blank')) return 'blank_optional';
  if (m.includes('derived')) return 'derived';
  return 'blank_optional';
}

function normalizeType(value: string): ClaimFormFieldType {
  const v = value.toLowerCase();
  if (v.includes('date')) return 'date';
  if (v.includes('select')) return 'select';
  if (v.includes('checkbox')) return 'checkbox';
  if (v.includes('textarea')) return 'textarea';
  return 'text';
}

function normalizeIncidentToken(value: string): string {
  const t = value.toLowerCase().trim();
  if (!t) return '';
  if (t.includes('all')) return 'all';
  if (t.includes('collision')) return 'collision';
  if (t.includes('single')) return 'single_vehicle';
  if (t.includes('theft')) return 'theft';
  if (t.includes('fire')) return 'fire';
  if (t.includes('vandal')) return 'vandalism';
  if (t.includes('wind') || t.includes('glass')) return 'windscreen';
  if (t.includes('flood') || t.includes('weather')) return 'weather';
  if (t.includes('parked')) return 'parked_damage';
  if (t.includes('other')) return 'other';
  return t.replace(/\s+/g, '_');
}

function visibilityMatchesIncident(visibilityRaw: string, incidentTypeRaw: string): boolean {
  const visibility = asString(visibilityRaw);
  if (!visibility) return true;
  const incidentType = normalizeIncidentToken(incidentTypeRaw);
  const tokens = visibility
    .split(/[,/|]/g)
    .map((s) => normalizeIncidentToken(s))
    .filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.includes('all')) return true;
  if (tokens.includes(incidentType)) return true;
  // "other vehicle" style rows should still show for collision.
  if (incidentType === 'collision' && tokens.some((t) => t.includes('vehicle') || t.includes('third_party'))) return true;
  return false;
}

function parseOptionsFromFormat(raw: string): Array<{ value: string; label: string }> | undefined {
  const text = asString(raw);
  if (!text) return undefined;
  if (text.toLowerCase().includes('yes/no')) {
    return [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ];
  }
  const items = text
    .split(/[;\n|]/g)
    .map((s) => asString(s))
    .filter(Boolean);
  if (!items.length) return undefined;
  return items.slice(0, 20).map((item) => ({
    value: item.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    label: item,
  }));
}

export function isFnolSubmitted(claimDataRaw: unknown): boolean {
  const claimData = asRecord(claimDataRaw);
  const fnol = asRecord(claimData.fnol);
  const claimForm = asRecord(claimData.claimForm);
  return Boolean(asString(fnol.submittedAt) || asString(claimForm.submittedAt));
}

export function parseClaimFormPackage(claimDataRaw: unknown): ClaimFormPackage | null {
  const claimData = asRecord(claimDataRaw);
  const pkg = asRecord(claimData.claimFormPackage);
  const status = asString(pkg.status).toUpperCase();
  if (!status || !['SENT', 'OPEN', 'COMPLETED'].includes(status)) return null;
  return pkg as ClaimFormPackage;
}

export function isClaimFormVisibleToClient(claimDataRaw: unknown): boolean {
  const pkg = parseClaimFormPackage(claimDataRaw);
  if (!pkg) return false;
  if (!isFnolSubmitted(claimDataRaw)) return false;
  return pkg.status === 'SENT' || pkg.status === 'OPEN';
}

function normalizedComparableValue(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function evaluateClaimFormSignals(pkg: ClaimFormPackage, responsesRaw: unknown): ClaimFormSignal[] {
  const responses = asRecord(responsesRaw);
  const out: ClaimFormSignal[] = [];
  for (const field of pkg.fields || []) {
    const riskText = asString(field.riskSignals);
    if (!riskText) continue;
    const expected = field.prefill;
    const actual = responses[field.fieldId];
    const expectedNorm = normalizedComparableValue(expected);
    const actualNorm = normalizedComparableValue(actual);
    const changed = Boolean(expectedNorm) && Boolean(actualNorm) && expectedNorm !== actualNorm;
    if (!changed && field.mode !== 'locked') continue;

    if (field.mode === 'locked' && changed) {
      out.push({
        fieldId: field.fieldId,
        signal: 'locked_field_changed',
        severity: 'high',
        expected: String(expected ?? ''),
        actual: String(actual ?? ''),
        note: riskText,
        triggeredAt: new Date().toISOString(),
      });
      continue;
    }

    if (changed) {
      out.push({
        fieldId: field.fieldId,
        signal: 'prefilled_value_changed',
        severity: field.mode === 'editable_prefilled' ? 'medium' : 'low',
        expected: String(expected ?? ''),
        actual: String(actual ?? ''),
        note: riskText,
        triggeredAt: new Date().toISOString(),
      });
    }
  }
  return out;
}

export function buildClaimFormPackageFromSpec(input: {
  policyNumber: string;
  policyHolderName: string;
  quoteData: UnknownRecord;
  claimData: UnknownRecord;
  namedDrivers: Array<{ id: string; name: string }>;
  sentByUserId?: string | null;
  version: number;
  specRows: Array<Record<string, string>>;
}): ClaimFormPackage {
  const incidentType = inferIncidentType(input.claimData);
  const proposer = (input.quoteData?.proposer && typeof input.quoteData.proposer === 'object' ? input.quoteData.proposer : {}) as Record<string, unknown>;
  const proposerAddress = (proposer.address && typeof proposer.address === 'object' ? proposer.address : {}) as Record<string, unknown>;
  const country = asString(proposerAddress.country || proposer.domicileCountry || input.quoteData.countryOfRegistration) || getTenantConfig().country;
  const claimType = incidentType === 'theft' ? 'THEFT' : incidentType === 'windscreen' ? 'GLASS' : 'OWN_DAMAGE';

  const fields: ClaimFormField[] = input.specRows.map((row) => {
    const fieldId = asString(row['Field ID']);
    const section = asString(row.Section || 'Section');
    const label = asString(row['Atomic Field'] || row['Original Prompt'] || fieldId);
    const ui = asString(row['UI Component']);
    const dataSource = asString(row['Data Source']).toLowerCase();
    const required = asString(row['Required?']).toUpperCase() === 'TRUE';
    const mode = normalizeMode(asString(row['Default Mode']) + (required ? ' required' : ''));
    const valueSource: ClaimFormField['valueSource'] =
      dataSource.includes('derived') ? 'derived' : dataSource.includes('policy') ? 'policy' : dataSource.includes('fnol') ? 'fnol' : 'user';
    const prefill = valueSource === 'policy'
      ? (fieldId.includes('policyholder_full_name')
          ? input.policyHolderName
          : fieldId.includes('contact_email')
            ? asString(proposer.email)
            : fieldId.includes('contact_phone')
              ? asString(proposer.phone)
              : fieldId.includes('registration')
                ? asString(input.quoteData.registrationNumber)
                : null)
      : null;
    return {
      fieldId,
      section,
      label,
      type: normalizeType(ui),
      mode,
      required,
      valueSource,
      prefill: prefill || null,
      options: normalizeType(ui) === 'select' ? parseOptionsFromFormat(asString(row['Options/Format'])) : undefined,
      visibility: asString(row['Incident Type Visibility'] || 'All'),
      validation: asString(row['Validation Rules']),
      riskSignals: asString(row['Fraud/Consistency Checks']),
    };
  }).filter((field) => Boolean(field.fieldId) && visibilityMatchesIncident(field.visibility || 'All', incidentType));

  return {
    version: input.version,
    status: 'SENT',
    sentAt: new Date().toISOString(),
    sentByUserId: input.sentByUserId || null,
    openedAt: null,
    completedAt: null,
    context: {
      incidentType,
      claimType,
      country,
      namedDrivers: input.namedDrivers,
    },
    fields,
    sourceSnapshot: {
      policyNumber: input.policyNumber,
      policyHolderName: input.policyHolderName,
    },
  };
}
