import type { RentalBindResponse, RentalExecutionMode, RentalPolicyResponse, RentalQuoteRequest, RentalQuoteResponse } from '@facio/products';

export type StoredRentalQuote = { partnerId: string; request: RentalQuoteRequest; requestHash: string; response: RentalQuoteResponse; executionMode?: RentalExecutionMode };
type StoredIdempotency = { requestHash: string; quoteId?: string };
type StoredConfirmation = { requestHash: string; response?: RentalBindResponse };

/**
 * An idempotency slot is claimed before the outbound provider call and settled
 * after it, so a concurrent or retried request can never start a second
 * provider quote, payment or policy for the same key.
 */
export type IdempotencyClaim<T> =
  | { state: 'RESERVED' }
  | { state: 'IN_FLIGHT' }
  | { state: 'CONFLICT' }
  | { state: 'SETTLED'; value: T };

class DemoQuoteStore {
  private quotes = new Map<string, StoredRentalQuote>();
  private quoteIdempotency = new Map<string, StoredIdempotency>();
  private confirmations = new Map<string, StoredConfirmation>();
  private policies = new Map<string, RentalPolicyResponse & { partnerId: string; documentIds: Partial<Record<string, string>> }>();
  private providerOperations = new Map<string, { quoteId?: string; paymentId?: string; policyId?: string }>();
  private sequence = 1000;

  nextQuoteId() { this.sequence += 1; return `BQ-DEMO-${this.sequence}`; }
  getQuote(id: string) { return this.quotes.get(id); }
  saveQuote(record: StoredRentalQuote) { this.quotes.set(record.response.quoteId, record); }

  private claim<T>(store: Map<string, { requestHash: string }>, key: string, requestHash: string, settled: (entry: { requestHash: string }) => T | undefined): IdempotencyClaim<T> {
    const existing = store.get(key);
    if (!existing) { store.set(key, { requestHash }); return { state: 'RESERVED' }; }
    if (existing.requestHash !== requestHash) return { state: 'CONFLICT' };
    const value = settled(existing);
    return value === undefined ? { state: 'IN_FLIGHT' } : { state: 'SETTLED', value };
  }

  private quoteKey(partnerId: string, key: string) { return `${partnerId}:${key}`; }
  private confirmationKey(partnerId: string, quoteId: string, _key: string) { return JSON.stringify([partnerId, quoteId]); }

  recordProviderOperation(partnerId: string, quoteId: string, references: { quoteId?: string; paymentId?: string; policyId?: string } = {}) {
    this.providerOperations.set(this.confirmationKey(partnerId, quoteId, ''), references);
  }
  getProviderOperation(partnerId: string, quoteId: string) { return this.providerOperations.get(this.confirmationKey(partnerId, quoteId, '')); }

  claimQuoteIdempotency(partnerId: string, key: string, requestHash: string): IdempotencyClaim<StoredRentalQuote> {
    return this.claim(this.quoteIdempotency, this.quoteKey(partnerId, key), requestHash, (entry) => {
      const quoteId = (entry as StoredIdempotency).quoteId;
      return quoteId ? this.quotes.get(quoteId) : undefined;
    });
  }

  settleQuoteIdempotency(partnerId: string, key: string, requestHash: string, quoteId: string) {
    this.quoteIdempotency.set(this.quoteKey(partnerId, key), { requestHash, quoteId });
  }

  releaseQuoteIdempotency(partnerId: string, key: string) { this.quoteIdempotency.delete(this.quoteKey(partnerId, key)); }

  claimConfirmation(partnerId: string, quoteId: string, key: string, requestHash: string): IdempotencyClaim<RentalBindResponse> {
    return this.claim(this.confirmations, this.confirmationKey(partnerId, quoteId, key), requestHash, (entry) => (entry as StoredConfirmation).response);
  }

  settleConfirmation(partnerId: string, quoteId: string, key: string, value: StoredConfirmation) {
    this.confirmations.set(this.confirmationKey(partnerId, quoteId, key), value);
  }

  releaseConfirmation(partnerId: string, quoteId: string, key: string) { this.confirmations.delete(this.confirmationKey(partnerId, quoteId, key)); }

  savePolicy(value: RentalPolicyResponse & { partnerId: string; documentIds: Partial<Record<string, string>> }) { this.policies.set(value.policyId, value); }
  getPolicy(policyId: string) { return this.policies.get(policyId); }
  reset() { this.quotes.clear(); this.quoteIdempotency.clear(); this.confirmations.clear(); this.policies.clear(); this.providerOperations.clear(); this.sequence = 1000; }
}

export const demoQuoteStore = new DemoQuoteStore();
