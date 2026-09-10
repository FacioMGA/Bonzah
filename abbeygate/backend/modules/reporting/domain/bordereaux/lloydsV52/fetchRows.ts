// Lloyd's CRS v5.2 row fetcher.
//
// Lloyd's monthly reporting lane (user-operated): builds CRS v5.2 rows
// for Risk / Premium / Claims streams by joining the period repository
// state with the per-product column tables.

import {
  fetchBinder,
  fetchClaimsForBinderAndProduct,
  fetchPoliciesForPeriod,
  fetchPremiumTransactionsForPeriod,
  fetchRiskTransactionsForPeriod,
  getOrCreatePeriod,
} from '../../../app/bordereauxRepository.js';
import { resolveBinderProductReporting } from '../../../../policy/app/binders/binderAuthority.js';
import { parseRecord } from '../../../../../platform/json/parseRecord.js';
import {
  buildClaimWorksheetProjection,
  periodFinancialProjection,
} from '../../../../claims/domain/worksheetProjection.js';
import {
  buildSelectedProductRow,
  getColumnsForStream,
  getDefaultHeaders,
  normalizeProductType,
} from './columns.js';
import { asRecord, maybeRecord, toISODate } from './internal/helpers.js';
import { BdxExportPreflightError, type BordereauxStream } from './types.js';

type UnknownRecord = Record<string, unknown>;

export async function fetchLloydsV52BordereauxRows(args: {
  binderId: string;
  year: number;
  month: number;
  stream: BordereauxStream;
  /**
   * Product code to segment the report by. Required as of `spine/v2`
   * Wave 5 — the prior optional shape with a `productCode || 'MOTOR'`
   * fallback in `fetchPoliciesForPeriod` was a fail-open. Callers
   * (`bordereauxRouter`, `XLSX.GENERATE_BORDEREAUX_V52`) now pass it
   * explicitly so a missing tag stops the export instead of silently
   * producing motor-shaped rows.
   */
  productCode: string;
  financialReportingType?: 'TRANSACTIONAL' | 'RESTATEMENT';
  signConvention?: 'POSITIVE' | 'NEGATIVE';
}) {
  const { binderId, year, month, stream } = args;
  const productCode = String(args.productCode || '').trim().toUpperCase();
  if (!productCode) {
    throw new Error('fetchLloydsV52BordereauxRows: productCode is required');
  }
  normalizeProductType(productCode);
  const financialReportingType = args.financialReportingType || 'RESTATEMENT';
  const signConvention = args.signConvention || 'POSITIVE';
  const preflightBinder = await fetchBinder(binderId);
  if (!preflightBinder) {
    throw new BdxExportPreflightError(
      'BDX_BINDER_NOT_FOUND',
      `Binder ${binderId} was not found for the current tenant.`,
      400,
    );
  }

  /**
   * Per-(binder, product) Lloyd's reporting codes. Sourced exclusively from
   * the BinderProductAuthority row (ADR-0019). This patches the binder
   * record we pass into `buildRow` so downstream CRS column resolvers
   * (`crsV52Motor.ts`) pick up the authority-resolved class-of-business
   * without knowing about the new table. If the authority row is missing,
   * `resolveBinderProductReporting` throws and the export fails closed —
   * which is the right outcome rather than emitting a synthesised COB.
   */
  const reporting = await resolveBinderProductReporting({ binderId, productCode });
  const period = await getOrCreatePeriod(binderId, year, month);

  const patchBinderWithAuthority = (b: UnknownRecord | undefined): UnknownRecord | undefined => {
    if (!b || !reporting) return b;
    const cfg = asRecord(b.config);
    const reportingCfg = asRecord(cfg.reporting);
    return {
      ...b,
      config: {
        ...cfg,
        reporting: { ...reportingCfg, classOfBusiness: reporting.classOfBusiness, riskCode: reporting.riskCode },
      },
    };
  };

  if (stream === 'risk') {
    const riskColumns = getColumnsForStream('risk', productCode);
    const [binderRaw, txns] = await Promise.all([
      fetchBinder(binderId),
      fetchRiskTransactionsForPeriod(binderId, period, productCode),
    ]);
    const binder = patchBinderWithAuthority(maybeRecord(binderRaw));

    if (txns.length === 0) {
      const policies = await fetchPoliciesForPeriod(binderId, period, productCode);

      const rows = policies.map((p: Record<string, unknown>) => {
        const pRec = asRecord(p);
        const quoteData = parseRecord(pRec.quoteData);
        const quoteResponse = parseRecord(pRec.quoteResponse);
        const row = buildSelectedProductRow(riskColumns, {
          policy: pRec,
          policyHolder: asRecord(pRec.policyHolder),
          binder: patchBinderWithAuthority(maybeRecord(pRec.binder)) || binder,
          quoteData,
          quoteResponse,
        });
        row['CR0001 Reporting Period Start Date'] = toISODate(period.startDate);
        row['CR0002 Reporting Period End Date'] = toISODate(period.endDate);
        if (!row['CR0010 Year of Account']) row['CR0010 Year of Account'] = year;
        return row;
      });
      return { rows, defaultHeaders: getDefaultHeaders('risk', productCode) };
    }

    const rows = txns.map((t: Record<string, unknown>) => {
      const tRec = asRecord(t);
      const policyRec = asRecord(tRec.policy);
      const quoteData = parseRecord(policyRec.quoteData);
      const quoteResponse = parseRecord(policyRec.quoteResponse);
      const row = buildSelectedProductRow(riskColumns, {
        policy: policyRec,
        policyHolder: asRecord(policyRec.policyHolder),
        binder: patchBinderWithAuthority(maybeRecord(policyRec.binder)) || binder,
        riskTransaction: tRec,
        quoteData,
        quoteResponse,
      });
      row['CR0001 Reporting Period Start Date'] = toISODate(period.startDate);
      row['CR0002 Reporting Period End Date'] = toISODate(period.endDate);
      if (!row['CR0010 Year of Account']) row['CR0010 Year of Account'] = year;
      return row;
    });
    return { rows, defaultHeaders: getDefaultHeaders('risk', productCode) };
  }

  if (stream === 'claims') {
    const claimsColumns = getColumnsForStream('claims', productCode);
    const [binderRaw, claims] = await Promise.all([
      fetchBinder(binderId),
      fetchClaimsForBinderAndProduct(binderId, productCode),
    ]);
    const binder = patchBinderWithAuthority(maybeRecord(binderRaw));
    const sign = signConvention === 'NEGATIVE' ? -1 : 1;
    const rows = claims.map((claim: Record<string, unknown>) => {
      const claimRec = asRecord(claim);
      const claimData = parseRecord(claimRec.data);
      const claimEvents = Array.isArray(claimRec.events) ? claimRec.events as Array<{ id: string; eventType: string; occurredAt: Date; payload: unknown; actorType?: string | null; actorId?: string | null; actorName?: string | null }> : [];
      const projection = buildClaimWorksheetProjection({
        claimId: String(claimRec.id || ''),
        claimReference: String(claimRec.claimNumber || ''),
        certificateReference: String(claimData.cr0029_certificate_reference || ''),
        events: claimEvents,
        reportPeriodEnd: period.endDate,
      });
      const financials = periodFinancialProjection({
        events: claimEvents,
        startDate: period.startDate,
        endDate: period.endDate,
      });
      const claimFinancials = {
        ...financials,
        paidThisPeriodIndemnity: sign * financials.paidThisPeriodIndemnity,
        paidThisPeriodFees: sign * financials.paidThisPeriodFees,
        previouslyPaidIndemnity: sign * financials.previouslyPaidIndemnity,
        previouslyPaidFees: sign * financials.previouslyPaidFees,
        reserveIndemnityAtEnd: sign * financials.reserveIndemnityAtEnd,
        reserveFeesAtEnd: sign * financials.reserveFeesAtEnd,
        totalIncurredIndemnity: sign * financials.totalIncurredIndemnity,
        totalIncurredFees: sign * financials.totalIncurredFees,
        totalIncurredOverall: sign * financials.totalIncurredOverall,
        recoveriesReceivedToDate: sign * financials.recoveriesReceivedToDate,
        recoveriesExpectedAtEnd: sign * financials.recoveriesExpectedAtEnd,
      };
      const row = buildSelectedProductRow(claimsColumns, {
        binder: patchBinderWithAuthority(maybeRecord(asRecord(claimRec.policy).binder)) || binder,
        policy: asRecord(claimRec.policy),
        policyHolder: asRecord(asRecord(claimRec.policy).policyHolder),
        claim: {
          ...claimData,
          cr0029_certificate_reference: claimRec.certificateReference || claimData.cr0029_certificate_reference,
          cr0109_original_currency: claimRec.originalCurrency || claimData.cr0109_original_currency,
          cr0116_loss_country: claimRec.lossCountry || claimData.cr0116_loss_country,
          cr0117_cause_of_loss_code: claimRec.causeOfLossCode || claimData.cr0117_cause_of_loss_code,
          cr0118_loss_description: claimRec.lossDescription || claimData.cr0118_loss_description,
          cr0119_date_of_loss_from: claimRec.dateOfLossFrom
            ? toISODate(claimRec.dateOfLossFrom as Date | string | null | undefined)
            : claimData.cr0119_date_of_loss_from,
          cr0120_date_of_loss_to: claimRec.dateOfLossTo
            ? toISODate(claimRec.dateOfLossTo as Date | string | null | undefined)
            : claimData.cr0120_date_of_loss_to,
          claimNumber: claimRec.claimNumber,
          closedAt: projection.closedAt || '',
          reopenedAt: projection.reopenedAt || '',
          deniedAt: projection.deniedAt || '',
          denialReason: projection.denialReason || '',
          withdrawnAt: projection.withdrawnAt || '',
        },
        status: projection.status,
        referredToUw: projection.cr0106ReferredToUnderwriters,
        denial: projection.cr0107Denial,
        financials: claimFinancials,
      });
      row['CR0001 Reporting Period Start'] = toISODate(period.startDate);
      row['CR0002 Reporting Period End'] = toISODate(period.endDate);
      if (financialReportingType === 'TRANSACTIONAL') {
        row['CR0128 Previously Paid Indemnity'] = 0;
        row['CR0129 Previously Paid Fees'] = 0;
      }
      return row;
    });
    return { rows, defaultHeaders: getDefaultHeaders('claims', productCode) };
  }

  // premium
  const premiumColumns = getColumnsForStream('premium', productCode);
  const [binderRaw, txns] = await Promise.all([
    fetchBinder(binderId),
    fetchPremiumTransactionsForPeriod(binderId, period, productCode),
  ]);
  const binder = patchBinderWithAuthority(maybeRecord(binderRaw));

  const rows = txns.map((p: Record<string, unknown>) => {
    const pRec = asRecord(p);
    const riskTx = asRecord(pRec.riskTransaction);
    const policy = asRecord(riskTx.policy);
    const quoteResponse = parseRecord(policy.quoteResponse);
    const row = buildSelectedProductRow(premiumColumns, {
      policy,
      policyHolder: asRecord(policy.policyHolder),
      binder: patchBinderWithAuthority(maybeRecord(policy.binder)) || binder,
      premiumTransaction: pRec,
      riskTransaction: riskTx,
      quoteResponse,
    });
    row['CR0001 Reporting Period Start Date'] = toISODate(period.startDate);
    row['CR0002 Reporting Period End Date'] = toISODate(period.endDate);
    if (!row['CR0010 Year of Account']) row['CR0010 Year of Account'] = year;
    return row;
  });
  return { rows, defaultHeaders: getDefaultHeaders('premium', productCode) };
}
