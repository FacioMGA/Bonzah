import { normalizeProgramMbeProductConfig, resolveAppliedEndorsementsForQuote } from '../../../mbe/domain/programProduct.js';
import { MagicBRegistry } from '../../../mbe/domain/registry.js';
import { ProductRegistry } from '../../../policy/domain/ProductRegistry.js';
import { applyDeterministicBdxEnrichment } from './mapper.js';
import type {
  BdxCalculatedBreakdown,
  BdxGap,
  BdxMigrationCompliance,
  BdxRowDto,
  BdxRowEvaluation,
  BdxValidationContext,
} from './types.js';

type QuoteValidatorModule = typeof import('../../../quotes/app/validator.js');
type QuoteDataIssuanceValidatorModule = typeof import('../../../policy/domain/quoteDataIssuanceValidator.js');

const quoteValidatorModule: QuoteValidatorModule = await import('../../../quotes/app/validator.js');
// BDX import is intentionally a non-readiness consumer: it needs only
// the structured adapter verdict to build BDX gap rows, never an
// issue-readiness blocker. Routing it through the canonical
// `validateQuoteDataForIssuanceCanonical` keeps `evaluateIssueReadiness`
// the sole owner of readiness derivation
// (`docs/architecture/contracts/canonical-ownership.md`).
const quoteDataIssuanceValidatorModule: QuoteDataIssuanceValidatorModule = await import('../../../policy/domain/quoteDataIssuanceValidator.js');
// Migration-grade reconciliation tolerance. The 20% cap was set for fresh
// quote drift detection in normal BO operation; for BDX migration imports
// the customer's declared premium and our recomputed premium frequently
// differ by 20–50% (different binder version, different tax rules, the
// engine has evolved). Auto-adjusting up to 50% via UW loading/discount
// is the correct trade-off for migration: the row IS importable, the
// engine records the divergence as a structured UW adjustment, and the
// audit trail (`migrationCompliance.appliedUwAdjustment`) preserves both
// declared and recomputed values for the operator to review later.
// Drifts greater than 50% still hard-fail (genuine bad data).
const MAX_AUTO_RECONCILIATION_DELTA_PCT = 50;

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function absDelta(a: number, b: number): number {
  return round2(Math.abs((a || 0) - (b || 0)));
}

function buildGap(dto: BdxRowDto, category: BdxGap['category'], severity: BdxGap['severity'], message: string, rootCauseHint?: string): BdxGap {
  return {
    rowId: dto.sourceId,
    policyRef: dto.policyRef,
    category,
    severity,
    message,
    rootCauseHint,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function buildCalculatedBreakdown(dto: BdxRowDto, quoteResponse: Record<string, unknown>): BdxCalculatedBreakdown {
  const primary = asRecord(quoteResponse.primaryOption);
  const costDetails = asRecord(primary.costDetails || quoteResponse.costDetails);
  const subtotalNet = Number(costDetails.subtotalNetPremium ?? costDetails.totalPremium ?? primary.annualPremium ?? dto.declared.gross) || 0;
  const mif = Number(costDetails.mifSurcharge ?? 0) || 0;
  const stampDuty = Number(costDetails.stampDuty ?? 0) || 0;
  const policyFee = Number(costDetails.policyFee ?? primary.adminFee ?? 0) || 0;
  const tax = round2(mif + stampDuty);
  const total = round2(subtotalNet + tax + policyFee);
  const commissionRate = dto.declared.gross > 0 ? dto.declared.commission / dto.declared.gross : 0;
  const commission = round2(subtotalNet * commissionRate);
  return {
    gross: round2(subtotalNet),
    commission,
    tax: round2(tax),
    fees: round2(policyFee),
    net: round2(subtotalNet - commission),
    total: round2(total),
  };
}

async function rateProductQuote(args: {
  dto: BdxRowDto;
  quoteData: unknown;
  programMetadata: unknown;
  applied: Array<{ code: string; params?: Record<string, unknown> }>;
}): Promise<{
  quoteResponse: Record<string, unknown>;
  calculated: BdxCalculatedBreakdown;
}> {
  const productType = args.dto.productType || 'MOTOR';
  const adapter = ProductRegistry.getInstance().getAdapter(productType);
  if (!adapter) {
    throw new Error(`No product adapter for ${productType}`);
  }
  const response = await adapter.buildQuoteResponse(args.quoteData, args.programMetadata, { resolvedCoverageSet: null });
  const quoteResponse = response.quoteResponse || {};
  const costDetails = (quoteResponse.costDetails || quoteResponse['costDetails'] || {}) as Record<string, unknown>;
  const primaryOption = (quoteResponse.primaryOption || {}) as Record<string, unknown>;
  const primaryCostDetails = (primaryOption.costDetails || {}) as Record<string, unknown>;
  const gross = round2(Number(
    costDetails.totalPremium
    ?? costDetails.subtotalNetPremium
    ?? primaryCostDetails.totalPremium
    ?? primaryCostDetails.subtotalNetPremium
    ?? primaryOption.annualPremium
    ?? args.dto.declared.gross
  ) || args.dto.declared.gross);
  return {
    quoteResponse,
    calculated: {
      ...buildCalculatedBreakdown(args.dto, quoteResponse),
      gross,
      total: round2(Number(costDetails.totalPayable ?? primaryCostDetails.totalPayable ?? args.dto.declared.total) || args.dto.declared.total),
    },
  };
}

function resolveMigrationCompliance(args: {
  dto: BdxRowDto;
  calculated: BdxCalculatedBreakdown;
}): BdxMigrationCompliance {
  const grossDeltaAmount = round2(args.dto.declared.gross - args.calculated.gross);
  const grossBase = Math.max(Math.abs(args.calculated.gross), 0.01);
  const grossDeltaPct = round2(Math.abs(grossDeltaAmount) / grossBase * 100);
  const notes = [
    `Declared gross=${round2(args.dto.declared.gross)}`,
    `Calculated gross=${round2(args.calculated.gross)}`,
  ];
  const migrationCompliance: BdxMigrationCompliance = {
    state: 'PASS',
    reasonCodes: [],
    grossDeltaAmount,
    grossDeltaPct,
    thresholdPct: MAX_AUTO_RECONCILIATION_DELTA_PCT,
    notes,
  };
  if (grossDeltaPct <= 0 || Math.abs(grossDeltaAmount) < 0.01) return migrationCompliance;
  if (grossDeltaPct > MAX_AUTO_RECONCILIATION_DELTA_PCT) {
    migrationCompliance.state = 'FAIL';
    migrationCompliance.reasonCodes = ['BDX_RECONCILIATION_OVER_20_PCT'];
    migrationCompliance.notes = [
      ...notes,
      `Gross delta ${grossDeltaPct}% exceeds the automatic reconciliation threshold of ${MAX_AUTO_RECONCILIATION_DELTA_PCT}%.`,
    ];
    return migrationCompliance;
  }
  migrationCompliance.appliedUwAdjustment = {
    type: grossDeltaAmount >= 0 ? 'loading' : 'discount',
    mode: 'pct',
    value: grossDeltaPct,
    amount: grossDeltaAmount,
    reason: 'BDX import reconciliation adjustment',
  };
  migrationCompliance.notes = [
    ...notes,
    `Auto-applied ${migrationCompliance.appliedUwAdjustment.type} ${grossDeltaPct}% to reconcile imported premium.`,
  ];
  return migrationCompliance;
}

function applyMigrationUwAdjustment(args: {
  quoteData: Record<string, unknown>;
  migrationCompliance: BdxMigrationCompliance;
}): Record<string, unknown> {
  if (!args.migrationCompliance.appliedUwAdjustment) return { ...args.quoteData };
  const existing = Array.isArray(args.quoteData.uwAdjustments) ? args.quoteData.uwAdjustments : [];
  return {
    ...args.quoteData,
    uwAdjustments: [
      ...existing,
      {
        lineType: 'pricing',
        name: 'BDX reconciliation',
        type: args.migrationCompliance.appliedUwAdjustment.type,
        mode: args.migrationCompliance.appliedUwAdjustment.mode,
        value: args.migrationCompliance.appliedUwAdjustment.value,
        reason: args.migrationCompliance.appliedUwAdjustment.reason,
        reasonText: args.migrationCompliance.appliedUwAdjustment.reason,
        schedulePresentation: 'separate_line',
      },
    ],
  };
}

export function createValidationContext(overrides?: Partial<BdxValidationContext['tolerances']>): BdxValidationContext {
  return {
    allowedEntries: new Set(['NB', 'RNL', 'CAN', 'PAM', 'NB/COC', 'ADJ', 'FIVA-PAM', 'NTU']),
    allowedCover: new Set(['Comp', 'Tpo']),
    allowedUse: new Set(['SDP', 'Class 1', 'Class 2', 'Class 3']),
    allowedDrivers: new Set(['Named Drivers Only', 'Any Driver Over 25', 'Policy Holder']),
    // BDX import currently validates against the motor catalog only (historical
    // BDX rows are motor). Broaden when we ingest Home/Travel bordereaux.
    knownEndorsementCodes: new Set(MagicBRegistry.motorOnly().getAll().map((x) => String(x.code || '').trim()).filter(Boolean)),
    tolerances: {
      gross: 400,
      commission: 150,
      tax: 20,
      fees: 10,
      net: 300,
      total: 400,
      ...(overrides || {}),
    },
  };
}

export function runStructuralValidation(dto: BdxRowDto, ctx: BdxValidationContext): BdxGap[] {
  const gaps: BdxGap[] = [];
  if (!dto.policyRef) gaps.push(buildGap(dto, 'STRUCTURAL', 'Critical', 'Missing policy reference', 'BDX row cannot be mapped to a policy identity.'));
  if (!dto.inceptionDate || !dto.expiryDate) gaps.push(buildGap(dto, 'STRUCTURAL', 'Critical', 'Missing inception/expiry date', 'Lifecycle dates are required for policy reconstruction.'));
  if (dto.inceptionDate && dto.expiryDate && new Date(dto.expiryDate) <= new Date(dto.inceptionDate)) {
    gaps.push(buildGap(dto, 'STRUCTURAL', 'Critical', 'Expiry date is not after inception date', 'Invalid contract period.'));
  }
  if (!ctx.allowedEntries.has(dto.entry)) gaps.push(buildGap(dto, 'STRUCTURAL', 'Critical', `Unsupported entry type '${dto.entry || 'EMPTY'}'`, 'Transaction mapping is not defined for this entry.'));
  if (dto.productType && dto.productType !== 'MOTOR') return gaps;
  if (!ctx.allowedCover.has(dto.cover)) gaps.push(buildGap(dto, 'STRUCTURAL', 'Critical', `Unsupported cover '${dto.cover || 'EMPTY'}'`, 'Cover map currently supports Comp/Tpo only.'));
  if (!ctx.allowedUse.has(dto.use)) gaps.push(buildGap(dto, 'STRUCTURAL', 'Critical', `Unexpected vehicle use '${dto.use || 'EMPTY'}' — fix upstream; SDP fallback is no longer accepted.`, 'BDX_USE_UNSUPPORTED'));
  if (!ctx.allowedDrivers.has(dto.drivers)) gaps.push(buildGap(dto, 'STRUCTURAL', 'Critical', `Unexpected drivers mode '${dto.drivers || 'EMPTY'}' — fix upstream; policy-holder-only fallback is no longer accepted.`, 'BDX_DRIVERS_UNSUPPORTED'));
  return gaps;
}

export function runCompletenessValidation(dto: BdxRowDto): BdxGap[] {
  const gaps: BdxGap[] = [];
  if (dto.productType && dto.productType !== 'MOTOR') {
    const required = [
      ['policyRef', dto.policyRef],
      ['insured', dto.insured],
      ['inceptionDate', dto.inceptionDate],
      ['expiryDate', dto.expiryDate],
      ['grossPremium', dto.grossPremium],
      ['premiumPayable', dto.premiumPayable],
      ['commission', dto.commission],
      ['payableToArb', dto.payableToArb],
    ] as const;
    required.forEach(([k, v]) => {
      if (v === null || v === undefined || String(v).trim() === '') {
        gaps.push(buildGap(dto, 'COMPLETENESS', 'Critical', `Missing required ${dto.productType} import field '${k}'`, 'Row is incomplete for deterministic processing.'));
      }
    });
    return gaps;
  }
  // The full required-field list — but only base-business rows (NB/NB-COC)
  // need risk + rating fields populated. Mid-term rows like CAN
  // (cancellation), PAM (premium adjustment), ADJ, FIVA-PAM, NTU legitimately
  // arrive with blank or 0 premium columns because the BDX cell carries a
  // shared formula that nets to zero (refund / adjustment line). Pre-
  // `spine/v2` Wave 5 these rows were imported as RiskTransaction
  // endorsements against the existing policy; the same chain is still in
  // place inside the orchestrator (`replayEndorsementRow`), but the
  // overly-strict completeness gate was wrongly flagging them. Restore the
  // disposition-aware split: base business gets the full list, endorsement
  // rows get only identity + lifecycle.
  const isBaseBusiness = dto.entry === 'NB' || dto.entry === 'NB/COC' || dto.entry === 'RNL';
  const baseRequired = [
    ['dateOfBirth', dto.dateOfBirth],
    ['make', dto.make],
    ['model', dto.model],
    ['engineSize', dto.engineSize],
    ['vehicleValue', dto.vehicleValue],
    ['vehicleYear', dto.vehicleYear],
    ['registration', dto.registration],
    ['excess', dto.excess],
    ['grossPremium', dto.grossPremium],
    ['premiumPayable', dto.premiumPayable],
    ['commission', dto.commission],
    ['payableToArb', dto.payableToArb],
  ] as const;
  const endorsementRequired = [
    ['inceptionDate', dto.inceptionDate],
    ['expiryDate', dto.expiryDate],
  ] as const;
  const required = isBaseBusiness ? baseRequired : endorsementRequired;
  required.forEach(([k, v]) => {
    if (v === null || v === undefined || String(v).trim() === '') {
      gaps.push(buildGap(dto, 'COMPLETENESS', 'Critical', `Missing required rating/reconciliation field '${k}'`, 'Row is incomplete for deterministic processing.'));
    }
  });
  if (dto.parsedEndorsements.length === 0) {
    gaps.push(buildGap(dto, 'COMPLETENESS', 'Informational', 'No endorsements declared on row'));
  }
  return gaps;
}

export async function runCalculabilityValidation(args: {
  dto: BdxRowDto;
  quoteData: unknown;
  programMetadata: unknown;
}): Promise< {
  gaps: BdxGap[];
  calculated: BdxCalculatedBreakdown | null;
  normalizedQuoteData?: Record<string, unknown>;
  appliedEndorsements?: Array<{ code: string; params?: Record<string, unknown> }>;
  migrationCompliance?: BdxMigrationCompliance;
  enrichment?: {
    profile: string;
    version: string;
    filledFields: string[];
    fieldSources?: Record<string, 'bdx' | 'derived' | 'default'>;
  };
}> {
  const { dto, quoteData, programMetadata } = args;
  const productType = dto.productType || 'MOTOR';
  const gaps: BdxGap[] = [];
  const quoteDataRecord = asRecord(quoteData);
  const enrichment = productType === 'MOTOR'
    ? applyDeterministicBdxEnrichment(quoteData)
    : {
        quoteData: quoteDataRecord,
        profile: `BDX_CONTRACT_PROFILE_${productType}`,
        version: 'v2',
        filledFields: [] as string[],
        fieldSources: Object.fromEntries(
          Object.keys(quoteDataRecord).map((key) => [key, 'bdx' as const])
        ),
      };
  const quoteValidation = quoteValidatorModule.validateDraftQuote({
    quoteData: enrichment.quoteData,
    step: 'bdx-import',
    mode: 'issuance',
    productType,
  });
  if (!quoteValidation.valid) {
    gaps.push(
      buildGap(
        dto,
        'CALCULABILITY',
        'Critical',
        'Quote data failed canonical validation',
        quoteValidation.schemaIssues.map((x) => `${x.path}: ${x.message}`).slice(0, 3).join(' | ')
      )
    );
    return {
      gaps,
      calculated: null,
      enrichment: {
        profile: enrichment.profile,
        version: enrichment.version,
        filledFields: enrichment.filledFields,
        fieldSources: enrichment.fieldSources,
      },
    };
  }

  const cfg = normalizeProgramMbeProductConfig(programMetadata, {
    productType,
    programCode: `abbeygate_${productType.toLowerCase()}`,
  });
  const selectedOptions = dto.parsedEndorsements.reduce<Record<string, boolean>>((acc, code) => {
    acc[code] = true;
    return acc;
  }, {});
  const applied = resolveAppliedEndorsementsForQuote({
    quoteData: quoteValidation.normalizedQuoteData,
    cfg,
    selectedOptions,
  });

  const unresolved = dto.parsedEndorsements.filter((x) => !applied.some((a) => a.code === x));
  const bdxCatalog = MagicBRegistry.forProduct(productType);
  unresolved.forEach((code) => {
    const isKnown = Boolean(bdxCatalog.get(code));
    gaps.push(
      buildGap(
        dto,
        isKnown ? 'DOMAIN' : 'MAPPING',
        'Warning',
        `Endorsement '${code}' could not be applied`,
        isKnown ? 'Failed prerequisites for this risk' : 'Code not found in endorsement registry'
      )
    );
  });

  // Per-row pricing failure must not abort the whole BDX job — wrap the
  // rate call so a missing-required-field throw (e.g. motor engine size
  // missing after the fail-closed pricing change) surfaces as a row-level
  // CALCULABILITY gap and the loop continues for every other row.
  let initialRating: Awaited<ReturnType<typeof rateProductQuote>>;
  try {
    initialRating = await rateProductQuote({
      dto,
      quoteData: quoteValidation.normalizedQuoteData,
      programMetadata,
      applied,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    gaps.push(buildGap(dto, 'CALCULABILITY', 'Critical', 'Rating engine failed for row', message));
    return {
      gaps,
      calculated: null,
      enrichment: {
        profile: enrichment.profile,
        version: enrichment.version,
        filledFields: enrichment.filledFields,
        fieldSources: enrichment.fieldSources,
      },
    };
  }
  const migrationCompliance = resolveMigrationCompliance({
    dto,
    calculated: initialRating.calculated,
  });
  const normalizedQuoteData = migrationCompliance.appliedUwAdjustment
    ? applyMigrationUwAdjustment({
        quoteData: asRecord(quoteValidation.normalizedQuoteData),
        migrationCompliance,
      })
    : quoteValidation.normalizedQuoteData;
  let finalRating: typeof initialRating;
  if (migrationCompliance.appliedUwAdjustment) {
    try {
      finalRating = await rateProductQuote({ dto, quoteData: normalizedQuoteData, programMetadata, applied });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      gaps.push(buildGap(dto, 'CALCULABILITY', 'Critical', 'Rating engine failed after UW adjustment', message));
      return {
        gaps,
        calculated: null,
        enrichment: {
          profile: enrichment.profile,
          version: enrichment.version,
          filledFields: enrichment.filledFields,
          fieldSources: enrichment.fieldSources,
        },
      };
    }
  } else {
    finalRating = initialRating;
  }

  const warnings = finalRating.quoteResponse.warnings;
  if (String(finalRating.quoteResponse.status || '').toLowerCase() === 'declined') {
    gaps.push(buildGap(dto, 'CALCULABILITY', 'Warning', 'Rating engine declined risk', Array.isArray(warnings) ? warnings.map(String).join(' | ') : ''));
  }
  const issuanceValidation = await quoteDataIssuanceValidatorModule
    .validateQuoteDataForIssuanceCanonical(normalizedQuoteData, productType)
    .catch((error: unknown) => {
      // The canonical validator throws a typed error for unknown /
      // missing product types. BDX gaps degrade gracefully — surface
      // the failure as a Critical gap rather than aborting the row.
      const code = error instanceof quoteDataIssuanceValidatorModule.QuoteDataIssuanceValidationError
        ? error.code
        : 'UNKNOWN';
      const message = error instanceof Error ? error.message : String(error);
      gaps.push(buildGap(dto, 'DOMAIN', 'Critical', 'Issue readiness gate failed for import', JSON.stringify({
        missingFields: [],
        blockers: [code],
        schemaIssuePaths: [],
        schemaIssues: [],
        error: message,
      })));
      return null;
    });
  if (issuanceValidation && !issuanceValidation.valid) {
    const schemaIssues = issuanceValidation.schemaIssues;
    const schemaIssuePaths = Array.from(new Set(schemaIssues
      .map((issue) => issue.path || issue.slug)
      .map((pathValue) => String(pathValue || '').trim())
      .filter(Boolean)));
    const blockerCodes: string[] = [];
    if (schemaIssues.length > 0) blockerCodes.push('QUOTE_DATA_INVALID');
    if (issuanceValidation.missingForIssuedPack.length > 0) blockerCodes.push('DOCUMENT_FIELDS_MISSING');
    if (issuanceValidation.conditionalRequirements.some((x) => (x.severity || 'BLOCK') === 'BLOCK')) {
      blockerCodes.push('CONDITIONAL_REQUIREMENTS_UNMET');
    }
    gaps.push(buildGap(dto, 'DOMAIN', 'Critical', 'Issue readiness gate failed for import', JSON.stringify({
      missingFields: issuanceValidation.missingForIssuedPack.map((x) => x.slug),
      blockers: blockerCodes,
      schemaIssuePaths,
      schemaIssues: schemaIssues.slice(0, 10),
    })));
  }
  return {
    gaps,
    calculated: finalRating.calculated,
    normalizedQuoteData: { ...normalizedQuoteData },
    appliedEndorsements: applied,
    migrationCompliance,
    enrichment: {
      profile: enrichment.profile,
      version: enrichment.version,
      filledFields: enrichment.filledFields,
      fieldSources: enrichment.fieldSources,
    },
  };
}

export function runReconciliationValidation(
  dto: BdxRowDto,
  calculated: BdxCalculatedBreakdown,
  ctx: BdxValidationContext
): { gaps: BdxGap[]; deltas: BdxCalculatedBreakdown } {
  const deltas: BdxCalculatedBreakdown = {
    gross: absDelta(dto.declared.gross, calculated.gross),
    commission: absDelta(dto.declared.commission, calculated.commission),
    tax: absDelta(dto.declared.tax, calculated.tax),
    fees: absDelta(dto.declared.fees, calculated.fees),
    net: absDelta(dto.declared.net, calculated.net),
    total: absDelta(dto.declared.total, calculated.total),
  };
  const gaps: BdxGap[] = [];
  const keys: Array<keyof BdxCalculatedBreakdown> = ['gross', 'commission', 'tax', 'fees', 'net', 'total'];
  keys.forEach((k) => {
    if (deltas[k] > ctx.tolerances[k]) {
      gaps.push(
        buildGap(
          dto,
          'RECONCILIATION',
          'Warning',
          `Reconciliation mismatch on ${k}: delta ${deltas[k]} > tolerance ${ctx.tolerances[k]}`,
          `Declared=${dto.declared[k]}, Calculated=${calculated[k]}`
        )
      );
    }
  });
  return { gaps, deltas };
}

export function classifyEvaluation(evalResult: Omit<BdxRowEvaluation, 'result'>): BdxRowEvaluation['result'] {
  const hasCritical = evalResult.gaps.some((x) => x.severity === 'Critical');
  if (hasCritical) return 'FAIL';
  // RECONCILIATION-Warning gaps are not a hard failure when the migration
  // auto-adjustment lane handled the drift (state === 'PASS' and an
  // appliedUwAdjustment was recorded — the row can be imported with the
  // engine's recomputed premium plus the recorded loading/discount).
  // Without this carve-out, the existing 20%-tolerance auto-adjust
  // mechanism is dead code because any per-row reconciliation drift kills
  // the import. Non-RECONCILIATION warnings still gate the row to FAIL.
  const compliance = evalResult.migrationCompliance;
  const autoAdjusted = compliance?.state === 'PASS' && Boolean(compliance?.appliedUwAdjustment);
  const hasNonReconciliationWarning = evalResult.gaps.some(
    (x) => x.severity === 'Warning' && x.category !== 'RECONCILIATION',
  );
  if (hasNonReconciliationWarning) return 'FAIL';
  const hasReconciliationWarning = evalResult.gaps.some(
    (x) => x.severity === 'Warning' && x.category === 'RECONCILIATION',
  );
  const reconciliationWarnings = evalResult.gaps.filter(
    (x) => x.severity === 'Warning' && x.category === 'RECONCILIATION',
  );
  const feeOnlyReconcilesToTotal = reconciliationWarnings.length > 0
    && reconciliationWarnings.every((x) => /on fees:/.test(x.message))
    && (evalResult.deltas?.total ?? Number.POSITIVE_INFINITY) <= 0.01;
  if (hasReconciliationWarning && !autoAdjusted && !feeOnlyReconcilesToTotal) return 'FAIL';
  return 'PASS';
}
