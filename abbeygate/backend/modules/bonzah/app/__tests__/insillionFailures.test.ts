import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { goldenRentalQuote } from '../../../../products/rental/goldenFixtures.js';
import { bindRentalQuote, createRentalQuote } from '../quoteService.js';
import { demoQuoteStore } from '../quoteStore.js';
import { InsillionClient, setInsillionClientForTests } from '../../infra/insillionClient.js';

registerAllProducts();
beforeEach(() => demoQuoteStore.reset());
afterEach(() => { delete process.env.BONZAH_EXECUTION_MODE; setInsillionClientForTests(null); });

const bindDetails = {
  policyholder: { firstName: 'Alex', lastName: 'Morgan', dateOfBirth: '1991-06-15', email: 'alex.morgan@example.test', phone: '+15550102040', address: { line1: '123 Summit Demo Way', city: 'Denver', state: 'CO', postalCode: '80202', country: 'US' as const }, licence: { number: 'D0000000', state: 'CA' } },
  rentalAgreement: { rentalCompany: 'Summit Rentals' },
  consents: { electronicDelivery: true as const, termsAndPrivacyAccepted: true as const, exclusionsAccepted: true as const, truthfulnessAccepted: true as const, liabilityNoticeAccepted: true, wordingVersion: 'bonzah-rental-us-2026.1', acceptedAt: '2026-09-07T10:00:00.000Z' },
  inspectionRecipient: 'Renter' as const,
  policyBookingTimeZone: 'America/Denver',
};

const AUTH = { status: 0, data: { token: 'provider-token' } };
const COUNTRY = { status: 0, data: { country: ['United States'] } };
const STATES = { status: 0, data: [{ state: 'Colorado' }, { state: 'California' }] };
const PREMIUM = { status: 0, data: { total_premium: 100, cdw_rate: '$10 / 24 hours', rcli_rate: '$8 / 24 hours', sli_rate: '$5 / 24 hours', pai_rate: '$2 / 24 hours' } };
const ZIP = { status: 0, data: { city: 'Denver', state: 'Colorado', country: 'US' } };
const FINALIZED = { status: 0, data: { quote_id: 'Q1', quote_no: 'QN1', payment_id: 'PY1', policy_id: 'P1', total_amount: 100 } };
const POLICY = { status: 0, data: { policy_id: 'P1', policy_no: 'POL1', cdw_pdf_id: 11, rcli_pdf_id: 12, sli_pdf_id: 13, pai_pdf_id: 14 } };

type Scripted = Array<unknown | Error | { raw: string; status?: number }>;

function withProvider(script: Scripted) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = script.shift();
    if (next instanceof Error) throw next;
    if (next && typeof next === 'object' && 'raw' in next) {
      const scripted = next as { raw: string; status?: number };
      return new Response(scripted.raw, { status: scripted.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  setInsillionClientForTests(new InsillionClient({ baseUrl: 'https://bonzah.sb.insillion.com', username: 'user', password: 'super-secret-password', timeoutMs: 1000 }, fetcher));
  process.env.BONZAH_EXECUTION_MODE = 'insillion';
  return calls;
}

const quoteThenBind = async (script: Scripted, key = 'k') => {
  withProvider(script);
  const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: `${key}-quote` });
  return bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: `${key}-bind`, integrityToken: quote.integrityToken, payment: { provider: 'HOSTED' as const, token: 'hosted-payment-token' }, expectedTotal: quote.total, ...bindDetails });
};

describe('Insillion failure handling', () => {
  it('reads documented ZIP objects and parses only the monetary part of daily rates', async () => {
    withProvider([AUTH, COUNTRY, STATES, { ...PREMIUM, data: { ...PREMIUM.data, rcli_rate: '$21.95 / 24 hours' } }, ZIP, FINALIZED, { status: 0, data: { total_recvd: 100 } }, POLICY]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'rates' });
    expect(quote.coverages.map((coverage) => coverage.dailyPrice)).toEqual([10, 21.95, 5, 2]);
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'rates-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'hosted-payment-token' }, expectedTotal: quote.total, ...bindDetails })).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it.each([
    ['policy lookup timeout', [FINALIZED, { status: 0, data: { total_recvd: 100 } }, new Error('timeout')]],
    ['changed final price', [{ ...FINALIZED, data: { ...FINALIZED.data, total_amount: 133 } }]],
    ['missing final IDs', [{ status: 0, data: { total_amount: 100 } }]],
    ['non-JSON finalization', [{ raw: '<html>gateway</html>', status: 502 }]],
  ])('retains the quote lock after %s, including a different retry key', async (_name, tail) => {
    const calls = withProvider([AUTH, COUNTRY, STATES, PREMIUM, ZIP, ...tail]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'retry-quote' });
    const bind = { quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'first', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED' as const, token: 'hosted-payment-token' }, expectedTotal: quote.total, ...bindDetails };
    await expect(bindRentalQuote(bind)).rejects.toBeInstanceOf(Error);
    const count = calls.length;
    await expect(bindRentalQuote(bind)).rejects.toMatchObject({ code: 'IDEMPOTENT_REQUEST_IN_PROGRESS' });
    await expect(bindRentalQuote({ ...bind, idempotencyKey: 'another' })).rejects.toMatchObject({ code: 'IDEMPOTENT_REQUEST_IN_PROGRESS' });
    expect(calls).toHaveLength(count);
    expect(demoQuoteStore.getProviderOperation('summit', quote.quoteId)).toBeDefined();
  });

  it('includes provider-specific bind details in the idempotency hash', async () => {
    withProvider([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, new Error('timeout')]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'hash' });
    const bind = { quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'hash-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED' as const, token: 'hosted-payment-token' }, ...bindDetails };
    await expect(bindRentalQuote(bind)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_REQUIRED' });
    await expect(bindRentalQuote({ ...bind, policyBookingTimeZone: 'America/New_York' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('does not confuse an invoiced total with money received', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, { status: 0, data: { total_amount: 100 } }], 'unverified')).rejects.toMatchObject({ code: 'PROVIDER_PAYMENT_INCOMPLETE' });
  });

  it('does not silently omit drivers collected during quote creation', async () => {
    const calls = withProvider([AUTH, COUNTRY, STATES, PREMIUM]);
    const request = { ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, driver: { ...goldenRentalQuote.risk.driver, additionalDriversListed: true, additionalDrivers: [{ fullName: 'Sam Lee', licenceNumber: 'D123', licenceState: 'CA' }] } } };
    const quote = await createRentalQuote({ request, partnerId: 'summit', idempotencyKey: 'driver-quote' });
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'driver-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'hosted-payment-token' }, ...bindDetails })).rejects.toMatchObject({ code: 'INSILLION_MAPPING_INVALID' });
    expect(calls.some((call) => call.url.endsWith('/api/v1/Bonzah/quote'))).toBe(false);
  });

  it('requires provider validation errors to be resolved before finalization', async () => {
    const calls = withProvider([AUTH, COUNTRY, STATES, { ...PREMIUM, errors: ['Trip is not eligible'] }]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'invalid-quote' });
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'invalid-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'hosted-payment-token' }, ...bindDetails })).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
    expect(calls.some((call) => call.url.endsWith('/api/v1/Bonzah/quote'))).toBe(false);
  });
  it('surfaces a provider validation rejection as a Facio error', async () => {
    withProvider([AUTH, COUNTRY, STATES, { status: 1, txt: 'Trip start date is in the past', errors: ['trip_start_date'] }]);
    await expect(createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'rejected' }))
      .rejects.toMatchObject({ code: 'PROVIDER_REJECTED', statusCode: 422 });
  });

  it('treats a malformed provider response as an invalid response, not a price', async () => {
    withProvider([AUTH, COUNTRY, STATES, { raw: '<html>gateway</html>' }]);
    await expect(createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'malformed' }))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });

  it('reports a read timeout as provider unavailability without consuming the idempotency key', async () => {
    withProvider([AUTH, COUNTRY, STATES, new Error('timeout'), PREMIUM]);
    await expect(createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'retry-me' }))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    // Token and master data stay cached, so the retry issues only the premium
    // call; the key is released because a failed read leaves no provider state.
    await expect(createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'retry-me' }))
      .resolves.toMatchObject({ total: 100 });
  });

  it('rejects a ZIP code the provider does not recognise before finalizing', async () => {
    const calls = withProvider([AUTH, COUNTRY, STATES, PREMIUM, { status: 0, data: [] }]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'zip-quote' });
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'zip-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'hosted-payment-token' }, expectedTotal: quote.total, ...bindDetails }))
      .rejects.toMatchObject({ code: 'POSTAL_CODE_NOT_RECOGNISED' });
    expect(calls.some((call) => call.url.endsWith('/api/v1/Bonzah/quote'))).toBe(false);
  });

  it('rejects a ZIP code that belongs to another state', async () => {
    withProvider([AUTH, COUNTRY, STATES, PREMIUM, { status: 0, data: [{ city: 'Northampton', state: 'Massachusetts', country: 'United States' }] }]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'zip2-quote' });
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'zip2-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'hosted-payment-token' }, expectedTotal: quote.total, ...bindDetails }))
      .rejects.toMatchObject({ code: 'POSTAL_CODE_STATE_MISMATCH' });
  });

  it('refuses to confirm when the provider settles less than the finalized total', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, { status: 0, data: { total_recvd: 60 } }], 'partial'))
      .rejects.toMatchObject({ code: 'PROVIDER_PAYMENT_AMOUNT_MISMATCH' });
  });

  it('refuses to confirm when the provider reports an outstanding balance', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, { status: 0, data: { total_recvd: 100, balance_amount: 40 } }], 'balance'))
      .rejects.toMatchObject({ code: 'PROVIDER_PAYMENT_INCOMPLETE' });
  });

  it('refuses to confirm when the provider settles more than the finalized total', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, { status: 0, data: { total_recvd: 140 } }], 'over'))
      .rejects.toMatchObject({ code: 'PROVIDER_PAYMENT_AMOUNT_MISMATCH' });
  });

  it('refuses to confirm when finalization omits the payment or policy identifiers', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, { status: 0, data: { quote_id: 'Q1', total_amount: 100 } }], 'ids'))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE' });
  });

  it('refuses to confirm when a paid policy has no policy number', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, { status: 0, data: { total_recvd: 100 } }, { status: 0, data: { policy_id: 'P1' } }], 'nonum'))
      .rejects.toMatchObject({ code: 'PROVIDER_POLICY_NOT_ISSUED' });
  });

  it('records the policy but refuses to confirm when a selected coverage has no document', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, { status: 0, data: { total_recvd: 100 } }, { status: 0, data: { policy_id: 'P1', policy_no: 'POL1', cdw_pdf_id: 11 } }], 'nodoc'))
      .rejects.toMatchObject({ code: 'PROVIDER_DOCUMENTS_UNAVAILABLE' });
    expect(demoQuoteStore.getPolicy('P1')).toMatchObject({ policyNumber: 'POL1' });
  });

  it('rejects a finalization total that no longer matches the quoted total', async () => {
    await expect(quoteThenBind([AUTH, COUNTRY, STATES, PREMIUM, ZIP, { ...FINALIZED, data: { ...FINALIZED.data, total_amount: 133 } }], 'stale'))
      .rejects.toMatchObject({ code: 'STALE_QUOTE' });
  });

  it('does not repeat a payment whose outcome is unknown', async () => {
    withProvider([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, new Error('socket hang up')]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'amb-quote' });
    const bind = { quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'amb-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED' as const, token: 'hosted-payment-token' }, expectedTotal: quote.total, ...bindDetails };
    await expect(bindRentalQuote(bind)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_REQUIRED' });
    // The claimed slot is kept, so an automatic retry cannot pay or issue twice.
    await expect(bindRentalQuote(bind)).rejects.toMatchObject({ code: 'IDEMPOTENT_REQUEST_IN_PROGRESS' });
  });

  it('rejects a package whose coverages do not match the selection before any provider call', async () => {
    const calls = withProvider([AUTH, COUNTRY, STATES, PREMIUM]);
    const request = { ...goldenRentalQuote, packageCode: 'COMPLETE_AUTO_GUARD' as const };
    await expect(createRentalQuote({ request, partnerId: 'summit', idempotencyKey: 'pkg' }))
      .rejects.toMatchObject({ code: 'PACKAGE_COVERAGE_MISMATCH' });
    expect(calls).toHaveLength(0);
  });
});

describe('Insillion secret and PII containment', () => {
  it('never returns credentials, provider tokens or raw provider payloads to the caller', async () => {
    withProvider([AUTH, COUNTRY, STATES, PREMIUM, ZIP, FINALIZED, { status: 0, data: { total_recvd: 100 } }, POLICY]);
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'sec-quote' });
    const confirmation = await bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'sec-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'hosted-payment-token' }, expectedTotal: quote.total, ...bindDetails });
    const serialised = JSON.stringify({ quote, confirmation });
    for (const secret of ['super-secret-password', 'provider-token', 'in-auth-token', 'hosted-payment-token', 'alex.morgan@example.test', 'D0000000', '80202']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('keeps the provider password out of authentication failure messages', async () => {
    withProvider([{ status: 1, txt: 'Invalid credentials' }]);
    await expect(createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'sec-auth' }))
      .rejects.toSatisfy((error: Error) => !JSON.stringify({ message: error.message, ...error }).includes('super-secret-password'));
  });
});
