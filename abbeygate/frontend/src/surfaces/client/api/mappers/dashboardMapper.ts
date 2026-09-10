/**
 * Dashboard Mapper — CHAMPS DTO → VM Boundary
 *
 * This is the SINGLE point where raw API payloads (DTOs) are
 * transformed into normalized View Models (VMs).
 *
 * Rules:
 *   - This file is the ONLY place that touches DTO shapes
 *   - All normalization and null-coalescing happens HERE
 *   - Downstream (controller, views) never see DTO types
 *   - No React imports, no side effects
 */

import type {
    PolicyDTO,
    DocumentDTO,
    FeedEventDTO,
    DashboardBootstrapDTO,
    DashboardPolicyVM,
    DashboardVM,
    DocumentVM,
    ActivityItemVM,
    DriverVM,
    ExcessVM,
    PremiumRowVM,
    CoverageExcessRowVM,
    PolicyStatusVM,
    StatusTone,
    CurrencyCode,
} from '../../types/dashboard.contract';

import { buildCoverageExcessRows } from '@/src/modules/policies/model/coverageExcess';
import { getPolicyDocumentTypeLabel, humanizePolicyStatus } from '@/src/modules/policies/model/policyDisplayLabels';
import { isClientClaimFormVisible } from '@/src/modules/claims/model/claimFormPackage';
import { USE_POLICY_STATE } from '@/src/modules/policies/model/policyStateFlag';
import { asRecord } from '@/src/shared/lib/record';
import { ProductRegistry, joinPathValues, projectSummary } from '@/src/shared/lib/products';

// ─── Internal helpers (not exported) ───

function firstNonEmpty(values: unknown[]): string {
    for (const value of values) {
        const str = String(value || '').trim();
        if (str) return str;
    }
    return '';
}

function asNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asRecordMaybeJson(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        } catch {
            return {};
        }
    }
    return {};
}

const DASHBOARD_DISPLAY_CONFIG = {
    defaults: {
        fallbackCountry: 'Cyprus',
        kmsOverLabel: 'Over 15,000',
        kmsOverThreshold: 15000,
    },
    status: {
        inactiveKeywords: ['EXPIRED', 'CANCEL', 'DECLINED', 'VOID', 'LAPSED', 'TERMINATED'],
    },
} as const;

const PRE_BIND_STATUS_KEYWORDS = ['DRAFT', 'INTAKE', 'INFO_REQUIRED', 'REFERRAL', 'QUOTED', 'DECLINED'] as const;

// ─── Status helpers ───

function statusNorm(status: unknown): string {
    return String(status || '').toUpperCase().replace(/\s+/g, '_');
}

function policyStatusRaw(policy: PolicyDTO): string {
    return USE_POLICY_STATE ? String(policy.bo_status || policy.status || '') : String(policy.status || '');
}

function isPostBindStatus(status: unknown): boolean {
    const normalized = statusNorm(status);
    if (!normalized) return false;
    return !PRE_BIND_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/** Filter out pre-bind policies that clients should not see */
export function isClientVisiblePolicy(policy: PolicyDTO): boolean {
    return isPostBindStatus(policyStatusRaw(policy));
}

// ─── Date helpers ───

function policyStartDate(policy: PolicyDTO): string {
    const snapshot = asRecord(policy.stateSnapshot);
    const schedule = asRecord(snapshot.schedule);
    return String(
        policy.effectiveDate ||
        policy.inceptionDate ||
        policy.startDate ||
        policy.periodStart ||
        policy.start ||
        schedule.start_date ||
        '',
    ).trim();
}

function policyEndDate(policy: PolicyDTO): string {
    return String(policy.endDate || policy.expiryDate || policy.end || '').trim();
}

function policyRecencyTimestamp(policy: PolicyDTO): number {
    const candidates = [
        policyStartDate(policy),
        String(policy.issuedAt || '').trim(),
        String(policy.createdAt || '').trim(),
        String(policy.updatedAt || '').trim(),
    ];
    for (const candidate of candidates) {
        const ts = new Date(candidate).getTime();
        if (Number.isFinite(ts) && ts > 0) return ts;
    }
    return 0;
}

function isPastPolicy(policy: PolicyDTO): boolean {
    const status = statusNorm(policyStatusRaw(policy));
    const byStatus = status !== 'CANCELLATION_REQUESTED'
        && DASHBOARD_DISPLAY_CONFIG.status.inactiveKeywords.some((keyword) => status.includes(keyword));
    if (byStatus) return true;
    const endTs = new Date(policyEndDate(policy)).getTime();
    return Number.isFinite(endTs) && endTs < Date.now();
}

// ─── Key ───

function policyKey(p: PolicyDTO): string {
    return String(p.policyId || p.id || '');
}

function resolveProductManifest(policy: PolicyDTO) {
    return ProductRegistry.get(String(policy.productType || '').trim().toUpperCase());
}

function resolveProductLabel(policy: PolicyDTO): string {
    const manifest = resolveProductManifest(policy);
    return String(manifest?.displayName || 'Insurance').trim();
}

// ─── Vehicle & driver ───

function vehicleTitle(policy: PolicyDTO): string {
    const qd = asRecord(policy.quoteData);
    const manifest = resolveProductManifest(policy);
    if (manifest) {
        const summary = projectSummary(manifest, qd);
        if (summary.title) return summary.title;
    }
    const fallback = joinPathValues(qd, ['year', 'make', 'model']);
    return fallback || `${resolveProductLabel(policy)} Policy`;
}

function policyQuoteData(policy: PolicyDTO): Record<string, unknown> {
    const snapshot = asRecord(policy.stateSnapshot);
    const snapshotQuoteData = asRecord(snapshot.quoteData);
    const quoteData = asRecord(policy.quoteData);
    return { ...snapshotQuoteData, ...quoteData };
}

function vehicleRegistration(policy: PolicyDTO): string {
    const qd = policyQuoteData(policy);
    const vi = asRecord(policy.vehicleInfo);
    return firstNonEmpty([
        qd.registrationNumber, qd.regNumber, qd.licensePlate,
        vi.registrationNumber, vi.regNumber, vi.licensePlate,
    ]) || 'Registration unavailable';
}

function vehicleUseLabel(qd: Record<string, unknown>): string {
    const raw = firstNonEmpty([qd.vehicleUse, qd.useOfVehicle, qd.usageType]);
    if (!raw) return 'Private use';
    const normalized = raw.toUpperCase().replace(/[_-]+/g, ' ').trim();
    if (normalized === 'SDP') return 'Social, Domestic & Pleasure';
    if (normalized.includes('SOCIAL') && normalized.includes('DOMESTIC')) return 'Social, Domestic & Pleasure';
    return raw.replace(/_/g, ' ');
}

function parkingLabel(qd: Record<string, unknown>): string {
    const raw = firstNonEmpty([qd.parking, qd.parkingType, qd.overnightParking]);
    if (!raw) return 'Not declared';
    const normalized = raw.toUpperCase();
    if (normalized.includes('LOCKED') && normalized.includes('GARAGE')) return 'Locked garage';
    if (normalized.includes('GARAGE')) return 'Garage';
    if (normalized.includes('STREET')) return 'Street';
    if (normalized.includes('DRIVEWAY')) return 'Driveway';
    return raw.replace(/_/g, ' ');
}

function policyCountryLabel(qd: Record<string, unknown>): string {
    const proposer = asRecord(qd.proposer);
    const proposerAddress = asRecord(proposer.address);
    const country = firstNonEmpty([qd.countryOfRegistration, qd.registrationCountry, proposerAddress.country, proposer.domicileCountry]);
    return country || DASHBOARD_DISPLAY_CONFIG.defaults.fallbackCountry;
}

function kmsPerYearLabel(qd: Record<string, unknown>): string {
    const raw = String(qd.kmsPerYear || qd.annualMileage || '').trim();
    if (!raw) return '—';
    if (/over/i.test(raw)) return raw;
    const num = Number(raw.replace(/[^0-9]/g, ''));
    if (Number.isFinite(num) && num > 0) {
        if (num > DASHBOARD_DISPLAY_CONFIG.defaults.kmsOverThreshold) return DASHBOARD_DISPLAY_CONFIG.defaults.kmsOverLabel;
        return `${num.toLocaleString()}`;
    }
    return raw;
}

// ─── Drivers ───

function primaryDriverFromPolicy(policy: PolicyDTO, qd: Record<string, unknown>): { fullName: string; dob: string } {
    const holder = asRecord(policy.policyHolder);
    const holderId = asRecord(policy.policyHolderId);
    const proposer = asRecord(qd.proposer);
    const holderFirst = String(holder.firstName || holderId.firstName || '').trim();
    const holderLast = String(holder.lastName || holderId.lastName || '').trim();
    const holderName = String(holder.name || holderId.name || policy.insuredName || policy.name || '').trim();
    const qdName = [String(proposer.firstName || '').trim(), String(proposer.lastName || '').trim()].filter(Boolean).join(' ').trim();
    const fullName = [holderFirst, holderLast].filter(Boolean).join(' ').trim() || holderName || qdName;
    const dob = String(holder.dateOfBirth || holder.dob || holderId.dateOfBirth || holderId.dob || proposer.dateOfBirth || '').trim();
    return { fullName: fullName || 'Policy holder', dob };
}

function driversFromPolicy(policy: PolicyDTO): DriverVM[] {
    const qd = policyQuoteData(policy);
    const primary = primaryDriverFromPolicy(policy, qd);
    const additionalDriversRaw = Array.isArray(qd.additionalDrivers)
        ? qd.additionalDrivers
        : (Array.isArray(qd.namedDrivers) ? qd.namedDrivers : []);
    const additional: DriverVM[] = additionalDriversRaw
        .map((driver) => asRecord(driver))
        .map((driver) => ({
            fullName: [String(driver.firstName || '').trim(), String(driver.lastName || '').trim()].filter(Boolean).join(' ').trim(),
            dob: String(driver.dateOfBirth || driver.dob || '').trim(),
            licenseYears: String(driver.licenseYears ?? '').trim(),
            isPrimary: false,
        }))
        .filter((driver) => driver.fullName);

    return [
        { fullName: primary.fullName, dob: primary.dob, licenseYears: String(qd.licenseYears ?? '').trim(), isPrimary: true },
        ...additional,
    ];
}

// ─── Coverage ───

function primaryOptionFromPolicy(policy: PolicyDTO): Record<string, unknown> {
    return asRecord(activeQuoteResponse(policy).primaryOption);
}

function activeQuoteResponse(policy: PolicyDTO): Record<string, unknown> {
    const snapshot = asRecord(policy.stateSnapshot);
    const snapshotQuoteResponse = asRecord(snapshot.quoteResponse);
    const quoteResponse = asRecord(policy.quoteResponse);
    return Object.keys(snapshotQuoteResponse).length ? snapshotQuoteResponse : quoteResponse;
}

function selectedCoverageOptionCodes(policy: PolicyDTO): string[] {
    const snapshot = asRecord(policy.stateSnapshot);
    const coverageSelection = asRecord(snapshot.coverageSelection);
    const selectedOptions = asRecord(coverageSelection.selected);
    const legacySelectedOptions = asRecord(snapshot.selectedOptions);
    return Object.entries(Object.keys(selectedOptions).length ? selectedOptions : legacySelectedOptions)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([code]) => String(code).toUpperCase());
}

function coverageSummary(policy: PolicyDTO): string {
    const qd = policyQuoteData(policy);
    const manifest = resolveProductManifest(policy);
    if (manifest) {
        const primary = joinPathValues(qd, manifest.listColumns.coverage.primaryPaths, ' · ');
        const secondary = joinPathValues(qd, manifest.listColumns.coverage.secondaryPaths || [], ' · ');
        const manifestSummary = [primary, secondary].filter(Boolean).join(' · ');
        if (manifestSummary) return manifestSummary;
    }
    const vi = asRecord(policy.vehicleInfo);
    const primaryOption = primaryOptionFromPolicy(policy);
    const breakdown = asRecord(primaryOption.breakdown);
    const trace = Array.isArray(primaryOption.calculationTrace) ? primaryOption.calculationTrace : asRecord(primaryOption.calculationTrace).steps;
    const traceSteps = Array.isArray(trace) ? trace : [];

    const coverRequired = String(qd.coverRequired || vi.coverRequired || '').trim();
    const isComprehensive = coverRequired && coverRequired !== 'Third Party Liability';
    const selectedCodes = selectedCoverageOptionCodes(policy);
    const traceIds = traceSteps
        .map((step) => String(asRecord(step).id || '').toUpperCase())
        .filter(Boolean);

    const hasGlass = Boolean(
        qd.windscreenCover === true || qd.disableWindscreen === false ||
        Number(breakdown.windscreen || 0) > 0 ||
        selectedCodes.some((c) => c.includes('WINDSCREEN') || c.includes('GLASS')) ||
        traceIds.some((id) => id.includes('WINDSCREEN') || id.includes('GLASS')),
    );
    const hasRoadside = Boolean(
        qd.vipRoadside === true || qd.roadsideAssistance === true ||
        selectedCodes.some((c) => c.includes('ROADSIDE') || c.includes('BREAKDOWN')) ||
        traceIds.some((id) => id.includes('ROADSIDE') || id.includes('BREAKDOWN')),
    );

    const parts: string[] = [isComprehensive ? 'Comprehensive' : 'Third Party Liability'];
    if (hasGlass) parts.push('Glass');
    if (hasRoadside) parts.push('Roadside');
    return parts.join(' · ');
}

function coverageItems(policy: PolicyDTO): string[] {
    return coverageSummary(policy).split(' · ').map((item) => item.trim()).filter(Boolean);
}

function endorsementItems(policy: PolicyDTO): string[] {
    const primaryOption = primaryOptionFromPolicy(policy);
    const traceRaw = Array.isArray(primaryOption.calculationTrace)
        ? primaryOption.calculationTrace
        : asRecord(primaryOption.calculationTrace).steps;
    const traceSteps = Array.isArray(traceRaw) ? traceRaw.map((s) => asRecord(s)) : [];
    const names = traceSteps
        .filter((step) =>
            String(step.id || '').startsWith('endorsement.premium.')
            && String(step.id || '').trim().toUpperCase() !== 'ENDORSEMENT.PREMIUM.CV 24'
            && String(step.name || '').trim().toUpperCase() !== 'WINDSCREEN'
        )
        .map((step) => String(step.name || '').trim())
        .filter(Boolean);
    return Array.from(new Set(names));
}

// ─── Premium ───

function parseNumericExcess(value: unknown): number {
    const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
}

function excessData(policy: PolicyDTO, qd: Record<string, unknown>): ExcessVM {
    const primary = primaryOptionFromPolicy(policy);
    const compulsory = parseNumericExcess(primary.compulsoryExcess ?? qd.compulsoryExcess);
    const voluntary = parseNumericExcess(primary.voluntaryExcess ?? qd.voluntaryExcess ?? qd.requiredExcess);
    const total = parseNumericExcess(primary.totalExcess) || (compulsory + voluntary) || 0;
    return { total, compulsory, voluntary };
}

function additionalExcessRows(policy: PolicyDTO): PremiumRowVM[] {
    const snapshot = asRecord(policy.stateSnapshot);
    const fromApplied = Array.isArray(snapshot.appliedEndorsements) ? snapshot.appliedEndorsements : [];
    const fromPolicy = Array.isArray((policy as Record<string, unknown>).endorsements) ? ((policy as Record<string, unknown>).endorsements as unknown[]) : [];
    const source = [...fromApplied, ...fromPolicy];
    const rows = source
        .map((row) => asRecord(row))
        .map((row) => {
            const params = asRecord(row.params);
            const amount = Number(params.excess_amount_eur ?? params.additional_excess_eur ?? params.deductible_eur ?? 0);
            const label = firstNonEmpty([row.title, row.code, 'Endorsement excess']);
            return Number.isFinite(amount) && amount > 0 ? { label, amount } : null;
        })
        .filter((row): row is PremiumRowVM => Boolean(row));
    const deduped = new Map<string, PremiumRowVM>();
    rows.forEach((row) => deduped.set(`${row.label}-${row.amount}`, row));
    return Array.from(deduped.values());
}

function premiumBreakdown(policy: PolicyDTO): PremiumRowVM[] {
    const primaryOption = primaryOptionFromPolicy(policy);
    const cost = asRecord(primaryOption.costDetails);
    const breakdown = asRecord(primaryOption.breakdown);
    const subtotal = Number(cost.subtotalNetPremium || 0);
    const mifSurcharge = Number(cost.mifSurcharge ?? 0);
    const stamp = Number(cost.stampDuty ?? cost.policyFee ?? 0);
    const total = Number(cost.totalPremium ?? primaryOption.annualPremium ?? 0);
    const fromCost: PremiumRowVM[] = [
        { label: 'Net premium', amount: subtotal },
        { label: 'MIF surcharge', amount: mifSurcharge },
        { label: 'Stamp duty / fees', amount: stamp },
        { label: 'Total premium payable', amount: total },
    ].filter((row) => Number.isFinite(row.amount) && row.amount !== 0);
    if (fromCost.length > 0) return fromCost;
    const rows: Array<{ key: string; label: string }> = [
        { key: 'subtotalNetPremium', label: 'Net premium' },
        { key: 'mifSurcharge', label: 'MIF surcharge' },
        { key: 'stampDuty', label: 'Stamp duty / fees' },
        { key: 'totalPremium', label: 'Total premium payable' },
        { key: 'basePremium', label: 'Base premium' },
        { key: 'grossPremium', label: 'Gross premium' },
        { key: 'ncdDiscount', label: 'NCD discount' },
        { key: 'fees', label: 'Fees (rating)' },
    ];
    return rows
        .map(({ key, label }) => ({ label, amount: Number(breakdown[key] || 0) }))
        .filter((row) => Number.isFinite(row.amount) && row.amount !== 0);
}

function resolvePolicyPremium(policy: PolicyDTO): number {
    const primaryOption = primaryOptionFromPolicy(policy);
    const costDetails = asRecord(primaryOption.costDetails);
    const quoteResponse = asRecordMaybeJson(policy.quoteResponse);
    const quotePricing = asRecord(quoteResponse.pricing);
    const quotePrimary = asRecord(quoteResponse.primaryOption);
    const policyRecord = asRecordMaybeJson(policy);
    const riskTransactions = Array.isArray(policyRecord.riskTransactions) ? policyRecord.riskTransactions : [];
    const riskTxOrdered = [...riskTransactions].sort((a, b) => {
        const aRec = asRecordMaybeJson(a);
        const bRec = asRecordMaybeJson(b);
        const aTs = new Date(String(aRec.createdAt || '')).getTime();
        const bTs = new Date(String(bRec.createdAt || '')).getTime();
        const safeA = Number.isFinite(aTs) ? aTs : 0;
        const safeB = Number.isFinite(bTs) ? bTs : 0;
        return safeB - safeA;
    });
    const firstPositiveFromTxHistory = riskTxOrdered.reduce<number | null>((acc, tx) => {
        if (acc !== null) return acc;
        const txRec = asRecordMaybeJson(tx);
        const pricingFinal = asRecordMaybeJson(txRec.pricingFinal);
        const pricingQuote = asRecordMaybeJson(pricingFinal.quoteResponse);
        const pricingPrimary = asRecord(pricingQuote.primaryOption);
        const pricingCost = asRecord(pricingPrimary.costDetails);
        const premiumTxRows = Array.isArray(txRec.premiumTransactions) ? txRec.premiumTransactions : [];
        const premiumTxSum = premiumTxRows.reduce((sum, row) => {
            const rec = asRecordMaybeJson(row);
            const n = Number(rec.grossPremium ?? rec.premium ?? 0);
            return Number.isFinite(n) && n > 0 ? sum + n : sum;
        }, 0);
        const txCandidates = [
            asNumber(pricingFinal.total),
            asNumber(pricingFinal.premium),
            asNumber(pricingFinal.annualPremium),
            asNumber(pricingCost.totalPremium),
            asNumber(pricingPrimary.annualPremium),
            asNumber(premiumTxSum),
        ].filter((n): n is number => Number.isFinite(n));
        const txPositive = txCandidates.find((n) => n > 0);
        return typeof txPositive === 'number' ? txPositive : null;
    }, null);

    const candidates = [
        asNumber(costDetails.totalPremium),
        asNumber(costDetails.finalPremium),
        asNumber(primaryOption.annualPremium),
        asNumber(primaryOption.totalPremium),
        asNumber(policy.totalPremium),
        asNumber(policy.premium),
        asNumber(firstPositiveFromTxHistory),
        asNumber(quotePrimary.annualPremium),
        asNumber(quotePrimary.totalPremium),
        asNumber(quoteResponse.annualPremium),
        asNumber(quoteResponse.premium),
        asNumber(quotePricing.total),
        asNumber(quotePricing.finalPremium),
    ].filter((n): n is number => Number.isFinite(n));

    const firstPositive = candidates.find((n) => n > 0);
    if (typeof firstPositive === 'number') return firstPositive;
    const firstAny = candidates.find((n) => n >= 0);
    return typeof firstAny === 'number' ? firstAny : 0;
}

// ─── NCB ───

function ncbData(qd: Record<string, unknown>): { years: number; isProtected: boolean } {
    const years = asNumber(qd.ncbYears) ?? asNumber(qd.noClaimsBonusYears) ?? asNumber(qd.licenseYears) ?? 0;
    const isProtected = qd.protectNCB === true || qd.ncbProtected === true;
    return { years: Math.max(0, Math.floor(years)), isProtected };
}

// ─── Card status ───

function statusLabelFromData(policy: PolicyDTO): string {
    const raw = String(policyStatusRaw(policy) || '').trim();
    if (!raw) return 'Active';
    return typeof humanizePolicyStatus === 'function' ? humanizePolicyStatus(raw) : raw;
}

function cardStatusMeta(policy: PolicyDTO): PolicyStatusVM {
    const status = statusNorm(policyStatusRaw(policy));
    const start = policyStartDate(policy);
    const end = policyEndDate(policy);
    const now = Date.now();
    const startTs = new Date(start).getTime();
    const endTs = new Date(end).getTime();
    const cancelAt = String(policy.cancelledAt || policy.canceledAt || policy.cancellationDate || policy.updatedAt || '').trim();

    const isCanceled = status.includes('CANCEL');
    if (isCanceled) {
        return { title: 'Canceled', detail: `${start} - ${cancelAt || end}`, canAddDriver: false, tone: 'canceled' };
    }
    const isExpired = status === 'EXPIRED' || (Number.isFinite(endTs) && now > endTs);
    if (isExpired) {
        return { title: 'Expired', detail: `${start} - ${end}`, canAddDriver: false, tone: 'expired' };
    }
    const issuedNotActive = status === 'ISSUED' && Number.isFinite(startTs) && now < startTs;
    if (issuedNotActive) {
        return { title: 'Issued', detail: `Start date ${start}`, canAddDriver: true, tone: 'issued' };
    }
    const derivedTitle = statusLabelFromData(policy);
    const tone: StatusTone = status.includes('ISSUED') ? 'issued' : 'active';
    return { title: derivedTitle, detail: `Renews ${end}`, canAddDriver: true, tone };
}

// ─── Normalization helpers ───

function normalizeCurrency(value: unknown): CurrencyCode {
    const code = String(value || '').toUpperCase();
    if (code === 'USD' || code === 'GBP' || code === 'EUR') return code;
    return 'EUR';
}

// ═════════════════════════════════════════════
// PUBLIC MAPPERS — the only exported functions
// ═════════════════════════════════════════════

/** Map a single PolicyDTO → DashboardPolicyVM */
export function mapPolicyToVM(dto: PolicyDTO): DashboardPolicyVM {
    const qd = policyQuoteData(dto);
    const drivers = driversFromPolicy(dto);
    const coverItems = coverageItems(dto);
    const endorsements = endorsementItems(dto);
    const excess = excessData(dto, qd);
    const addlExcess = additionalExcessRows(dto);
    const currency = normalizeCurrency(dto.currency);

    const coverageExcessRows = buildCoverageExcessRows({
        coverages: coverItems,
        quoteData: qd,
        baseExcess: excess.total,
    });

    return {
        key: policyKey(dto),
        productType: String(dto.productType || '').trim().toUpperCase(),
        productLabel: resolveProductLabel(dto),
        vehicleTitle: vehicleTitle(dto),
        registration: vehicleRegistration(dto),
        policyNumber: String(dto.policyNumber || policyKey(dto) || '—'),
        coverType: firstNonEmpty([qd.coverRequired, coverItems[0]]) || resolveProductLabel(dto),
        coverageItems: coverItems,
        endorsementItems: endorsements,
        statusMeta: cardStatusMeta(dto),
        startDate: policyStartDate(dto),
        endDate: policyEndDate(dto),
        isPast: isPastPolicy(dto),
        currency,
        drivers,
        excess,
        coverageExcessRows: coverageExcessRows as CoverageExcessRowVM[],
        additionalExcessRows: addlExcess,
        ncb: ncbData(qd),
        premium: resolvePolicyPremium(dto),
        premiumRows: premiumBreakdown(dto),
        declaredValue: asNumber(qd.vehicleValue) ?? asNumber(qd.sumInsured) ?? 0,
        mileage: kmsPerYearLabel(qd),
        vehicleUse: vehicleUseLabel(qd),
        parking: parkingLabel(qd),
        country: policyCountryLabel(qd),
        licenseType: firstNonEmpty([qd.licenseType, 'Standard']),
        licenseYears: Math.max(0, Math.floor(asNumber(qd.licenseYears) ?? 0)),
        paymentMethodLabel: (() => {
            const cardLast4 = firstNonEmpty([qd.cardLast4, qd.paymentLast4, qd.last4]);
            const cardBrand = firstNonEmpty([qd.cardBrand, qd.paymentCardBrand, 'Card']);
            return cardLast4 ? `${cardBrand} •••• ${cardLast4}` : '';
        })(),
        paymentStatus: String(dto.paymentStatus || '').trim().toUpperCase(),
        outstandingBalance: Number(dto.outstandingBalance || 0),
    };
}

/** Map bootstrap DTO → sorted DashboardVM (filtering out non-client-visible policies) */
export function mapBootstrapToVM(dto: DashboardBootstrapDTO): DashboardVM {
    const visiblePolicies = dto.policies.filter(isClientVisiblePolicy);
    const sorted = [...visiblePolicies].sort((a, b) => policyRecencyTimestamp(b) - policyRecencyTimestamp(a));

    return {
        policies: sorted.map(mapPolicyToVM),
        claims: dto.claims.map((claim) => ({
            id: String(claim.id || ''),
            status: String(claim.status || ''),
            claimNumber: String(claim.claimNumber || claim.id || ''),
            policyId: String(claim.policyId || ''),
            reportedDate: String(claim.reportedDate || claim.createdAt || ''),
            hasClaimForm: isClientClaimFormVisible(claim.data),
        })),
    };
}

/** Map document DTOs → DocumentVM[] */
export function mapDocumentsToVM(docs: DocumentDTO[], authToken: string | null): DocumentVM[] {
    return docs.map((doc) => {
        const publicUrl = String(doc.publicUrl || '').trim();
        const storageUri = String(doc.storageUri || '').trim();
        let href = '';
        if (authToken && storageUri.startsWith('/api/documents/')) {
            // Authenticated portal: use the secure storage route. Public TTL links
            // expire shortly after issuance (410 in a new tab), and query-string
            // JWT auth on GET /api/documents/* is rejected server-side.
            href = storageUri;
        } else if (publicUrl) {
            href = publicUrl;
        } else {
            href = storageUri;
        }

        const type = String(doc.type || '');
        const typeLabel = getPolicyDocumentTypeLabel(type);

        return {
            id: String(doc.id || doc.filename || `${doc.type}-${doc.createdAt}`),
            type,
            typeLabel,
            filename: String(doc.filename || ''),
            href,
            createdAt: String(doc.createdAt || ''),
        };
    });
}

/** Map feed event DTOs → ActivityItemVM[] */
export function mapFeedEventsToVM(events: FeedEventDTO[]): ActivityItemVM[] {
    return events
        .map((event) => {
            const action = String(event.actionName || '').toUpperCase();
            const diff = asRecord(event.diff);
            const reason = firstNonEmpty([diff.reason, diff.reasonCode, diff.changeReason, diff.action]);

            let summary: { title: string; detail: string } | null = null;
            if (action === 'POLICY.ISSUED') summary = { title: 'Policy issued', detail: 'Your policy is now active.' };
            else if (action === 'ENDORSEMENT.CREATED' || action === 'ENDORSEMENT.DRAFT.CREATED') {
                summary = { title: 'Endorsement created', detail: reason ? `Reason: ${reason}` : 'A policy change was started.' };
            }
            else if (action === 'ENDORSEMENT.BOUND') summary = { title: 'Endorsement bound', detail: 'A policy change is ready to issue.' };
            else if (action === 'ENDORSEMENT.ISSUED') summary = { title: 'Endorsement issued', detail: reason ? `Reason: ${reason}` : 'A policy change was issued.' };
            else if (action === 'CANCELLATION.REQUESTED') {
                summary = { title: 'Cancellation requested', detail: reason ? `Reason: ${reason}` : 'A cancellation request was submitted.' };
            }
            else if (action === 'CANCELLATION.APPROVED') summary = { title: 'Cancellation approved', detail: 'The policy cancellation was approved.' };
            else if (action === 'CANCELLATION.REJECTED') summary = { title: 'Cancellation rejected', detail: reason ? `Reason: ${reason}` : 'The cancellation request was rejected.' };
            else if (action === 'CLAIM.SUBMITTED') summary = { title: 'First notice of loss submitted', detail: 'A claim/FNOL was submitted for this policy.' };

            if (!summary) return null;

            return {
                id: String(event.id || `${event.actionName}-${event.occurredAt}`),
                title: summary.title,
                detail: summary.detail,
                occurredAt: String(event.occurredAt || '').trim(),
            };
        })
        .filter((item): item is ActivityItemVM => Boolean(item));
}
