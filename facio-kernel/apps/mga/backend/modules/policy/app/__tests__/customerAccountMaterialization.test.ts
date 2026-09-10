import { describe, expect, it } from 'vitest';
import { materializeCustomerAccountForPolicy } from '../customerAccountMaterialization.js';

type Call = { method: string; args: unknown };

function quoteDataWith(email: string) {
  return {
    proposer: {
      firstName: 'Imported',
      lastName: 'Traveller',
      email,
      phone: '+35799999999',
      address: { line1: 'Street 1', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
    },
  };
}

type HolderContactFixture = { email?: string; nif?: string };
type HolderFixture = { id: string; name: string; contact: HolderContactFixture; policies?: Array<{ id: string }> };
/** Shape `materializeCustomerAccountForPolicy` writes to the holder delegates. */
type HolderWriteData = { name?: string; segment?: string; address?: string; contact?: string };

/**
 * Minimal tx double. `outbox` is intentionally absent — the projection
 * enqueue helpers no-op without it, keeping this a pure unit test.
 */
function makeTx(existingHolders: HolderFixture[]) {
  const calls: Call[] = [];
  const holderById = new Map(existingHolders.map((h) => [h.id, h]));
  return {
    calls,
    tx: {
      policyHolder: {
        findMany: async (args: unknown) => {
          calls.push({ method: 'policyHolder.findMany', args });
          return existingHolders.map((h) => ({
            id: h.id,
            name: h.name,
            address: null,
            contact: JSON.stringify(h.contact),
            policies: h.policies || [],
          }));
        },
        findUnique: async (args: { where: { id: string } }) => {
          calls.push({ method: 'policyHolder.findUnique', args });
          const h = holderById.get(args.where.id);
          return h ? { id: h.id, name: h.name, address: null, contact: JSON.stringify(h.contact) } : null;
        },
        findUniqueOrThrow: async (args: { where: { id: string } }) => {
          calls.push({ method: 'policyHolder.findUniqueOrThrow', args });
          const h = holderById.get(args.where.id);
          if (!h) throw new Error('not found');
          return { id: h.id, name: h.name, address: null, contact: JSON.stringify(h.contact) };
        },
        create: async (args: { data: HolderWriteData }) => {
          calls.push({ method: 'policyHolder.create', args });
          return { id: 'holder-new', name: args.data.name, address: args.data.address, contact: args.data.contact };
        },
        update: async (args: { where: { id: string }; data: HolderWriteData }) => {
          calls.push({ method: 'policyHolder.update', args });
          return { id: args.where.id, name: args.data.name, address: args.data.address, contact: args.data.contact };
        },
      },
      policy: {
        update: async (args: unknown) => {
          calls.push({ method: 'policy.update', args });
          return {};
        },
      },
    },
  };
}

describe('materializeCustomerAccountForPolicy — placeholder import emails (ADR-0056)', () => {
  // Regression: BDX imports stamp synthetic `@import.local` proposer emails.
  // With autoAttach, email-based dedupe re-linked every imported policy to the
  // FIRST holder carrying the placeholder — collapsing ~8,900 production
  // policies onto two names. Placeholder emails must never participate in
  // holder matching.
  it('does not attach to an existing holder matched only by an @import.local email', async () => {
    const { tx, calls } = makeTx([
      { id: 'holder-sevastides', name: 'Sevastides Panayiotis', contact: { email: 'britabg0001@import.local' }, policies: [{ id: 'p1' }] },
    ]);
    const result = await materializeCustomerAccountForPolicy({
      tx,
      policyId: 'policy-1',
      currentPolicyHolderId: 'holder-fresh',
      quoteData: quoteDataWith('britabg0001@import.local'),
      segment: 'Travel Insurance',
      conflictMode: 'autoAttach',
    });
    expect(result.status).toBe('materialized');
    if (result.status !== 'materialized') return;
    expect(result.attachedExisting).toBe(false);
    // The policy keeps its own freshly created holder (updated in place).
    expect(result.policyHolder.id).toBe('holder-fresh');
    // Dedupe lookup must not even query by the placeholder email (no NIF → no
    // match keys at all → no findMany call).
    expect(calls.some((c) => c.method === 'policyHolder.findMany')).toBe(false);
    expect(calls.some((c) => c.method === 'policy.update')).toBe(false);
  });

  it('still auto-attaches on a genuine customer email match', async () => {
    const { tx, calls } = makeTx([
      { id: 'holder-alice', name: 'Alice Onymous', contact: { email: 'alice@example.com' }, policies: [{ id: 'p1' }] },
    ]);
    const result = await materializeCustomerAccountForPolicy({
      tx,
      policyId: 'policy-2',
      currentPolicyHolderId: 'holder-fresh',
      quoteData: quoteDataWith('alice@example.com'),
      segment: 'Travel Insurance',
      conflictMode: 'autoAttach',
    });
    expect(result.status).toBe('materialized');
    if (result.status !== 'materialized') return;
    expect(result.attachedExisting).toBe(true);
    expect(result.policyHolder.id).toBe('holder-alice');
    expect(calls.some((c) => c.method === 'policy.update')).toBe(true);
  });
});
