import crypto from 'node:crypto';
import { RENTAL_PROTECTION_PACKAGES, type RentalBindRequest, type RentalBindResponse, type RentalCoverageCode, type RentalPolicyResponse, type RentalQuoteRequest, type RentalQuoteResponse } from '@facio/products';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';
import { BONZAH_DEMO_RULES } from '../../../products/rental/pricing/demoConfig.js';
import { RentalRatingError } from '../../../products/rental/pricing/calculator.js';
import { demoQuoteStore } from './quoteStore.js';
import { getInsillionClient, InsillionProviderError } from '../infra/insillionClient.js';
import { insillionState, providerData, toInsillionFinalQuote, toInsillionPremium } from './insillionMapper.js';

export class BonzahDemoError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

const stableHash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integrityFor = (quoteId: string, requestHash: string, total: number) => crypto.createHash('sha256').update(`${quoteId}:${requestHash}:${total}:${BONZAH_DEMO_RULES.version}`).digest('hex');
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const executionMode = () => process.env.BONZAH_EXECUTION_MODE === 'insillion' ? 'INSILLION' as const : 'SIMULATION' as const;
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const providerError = (error: unknown): never => {
  if (error instanceof BonzahDemoError) throw error;
  if (error instanceof InsillionProviderError) throw new BonzahDemoError(error.httpStatus, error.code, error.message);
  throw new BonzahDemoError(422, 'INSILLION_MAPPING_INVALID', error instanceof Error ? error.message : 'Insillion request mapping failed.');
};

async function validateMasters(request: RentalQuoteRequest): Promise<void> {
  const client = getInsillionClient();
  const country = await client.master({ master_name: 'country', values: 'country', filter: '', filter_value: '' });
  const states = await client.master({ master_name: 'state', values: 'state', filter: 'country', filter_value: 'United States' });
  const countryValues = Array.isArray(asRecord(country).country) ? asRecord(country).country as unknown[] : Array.isArray(country) ? country : [];
  const stateValues = Array.isArray(states) ? states.map((item) => typeof item === 'string' ? item : String(asRecord(item).state || '')) : [];
  if (!countryValues.map(String).includes('United States')) throw new BonzahDemoError(422, 'PROVIDER_MASTER_MISMATCH', 'United States is not available in the Insillion country master.');
  const pickup = insillionState(request.risk.pickup.state);
  if (!stateValues.includes(pickup)) throw new BonzahDemoError(422, 'PROVIDER_MASTER_MISMATCH', `${pickup} is not available in the Insillion state master.`);
}

// The ZIP master is the provider's own authority on which postal codes exist and
// which city/state/country they resolve to. Cross-checking before finalization
// turns a silent provider rejection into a precise, actionable Facio error.
async function validatePostalCode(bind: RentalBindRequest): Promise<void> {
  const postalCode = bind.policyholder.address.postalCode.trim();
  const master = await getInsillionClient().master({ master_name: 'zipcode', values: 'city,state,country', filter: 'zipcode', filter_value: postalCode });
  const object = asRecord(master);
  const rows = Array.isArray(master) ? master.map(asRecord) : Array.isArray(object.zipcode) ? object.zipcode.map(asRecord) : object.state && object.country ? [object] : [];
  if (!rows.length) throw new BonzahDemoError(422, 'POSTAL_CODE_NOT_RECOGNISED', 'The provider does not recognise this ZIP code.');
  const declaredState = insillionState(bind.policyholder.address.state);
  const states = rows.map((row) => insillionState(String(row.state || ''))).filter(Boolean);
  if (states.length && !states.includes(declaredState)) throw new BonzahDemoError(422, 'POSTAL_CODE_STATE_MISMATCH', `ZIP code ${postalCode} does not belong to ${declaredState}.`);
  const countries = rows.map((row) => String(row.country || '')).filter(Boolean);
  if (!countries.some((country) => country === 'US' || country === 'United States')) throw new BonzahDemoError(422, 'POSTAL_CODE_COUNTRY_MISMATCH', `ZIP code ${postalCode} is not a United States postal code.`);
}

function providerCoveragePrices(request: RentalQuoteRequest, data: Record<string, unknown>): RentalQuoteResponse['coverages'] {
  const info = Array.isArray(data.coverage_information) ? data.coverage_information.map(asRecord) : [];
  const rateKeys: Record<RentalCoverageCode, string> = { CDW: 'cdw_rate', RCLI: 'rcli_rate', SLI: 'sli_rate', PAI_PEI: 'pai_rate' };
  const labels: Record<RentalCoverageCode, string> = { CDW: 'Collision Damage Waiver (CDW)', RCLI: "Renter's Contingent Liability Insurance (RCLI)", SLI: 'Supplemental Liability Insurance (SLI)', PAI_PEI: 'Personal Accident Insurance (PAI)' };
  return request.coverages.map((code) => {
    const row = info.find((item) => String(item.optional_addon_cover_name || '').includes(code === 'PAI_PEI' ? 'Personal Accident' : code));
    const tripPrice = number(row?.optional_addon_premium);
    const rate = String(data[rateKeys[code]] || '');
    const amount = /^\s*\$?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*\/|\s*$)/.exec(rate)?.[1];
    if (!amount) throw new InsillionProviderError('PROVIDER_INVALID_RESPONSE', 'Insillion returned an invalid coverage rate.');
    return { code, label: labels[code], selected: true, dailyPrice: number(amount.replace(/,/g, '')), tripPrice, limit: '', deductible: '', description: '' };
  });
}

// A package code is a shorthand for an exact coverage set. Resolving it here
// keeps the provider coverage flags and the simulation calculator agreeing on
// what was actually sold, and rejects a mismatched pair before any outbound call.
function resolvePackage(request: RentalQuoteRequest): RentalQuoteResponse['package'] {
  if (!request.packageCode) return undefined;
  const definition = RENTAL_PROTECTION_PACKAGES[request.packageCode];
  if (!definition) throw new BonzahDemoError(422, 'PACKAGE_NOT_RECOGNISED', 'The selected protection package is not recognised.');
  const mismatched = definition.coverages.length !== request.coverages.length || definition.coverages.some((code) => !request.coverages.includes(code));
  if (mismatched) throw new BonzahDemoError(422, 'PACKAGE_COVERAGE_MISMATCH', 'The selected package must use its configured coverages.');
  return { code: request.packageCode, label: definition.label, coverages: definition.coverages };
}

export async function createRentalQuote(args: { request: RentalQuoteRequest; partnerId: string; idempotencyKey: string; correlationId?: string }): Promise<RentalQuoteResponse> {
  // Human-readable pickup location is not a rating input. Normalising it out
  // lets browser/API retries remain idempotent even when one channel supplies
  // the optional airport label and the other supplies only the jurisdiction.
  const { location: _location, ...ratedPickup } = args.request.risk.pickup;
  const requestHash = stableHash({ ...args.request, risk: { ...args.request.risk, pickup: ratedPickup } });
  const claim = demoQuoteStore.claimQuoteIdempotency(args.partnerId, args.idempotencyKey, requestHash);
  if (claim.state === 'CONFLICT') throw new BonzahDemoError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different request.');
  if (claim.state === 'SETTLED') return claim.value.response;
  if (claim.state === 'IN_FLIGHT') throw new BonzahDemoError(409, 'IDEMPOTENT_REQUEST_IN_PROGRESS', 'An earlier request with this idempotency key is still being processed.');
  try {
    return await rateRentalQuote({ ...args, requestHash });
  } catch (error) {
    // A slot is only kept when the provider may already hold state for it; every
    // other failure releases it so the caller can correct and retry the same key.
    if (!(error instanceof BonzahDemoError && error.code === 'PROVIDER_RECONCILIATION_REQUIRED')) demoQuoteStore.releaseQuoteIdempotency(args.partnerId, args.idempotencyKey);
    throw error;
  }
}

async function rateRentalQuote(args: { request: RentalQuoteRequest; partnerId: string; idempotencyKey: string; correlationId?: string; requestHash: string }): Promise<RentalQuoteResponse> {
  const requestHash = args.requestHash;
  if (args.request.risk.rentalUse !== 'PERSONAL') throw new BonzahDemoError(422, 'RENTAL_USE_NOT_ELIGIBLE', 'Commercial, rideshare and delivery use are not eligible for Bonzah protection.');
  if (args.request.coverages.includes('SLI') && !args.request.coverages.includes('RCLI')) throw new BonzahDemoError(422, 'SLI_REQUIRES_RCLI', 'SLI must be selected with RCLI.');
  const selectedPackage = resolvePackage(args.request);
  if (executionMode() === 'INSILLION') {
    try {
      await validateMasters(args.request);
      const payload = await getInsillionClient().premium(toInsillionPremium(args.request));
      const data = providerData(payload);
      const quotedTotal = data.total_premium ?? data.total_amount;
      const total = number(quotedTotal);
      // A missing or zero premium is a malformed response, not a free policy.
      if (quotedTotal === undefined || quotedTotal === null || !Number.isFinite(total) || total <= 0) throw new InsillionProviderError('PROVIDER_INVALID_RESPONSE', 'Insillion did not return a valid total premium.');
      const quoteId = demoQuoteStore.nextQuoteId();
      const coverages = providerCoveragePrices(args.request, data);
      const response: RentalQuoteResponse = {
        quoteId, riskSnapshot: args.request.risk, status: 'QUOTED', message: 'Your Bonzah protection quote is ready.',
        customerExplanation: [], ruleReferences: [], ruleVersion: 'INSILLION', effectiveDate: args.request.effectiveDate,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), chargedPeriods: Math.max(1, Math.ceil((Date.parse(args.request.risk.rentalEnd) - Date.parse(args.request.risk.rentalStart)) / 86_400_000)),
        vehicleMultiplier: null, factors: [], ratingSource: null, coverages, subtotal: total, fees: 0, feeComponents: [], tax: 0, total, currency: 'USD',
        warnings: [], referralRequirements: [], correlationId: args.correlationId || crypto.randomUUID(), integrityToken: integrityFor(quoteId, requestHash, total),
        package: selectedPackage, executionMode: 'INSILLION', providerValidationErrors: Array.isArray(payload.errors) ? payload.errors.map(String) : [],
        providerRates: Object.fromEntries(args.request.coverages.map((code) => [code, String(data[{ CDW:'cdw_rate', RCLI:'rcli_rate', SLI:'sli_rate', PAI_PEI:'pai_rate' }[code]] || '')])),
      };
      demoQuoteStore.saveQuote({ partnerId: args.partnerId, request: args.request, requestHash, response, executionMode: 'INSILLION' });
      demoQuoteStore.settleQuoteIdempotency(args.partnerId, args.idempotencyKey, requestHash, quoteId);
      return response;
    } catch (error) { providerError(error); }
  }
  const adapter = ProductRegistry.getInstance().getAdapter('RENTAL');
  if (!adapter) throw new BonzahDemoError(503, 'RENTAL_PRODUCT_NOT_REGISTERED', 'Rental demo product is not registered.');
  let result;
  try { result = await adapter.buildQuoteResponse(args.request, { programId: args.request.programId }); }
  catch (error) {
    if (error instanceof RentalRatingError) throw new BonzahDemoError(422, error.code, error.message);
    throw error;
  }
  const rating = asRecord(result.quoteResponse);
  const quoteId = demoQuoteStore.nextQuoteId();
  const status = String(rating.status) as RentalQuoteResponse['status'];
  const total = Number(rating.total ?? 0);
  const response: RentalQuoteResponse = {
    quoteId, riskSnapshot: args.request.risk, status,
    message: status === 'QUOTED' ? 'Your illustrative protection quote is ready.' : status === 'REFERRED' ? 'Review is required before protection can be confirmed.' : args.request.risk.rentalUse !== 'PERSONAL' ? 'This rental use is not eligible for this demo protection.' : 'This vehicle is not eligible for this demo protection.',
    customerExplanation: [String(rating.eligibilityExplanation ?? '')],
    ruleReferences: Array.isArray(rating.internalRuleReferences) ? rating.internalRuleReferences.map(String) : [],
    ruleVersion: BONZAH_DEMO_RULES.version, effectiveDate: BONZAH_DEMO_RULES.effectiveDate,
    expiresAt: new Date(Date.now() + BONZAH_DEMO_RULES.expiresInMinutes * 60_000).toISOString(),
    chargedPeriods: Number(rating.chargedPeriods), vehicleMultiplier: Number(rating.vehicleMultiplier),
    factors: Array.isArray(rating.factors) ? rating.factors as RentalQuoteResponse['factors'] : [],
    ratingSource: rating.ratingSource as RentalQuoteResponse['ratingSource'],
    coverages: Array.isArray(rating.coveragePrices) ? rating.coveragePrices as RentalQuoteResponse['coverages'] : [],
    subtotal: Number(rating.subtotal), fees: Number(rating.fees), feeComponents: Array.isArray(rating.feeComponents) ? rating.feeComponents as RentalQuoteResponse['feeComponents'] : [], tax: Number(rating.tax), total, currency: 'USD',
    warnings: Array.isArray(rating.warnings) ? rating.warnings.map(String) : [],
    referralRequirements: Array.isArray(rating.referralRequirements) ? rating.referralRequirements.map(String) : [],
    package: rating.package && typeof rating.package === 'object' ? rating.package as RentalQuoteResponse['package'] : undefined,
    correlationId: args.correlationId || crypto.randomUUID(), integrityToken: integrityFor(quoteId, requestHash, total), demoStatus: 'DEMO BUILD', executionMode: 'SIMULATION',
  };
  demoQuoteStore.saveQuote({ partnerId: args.partnerId, request: args.request, requestHash, response });
  demoQuoteStore.settleQuoteIdempotency(args.partnerId, args.idempotencyKey, requestHash, quoteId);
  return response;
}

// Underpayment is recorded by Insillion as a partial payment that does not issue
// a policy, and overpayment is rejected outright, so the settled amount is
// checked against the finalized total rather than assumed from a 200 response.
function assertFullyPaid(paid: Record<string, unknown>, expectedTotal: number): void {
  const settled = paid.total_recvd ?? paid.paid_amount;
  if (settled === undefined || settled === null || String(settled).trim() === '' || !Number.isFinite(Number(settled))) throw new BonzahDemoError(409, 'PROVIDER_PAYMENT_INCOMPLETE', 'Insillion did not return a settled payment amount.');
  if (settled !== undefined && settled !== null && String(settled) !== '' && Math.abs(number(settled) - expectedTotal) > 0.005) {
    throw new BonzahDemoError(409, 'PROVIDER_PAYMENT_AMOUNT_MISMATCH', 'Insillion settled an amount that differs from the finalized quote total.');
  }
  const outstanding = paid.balance_amount ?? paid.due_amount;
  if (outstanding !== undefined && outstanding !== null && String(outstanding) !== '' && number(outstanding) > 0.005) {
    throw new BonzahDemoError(409, 'PROVIDER_PAYMENT_INCOMPLETE', 'Insillion recorded a partial payment; the policy has not been issued.');
  }
  const state = String(paid.payment_status ?? paid.status_txt ?? '').toLowerCase();
  if (state && /partial|pending|fail|declin/.test(state)) {
    throw new BonzahDemoError(409, 'PROVIDER_PAYMENT_INCOMPLETE', 'Insillion did not confirm the payment as settled.');
  }
}

export function getRentalQuote(quoteId: string, partnerId: string): RentalQuoteResponse {
  const quote = demoQuoteStore.getQuote(quoteId);
  if (!quote) throw new BonzahDemoError(404, 'QUOTE_NOT_FOUND', 'Demo quote not found.');
  if (quote.partnerId !== partnerId) throw new BonzahDemoError(403, 'PARTNER_MISMATCH', 'Quote belongs to another partner.');
  return quote.response;
}

export async function bindRentalQuote(args: RentalBindRequest & { quoteId: string; partnerId: string; idempotencyKey: string }): Promise<RentalBindResponse> {
  const bindRequestHash = stableHash({ integrityToken: args.integrityToken, payment: args.payment, expectedTotal: args.expectedTotal, policyholder: args.policyholder, rentalAgreement: args.rentalAgreement, consents: args.consents, inspectionRecipient: args.inspectionRecipient, policyBookingTimeZone: args.policyBookingTimeZone, alternateEmail: args.alternateEmail, additionalDrivers: args.additionalDrivers, rmsMetadata: args.rmsMetadata });
  const claim = demoQuoteStore.claimConfirmation(args.partnerId, args.quoteId, args.idempotencyKey, bindRequestHash);
  if (claim.state === 'CONFLICT') throw new BonzahDemoError(409, 'IDEMPOTENCY_CONFLICT', 'This bind idempotency key was already used for different customer or payment details.');
  if (claim.state === 'SETTLED') return claim.value;
  if (claim.state === 'IN_FLIGHT') throw new BonzahDemoError(409, 'IDEMPOTENT_REQUEST_IN_PROGRESS', 'An earlier bind with this idempotency key is still being processed.');
  try {
    return await confirmRentalQuote({ ...args, bindRequestHash });
  } catch (error) {
    // A finalization or payment that may have succeeded keeps its slot claimed so
    // an automatic retry cannot issue a second policy or take a second payment.
    const ambiguous = error instanceof BonzahDemoError && ['PROVIDER_RECONCILIATION_REQUIRED', 'PROVIDER_DOCUMENTS_UNAVAILABLE', 'PROVIDER_POLICY_NOT_ISSUED', 'PROVIDER_PAYMENT_AMOUNT_MISMATCH', 'PROVIDER_PAYMENT_INCOMPLETE'].includes(error.code);
    if (!ambiguous && !demoQuoteStore.getProviderOperation(args.partnerId, args.quoteId)) demoQuoteStore.releaseConfirmation(args.partnerId, args.quoteId, args.idempotencyKey);
    throw error;
  }
}

async function confirmRentalQuote(args: RentalBindRequest & { quoteId: string; partnerId: string; idempotencyKey: string; bindRequestHash: string }): Promise<RentalBindResponse> {
  const bindRequestHash = args.bindRequestHash;
  const stored = demoQuoteStore.getQuote(args.quoteId);
  if (!stored) throw new BonzahDemoError(404, 'QUOTE_NOT_FOUND', 'Demo quote not found.');
  if (stored.partnerId !== args.partnerId) throw new BonzahDemoError(403, 'PARTNER_MISMATCH', 'Quote belongs to another partner.');
  if (stored.response.status !== 'QUOTED') throw new BonzahDemoError(409, 'QUOTE_NOT_BINDABLE', 'Only a quoted demo result can be confirmed.');
  if (Date.parse(stored.response.expiresAt) <= Date.now()) throw new BonzahDemoError(409, 'QUOTE_EXPIRED', 'The demo quote has expired.');
  if (args.integrityToken !== stored.response.integrityToken) throw new BonzahDemoError(409, 'INTEGRITY_MISMATCH', 'Quote integrity token is invalid.');
  if (args.expectedTotal !== undefined && args.expectedTotal !== stored.response.total) throw new BonzahDemoError(409, 'CLIENT_TOTAL_MISMATCH', 'Client total does not match the canonical quote.');
  const configuredMode = process.env.BONZAH_EXECUTION_MODE || (process.env.NODE_ENV === 'production' ? 'production' : 'simulation');
  if ((configuredMode === 'production' || configuredMode === 'insillion') && args.payment.provider === 'SIMULATED') throw new BonzahDemoError(422, 'SIMULATED_PAYMENT_FORBIDDEN', 'Simulated payment is disabled outside simulation mode.');
  if (stored.request.coverages.some((code) => code === 'RCLI' || code === 'SLI') && !args.consents.liabilityNoticeAccepted) throw new BonzahDemoError(422, 'LIABILITY_NOTICE_REQUIRED', 'The liability coverage notice must be accepted for liability coverage.');
  if (stored.executionMode === 'INSILLION') {
    try {
      getInsillionClient().assertSandboxMutation();
      const finalRequest = toInsillionFinalQuote(stored.request, args);
      if (stored.response.providerValidationErrors?.length) throw new BonzahDemoError(422, 'PROVIDER_REJECTED', 'Resolve provider quote validation errors before finalization.');
      await validatePostalCode(args);
      demoQuoteStore.recordProviderOperation(args.partnerId, args.quoteId);
      const finalized = providerData(await getInsillionClient().finalizeQuote(finalRequest));
      demoQuoteStore.recordProviderOperation(args.partnerId, args.quoteId, { quoteId: String(finalized.quote_id || ''), paymentId: String(finalized.payment_id || ''), policyId: String(finalized.policy_id || '') });
      const providerTotal = number(finalized.total_amount ?? finalized.total_premium);
      if (providerTotal !== stored.response.total) throw new BonzahDemoError(409, 'STALE_QUOTE', 'Insillion finalization total differs from the quoted total.');
      const paymentId = String(finalized.payment_id || '');
      const policyId = String(finalized.policy_id || '');
      if (!paymentId || !policyId) throw new InsillionProviderError('PROVIDER_INVALID_RESPONSE', 'Insillion finalization did not return payment and policy identifiers.');
      const paid = providerData(await getInsillionClient().payment({ payment_id: paymentId, amount: providerTotal }));
      assertFullyPaid(paid, providerTotal);
      const policy = providerData(await getInsillionClient().policy(policyId));
      const policyNumber = String(policy.policy_no || paid.policy_no || finalized.policy_no || '');
      // Insillion accepts an underpayment as a partial payment without issuing
      // the policy, so the returned policy number is the only proof of issuance.
      if (!policyNumber) throw new BonzahDemoError(409, 'PROVIDER_POLICY_NOT_ISSUED', 'Insillion accepted the payment but has not issued a policy number.');
      const quoteProviderId = String(finalized.quote_id || '');
      const documentIds: Partial<Record<RentalCoverageCode, string>> = {
        CDW: String(policy.cdw_pdf_id || paid.cdw_pdf_id || ''), RCLI: String(policy.rcli_pdf_id || paid.rcli_pdf_id || ''),
        SLI: String(policy.sli_pdf_id || paid.sli_pdf_id || ''), PAI_PEI: String(policy.pai_pdf_id || paid.pai_pdf_id || ''),
      };
      const missingDocuments = stored.request.coverages.filter((coverage) => !documentIds[coverage]);
      const documents = stored.request.coverages.map((coverage) => ({ coverage, href: `/api/v1/bonzah/policies/${encodeURIComponent(policyId)}/documents/${coverage}` }));
      const providerReferences = { quoteId: quoteProviderId, quoteNumber: String(finalized.quote_no || ''), paymentId, policyId, policyNumber };
      const confirmation: RentalBindResponse = { confirmationId: policyNumber || policyId, quoteId: args.quoteId, status: 'CONFIRMED', paymentStatus: 'VERIFIED', confirmedAt: new Date().toISOString(), total: providerTotal, currency: 'USD', ruleVersion: 'INSILLION', executionMode: 'INSILLION', providerReferences, documents };
      demoQuoteStore.savePolicy({ policyId, policyNumber, quoteId: args.quoteId, paymentStatus: 'VERIFIED', executionMode: 'INSILLION', coverages: stored.request.coverages, documents: documents.filter((entry) => !missingDocuments.includes(entry.coverage)), providerReferences, partnerId: args.partnerId, documentIds });
      // The policy exists and is paid, so it is recorded before failing: this is a
      // document-retrieval defect to reconcile, not a reason to re-bind or re-pay.
      if (missingDocuments.length) throw new BonzahDemoError(502, 'PROVIDER_DOCUMENTS_UNAVAILABLE', `Insillion issued policy ${policyNumber} without documents for ${missingDocuments.join(', ')}.`);
      demoQuoteStore.settleConfirmation(args.partnerId, args.quoteId, args.idempotencyKey, { requestHash: bindRequestHash, response: confirmation });
      return confirmation;
    } catch (error) { providerError(error); }
  }
  if (args.payment.provider !== 'SIMULATED') throw new BonzahDemoError(422, 'SIMULATED_PAYMENT_REQUIRED', 'Simulation cannot verify hosted payments.');
  const rerated = await ProductRegistry.getInstance().getAdapter('RENTAL')?.buildQuoteResponse(stored.request, {});
  const canonical = asRecord(rerated?.quoteResponse);
  if (Number(canonical.total) !== stored.response.total || BONZAH_DEMO_RULES.version !== stored.response.ruleVersion) throw new BonzahDemoError(409, 'STALE_QUOTE', 'The quote changed during bind-time re-rating.');
  const simulated = args.payment.provider === 'SIMULATED';
  const confirmation: RentalBindResponse = { confirmationId: `${simulated ? 'BC-DEMO' : 'BC'}-${args.quoteId.replace('BQ-DEMO-', '')}`, quoteId: args.quoteId, status: simulated ? 'SIMULATED_CONFIRMED' : 'CONFIRMED', paymentStatus: simulated ? 'SIMULATED_VERIFIED' : 'VERIFIED', confirmedAt: new Date().toISOString(), total: stored.response.total, currency: 'USD', ruleVersion: stored.response.ruleVersion, executionMode: 'SIMULATION', ...(simulated ? { demoStatus: 'SIMULATED' as const } : {}) };
  demoQuoteStore.settleConfirmation(args.partnerId, args.quoteId, args.idempotencyKey, { requestHash: bindRequestHash, response: confirmation });
  return confirmation;
}

export function getRentalPolicy(policyId: string, partnerId: string): RentalPolicyResponse {
  const policy = demoQuoteStore.getPolicy(policyId);
  if (!policy) throw new BonzahDemoError(404, 'POLICY_NOT_FOUND', 'Bonzah policy not found.');
  if (policy.partnerId !== partnerId) throw new BonzahDemoError(403, 'PARTNER_MISMATCH', 'Policy belongs to another partner.');
  const { partnerId: _partnerId, documentIds: _documentIds, ...response } = policy;
  return response;
}

export async function getRentalPolicyDocument(policyId: string, coverage: RentalCoverageCode, partnerId: string): Promise<Response> {
  const policy = demoQuoteStore.getPolicy(policyId);
  if (!policy) throw new BonzahDemoError(404, 'POLICY_NOT_FOUND', 'Bonzah policy not found.');
  if (policy.partnerId !== partnerId) throw new BonzahDemoError(403, 'PARTNER_MISMATCH', 'Policy belongs to another partner.');
  const dataId = policy.documentIds[coverage];
  if (!dataId) throw new BonzahDemoError(404, 'POLICY_DOCUMENT_NOT_FOUND', 'The selected coverage document is unavailable.');
  try { return await getInsillionClient().document(policyId, dataId); }
  catch (error) { return providerError(error); }
}
