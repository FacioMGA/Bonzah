import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { goldenRentalQuote } from '../../../../products/rental/goldenFixtures.js';
import { bindRentalQuote, BonzahDemoError, createRentalQuote, getRentalPolicy } from '../quoteService.js';
import { demoQuoteStore } from '../quoteStore.js';
import { InsillionClient, setInsillionClientForTests } from '../../infra/insillionClient.js';

registerAllProducts();
beforeEach(() => demoQuoteStore.reset());
afterEach(() => { delete process.env.BONZAH_EXECUTION_MODE; setInsillionClientForTests(null); });
const bindDetails = {
  policyholder: { firstName: 'Alex', lastName: 'Morgan', dateOfBirth: '1991-06-15', email: 'alex.morgan@example.test', phone: '+15550102040', address: { line1: '123 Summit Demo Way', city: 'Denver', state: 'CO', postalCode: '80202', country: 'US' as const }, licence: { number: 'D0000000', state: 'CA' } },
  rentalAgreement: { rentalCompany: 'Summit Rentals' },
  consents: { electronicDelivery: true as const, termsAndPrivacyAccepted: true as const, exclusionsAccepted: true as const, truthfulnessAccepted: true as const, liabilityNoticeAccepted: true, wordingVersion: 'bonzah-rental-us-2026.1', acceptedAt: '2026-09-07T10:00:00.000Z' },
};

describe('Bonzah partner quote service', () => {
  it('returns the identical quote for an idempotent create retry', async () => {
    const args = { request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'create-1', correlationId: 'corr-1' };
    const first = await createRentalQuote(args);
    const second = await createRentalQuote(args);
    expect(second).toEqual(first);
  });

  it('rejects reuse of a key with changed risk', async () => {
    await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'same' });
    const changed = { ...goldenRentalQuote, risk: { ...goldenRentalQuote.risk, driver: { age: 44, licenceValid: true, additionalDriversListed: false } } };
    await expect(createRentalQuote({ request: changed, partnerId: 'summit', idempotencyKey: 'same' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' } satisfies Partial<BonzahDemoError>);
  });

  it('re-rates, rejects an altered client total and makes bind retry idempotent', async () => {
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'quote' });
    const base = { quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'bind', integrityToken: quote.integrityToken, payment: { provider: 'SIMULATED' as const, token: 'simulated-payment-token' }, ...bindDetails };
    await expect(bindRentalQuote({ ...base, expectedTotal: quote.total + 1 })).rejects.toMatchObject({ code: 'CLIENT_TOTAL_MISMATCH' });
    const first = await bindRentalQuote({ ...base, expectedTotal: quote.total });
    const second = await bindRentalQuote({ ...base, expectedTotal: quote.total });
    expect(second).toEqual(first);
    await expect(bindRentalQuote({ ...base, expectedTotal: quote.total, policyholder: { ...base.policyholder, lastName: 'Changed' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('requires the liability notice before binding liability coverage', async () => {
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'quote' });
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'bind', integrityToken: quote.integrityToken, payment: { provider: 'SIMULATED', token: 'simulated-payment-token' }, ...bindDetails, consents: { ...bindDetails.consents, liabilityNoticeAccepted: false } })).rejects.toMatchObject({ code: 'LIABILITY_NOTICE_REQUIRED' });
  });

  it('rejects simulated payment in production execution mode', async () => {
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'quote' });
    process.env.BONZAH_EXECUTION_MODE = 'production';
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'bind', integrityToken: quote.integrityToken, payment: { provider: 'SIMULATED', token: 'simulated-payment-token' }, expectedTotal: quote.total, ...bindDetails })).rejects.toMatchObject({ code: 'SIMULATED_PAYMENT_FORBIDDEN' });
  });

  it('never marks an unverified hosted payment as confirmed in simulation', async () => {
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'hosted-quote' });
    await expect(bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'hosted-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'unverified-payment-token' }, expectedTotal: quote.total, ...bindDetails })).rejects.toMatchObject({ code: 'SIMULATED_PAYMENT_REQUIRED' });
  });

  it('uses Insillion premium, finalization, payment and policy responses as authority', async () => {
    const responses = [
      { status: 0, data: { token: 'provider-token' } },
      { status: 0, data: { country: ['United States'] } },
      { status: 0, data: [{ state: 'Colorado' }, { state: 'California' }] },
      { status: 0, data: { total_premium: 100, cdw_rate: '$10 / 24 hours', rcli_rate: '$8 / 24 hours', sli_rate: '$5 / 24 hours', pai_rate: '$2 / 24 hours' } },
      { status: 0, data: [{ city: 'Denver', state: 'Colorado', country: 'United States' }] },
      { status: 0, data: { quote_id: 'Q1', quote_no: 'QN1', payment_id: 'PY1', policy_id: 'P1', total_amount: 100 } },
      { status: 0, data: { policy_id: 'P1', policy_no: 'POL1', total_recvd: 100 } },
      { status: 0, data: { policy_id: 'P1', policy_no: 'POL1', cdw_pdf_id: 11, rcli_pdf_id: 12, sli_pdf_id: 13, pai_pdf_id: 14 } },
    ];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    setInsillionClientForTests(new InsillionClient({ baseUrl: 'https://bonzah.sb.insillion.com', username: 'user', password: 'secret', timeoutMs: 1000 }, fetcher));
    process.env.BONZAH_EXECUTION_MODE = 'insillion';
    const quote = await createRentalQuote({ request: goldenRentalQuote, partnerId: 'summit', idempotencyKey: 'live-quote' });
    expect(quote).toMatchObject({ total: 100, executionMode: 'INSILLION', ruleVersion: 'INSILLION' });
    const confirmation = await bindRentalQuote({ quoteId: quote.quoteId, partnerId: 'summit', idempotencyKey: 'live-bind', integrityToken: quote.integrityToken, payment: { provider: 'HOSTED', token: 'hosted-payment-token' }, expectedTotal: 100, ...bindDetails, inspectionRecipient: 'Renter', policyBookingTimeZone: 'America/Denver' });
    expect(confirmation).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'VERIFIED', providerReferences: { quoteId: 'Q1', paymentId: 'PY1', policyId: 'P1', policyNumber: 'POL1' } });
    expect(getRentalPolicy('P1', 'summit')).toMatchObject({ policyNumber: 'POL1', executionMode: 'INSILLION' });
    const finalBody = JSON.parse(String(calls.find((call) => call.url.endsWith('/api/v1/Bonzah/quote'))?.init?.body));
    const paymentBody = JSON.parse(String(calls.find((call) => call.url.endsWith('/api/v1/Bonzah/payment'))?.init?.body));
    expect(finalBody).toMatchObject({ licence_no: 'D0000000', finalize: 1, inspection_done: 'Renter' });
    expect(paymentBody).toEqual({ payment_id: 'PY1', amount: 100 });
  });
});
