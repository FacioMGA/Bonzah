type UnknownRecord = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function valueAtPath(source: UnknownRecord, path: string): unknown {
  const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    const rec = current && typeof current === 'object' && !Array.isArray(current)
      ? (current as UnknownRecord)
      : {};
    current = rec[part];
  }
  return current;
}

function formatAnswer(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const values = value
      .map(formatAnswer)
      .filter((entry): entry is string => Boolean(entry));
    return values.length ? values.join(', ') : null;
  }
  return JSON.stringify(value);
}

function buildCustomerLink(args: {
  snapshot: UnknownRecord;
  policySnapshot: UnknownRecord;
  productType: unknown;
}): string | null {
  const customerFlow = args.snapshot.customerFlow && typeof args.snapshot.customerFlow === 'object'
    ? (args.snapshot.customerFlow as UnknownRecord)
    : {};
  const savedLink = String(customerFlow.quoteUrl || '').trim();
  const product = String(args.productType || '').trim().toLowerCase();
  if (savedLink) {
    if (product && !/[?&]product=/i.test(savedLink)) {
      const joiner = savedLink.includes('?') ? '&' : '?';
      return `${savedLink}${joiner}product=${encodeURIComponent(product)}`;
    }
    return savedLink;
  }

  const token = String(args.policySnapshot.publicSessionToken || '').trim();
  if (!token) return null;
  return product
    ? `/quote/${encodeURIComponent(token)}?product=${encodeURIComponent(product)}`
    : `/quote/${encodeURIComponent(token)}`;
}

function buildReferralSummary(args: {
  policySnapshot: UnknownRecord;
  quoteData: UnknownRecord;
  parseRecord: (value: unknown) => UnknownRecord;
}): UnknownRecord | null {
  const snapshot = args.parseRecord(args.parseRecord(args.policySnapshot.stateCurrent).snapshot);
  const quoteResponse = args.parseRecord(snapshot.quoteResponse);
  const analysis = args.parseRecord(snapshot.underwritingAnalysis ?? quoteResponse.underwritingAnalysis);
  const outcome = String(analysis.outcome || '').trim().toLowerCase();
  const lane = String(analysis.lane || '').trim().toLowerCase();
  const triggers = asArray(analysis.triggers)
    .map((trigger) => args.parseRecord(trigger))
    .filter((trigger) => String(trigger.code || trigger.message || '').trim());
  if (!triggers.length && outcome !== 'referral' && outcome !== 'decline') return null;

  const primaryTrigger = triggers[0] || {};
  const fields = Array.from(new Set(
    triggers.flatMap((trigger) =>
      asArray(trigger.fields)
        .map((field) => String(field || '').trim())
        .filter(Boolean)
    )
  ));

  return {
    outcome: outcome || null,
    lane: lane || null,
    triggerCount: Number.isFinite(Number(analysis.triggerCount)) ? Number(analysis.triggerCount) : triggers.length,
    reason: String(primaryTrigger.message || primaryTrigger.code || outcome || 'Referral required').trim(),
    explanation: String(primaryTrigger.explanation || '').trim() || null,
    triggers: triggers.slice(0, 5).map((trigger) => ({
      code: String(trigger.code || '').trim(),
      message: String(trigger.message || '').trim(),
      explanation: String(trigger.explanation || '').trim(),
      fields: asArray(trigger.fields).map((field) => String(field || '').trim()).filter(Boolean),
    })),
    fields: fields.slice(0, 8).map((field) => ({
      key: field,
      answer: formatAnswer(valueAtPath(args.quoteData, field)),
    })),
    clientLink: buildCustomerLink({
      snapshot,
      policySnapshot: args.policySnapshot,
      productType: args.policySnapshot.productType,
    }),
  };
}

// `spine/v2` Wave 5: this mapper no longer exposes `vehicleInfo`. The
// pre-Wave-5 shape sent both `vehicleInfo` (the legacy denormalized
// `Policy.vehicleInfo` Json column) AND `quoteData` (the canonical
// snapshot), and the frontend `policiesAdapter` derived
// `vehicleDisplay` from `vehicleInfo` while validation/pricing read
// `quoteData`. Two sources of truth for the same vehicle. The Json
// column on `Policy` itself is left in place as a frozen historical
// record but it is no longer fed into the read API.
export function mapPolicyListRows(args: {
  rows: UnknownRecord[];
  isCompact: boolean;
  parseRecord: (value: unknown) => Record<string, unknown>;
  usePolicyState: boolean;
}): UnknownRecord[] {
  return args.rows.map((row) => {
    const policy = args.parseRecord(row.policy);
    const policyHolder = args.parseRecord(policy.policyHolder);
    const quoteData = args.parseRecord(policy.quoteData);
    const policySnapshot = Object.keys(policy).length ? policy : {
      createdAt: row.updatedAt || null,
      inceptionDate: row.coverageStart || row.renewalDate || null,
      expiryDate: row.coverageEnd || row.renewalDate || null,
      productType: null,
      policyHolder: null,
    };
    const referralSummary = buildReferralSummary({
      policySnapshot,
      quoteData,
      parseRecord: args.parseRecord,
    });
    const base = {
      id: String(row.policyId),
      policyId: String(row.policyId),
      policyNumber: row.policyNumber,
      insuredName: row.insuredName,
      insuredDisplay: row.insuredDisplay || row.insuredName || null,
      vehicleDisplay: row.vehicleDisplay || null,
      policyholderDisplay: row.policyholderDisplay || null,
      policyholderEmail: row.policyholderEmail || null,
      policyholderPhone: row.policyholderPhone || null,
      status: args.usePolicyState ? (row.bo_status || row.status) : row.status,
      bo_status: row.bo_status || null,
      address: row.address,
      segment: row.segment,
      totalPremium: row.totalPremium,
      updatedAt: row.updatedAt,
      lastActivityAt: row.lastActivityAt || row.updatedAt,
      attentionScore: row.attentionScore ?? 0,
      attentionBucket: row.attentionBucket ?? 'NORMAL',
      hasOpenClaim: Boolean(row.hasOpenClaim),
      openClaimCount: Number(row.openClaimCount || 0),
      outstandingBalance: Number(row.outstandingBalance || 0),
      invoiceOverdue: Boolean(row.invoiceOverdue),
      cancellationPending: Boolean(row.cancellationPending),
      customerActionRequired: Boolean(row.customerActionRequired),
      paymentStatus: policySnapshot.paymentStatus ?? null,
      uwActionRequired: Boolean(row.uwActionRequired),
      complianceState: String(row.complianceState || 'PASS'),
      complianceProfile: String(row.complianceProfile || 'PRODUCTION_STRICT'),
      complianceReasons: Array.isArray(row.complianceReasons) ? row.complianceReasons : [],
      complianceCheckedAt: row.complianceCheckedAt || null,
      statusSortRank: args.usePolicyState
        ? Number(row.bo_statusSortRank ?? row.statusSortRank ?? 999)
        : Number(row.statusSortRank || 999),
      bo_statusSortRank: row.bo_statusSortRank === null || row.bo_statusSortRank === undefined ? null : Number(row.bo_statusSortRank),
      createdAt: policySnapshot.createdAt || null,
      startDate: row.coverageStart || policySnapshot.inceptionDate || null,
      endDate: row.coverageEnd || policySnapshot.expiryDate || null,
      renewalDate: row.renewalDate || policySnapshot.expiryDate || null,
      quoteExpiryDate: row.quoteExpiryDate || null,
      productType: policySnapshot.productType || null,
      referralSummary,
    };

    if (args.isCompact) {
      return {
        ...base,
        quoteData: policySnapshot.quoteData || null,
        policyHolder: Object.keys(policyHolder).length ? policyHolder : null,
      };
    }

    return {
      ...base,
      programId: policySnapshot.programId,
      binderId: policySnapshot.binderId,
      driverInfo: policySnapshot.driverInfo,
      quoteData: policySnapshot.quoteData,
      quoteResponse: policySnapshot.quoteResponse,
      stateSnapshot: args.parseRecord(policySnapshot.stateCurrent).snapshot,
      policyHolder: policySnapshot.policyHolder,
    };
  });
}
