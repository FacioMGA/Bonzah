import type { Prisma } from '@prisma/client';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { enqueueAccountProjectionRefreshByAccountId } from '../../accounts360/app/accountProjectionRefresh.js';

type UnknownRecord = Record<string, unknown>;

export type CustomerAccountResolution =
  | { action: 'attachExisting'; policyHolderId: string }
  | { action: 'createNew' };

export type CustomerAccountConflictMatch = {
  policyHolderId: string;
  name: string;
  address: string | null;
  email: string;
  nif: string;
  reasons: Array<'email' | 'nif'>;
  policyCount: number;
};

export type MaterializedCustomerAccountResult =
  | {
      status: 'materialized';
      policyHolder: { id: string; name: string; address: string | null; contact: string | null };
      attachedExisting: boolean;
    }
  | { status: 'conflict'; matches: CustomerAccountConflictMatch[] };

type TxLike = {
  policyHolder: unknown;
  policy: unknown;
  outbox?: {
    create?: (args: { data: Prisma.OutboxUncheckedCreateInput }) => Promise<unknown>;
  };
};

type PolicyHolderDelegate = {
  findMany: (args: Prisma.PolicyHolderFindManyArgs) => Promise<unknown>;
  findUnique: (args: Prisma.PolicyHolderFindUniqueArgs) => Promise<unknown>;
  findUniqueOrThrow: (args: Prisma.PolicyHolderFindUniqueOrThrowArgs) => Promise<unknown>;
  create: (args: Prisma.PolicyHolderCreateArgs) => Promise<unknown>;
  update: (args: Prisma.PolicyHolderUpdateArgs) => Promise<unknown>;
};

type PolicyDelegate = {
  update: (args: Prisma.PolicyUpdateArgs) => Promise<unknown>;
};

function policyHolderDelegate(tx: TxLike): PolicyHolderDelegate {
  return tx.policyHolder as PolicyHolderDelegate;
}

function policyDelegate(tx: TxLike): PolicyDelegate {
  return tx.policy as PolicyDelegate;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeNif(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[\s.-]+/g, '');
}

function parseContact(value: unknown): UnknownRecord {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

export function customerContactFromQuoteData(quoteData: unknown) {
  const quote = asRecord(quoteData);
  const proposer = asRecord(quote.proposer);
  const address = asRecord(proposer.address);
  const firstName = String(proposer.firstName || '').trim();
  const lastName = String(proposer.lastName || '').trim();
  const email = normalizeEmail(proposer.email);
  const phone = String(proposer.phone || '').trim();
  const nif = normalizeNif(proposer.nif);
  const name = `${firstName} ${lastName}`.trim();
  const addressText = [
    address.line1,
    address.city,
    address.province,
    address.postcode,
    address.country || proposer.domicileCountry,
  ].filter(Boolean).join(', ');

  return {
    firstName,
    lastName,
    name,
    email,
    phone,
    nif,
    address,
    addressText,
    contact: {
      firstName,
      lastName,
      email,
      phone,
      addressLine: address.line1,
      city: address.city,
      state: address.province,
      zip: address.postcode,
      country: address.country || proposer.domicileCountry,
      nationality: proposer.nationality,
      nif: proposer.nif,
      occupation: proposer.occupation,
      dateOfBirth: proposer.dateOfBirth,
      whereDidYouHear: proposer.whereDidYouHear,
      marketingOptIn: proposer.marketingConsent,
      privacyPolicyAccepted: proposer.privacyPolicyAccepted,
      idType: proposer.idType,
      idNumber: proposer.idNumber,
    },
  };
}

export function hasCompleteCustomerContact(quoteData: unknown): boolean {
  const contact = customerContactFromQuoteData(quoteData);
  return Boolean(contact.firstName && contact.lastName && contact.email && contact.phone);
}

async function findMatchingPolicyHolders(args: {
  tx: TxLike;
  email: string;
  nif: string;
  excludePolicyHolderId?: string | null;
}): Promise<CustomerAccountConflictMatch[]> {
  const or: Prisma.PolicyHolderWhereInput[] = [];
  if (args.email) or.push({ contact: { contains: args.email, mode: 'insensitive' } });
  if (args.nif) or.push({ contact: { contains: args.nif, mode: 'insensitive' } });
  if (!or.length) return [];

  const candidates = await policyHolderDelegate(args.tx).findMany({
    where: {
      OR: or,
      ...(args.excludePolicyHolderId ? { id: { not: args.excludePolicyHolderId } } : {}),
    },
    select: {
      id: true,
      name: true,
      address: true,
      contact: true,
      policies: { select: { id: true }, take: 25 },
    },
    take: 25,
  }) as Array<{ id: string; name: string; address: string | null; contact: unknown; policies: Array<{ id: string }> }>;

  return candidates.flatMap((candidate) => {
    const contact = parseContact(candidate.contact);
    const reasons: Array<'email' | 'nif'> = [];
    const candidateEmail = normalizeEmail(contact.email);
    const candidateNif = normalizeNif(contact.nif);
    if (args.email && candidateEmail === args.email) reasons.push('email');
    if (args.nif && candidateNif === args.nif) reasons.push('nif');
    if (!reasons.length) return [];
    return [{
      policyHolderId: candidate.id,
      name: candidate.name,
      address: candidate.address,
      email: candidateEmail,
      nif: candidateNif,
      reasons,
      policyCount: candidate.policies.length,
    }];
  });
}

export async function materializeCustomerAccountForPolicy(args: {
  tx: TxLike;
  policyId: string;
  currentPolicyHolderId: string;
  quoteData: unknown;
  segment: string;
  conflictMode: 'requireResolution' | 'autoAttach';
  resolution?: CustomerAccountResolution | null;
}): Promise<MaterializedCustomerAccountResult> {
  const contact = customerContactFromQuoteData(args.quoteData);
  if (!hasCompleteCustomerContact(args.quoteData)) {
    throw new Error('Customer details are incomplete; first name, last name, email and phone are required.');
  }

  // `@import.local` addresses are synthetic placeholders stamped by the BDX
  // importer, not customer identity. Matching holders on them collapsed
  // ~8,900 imported policies onto two accounts in the 2026-07-30 incident
  // (ADR-0056), so they are excluded from dedupe entirely.
  const isPlaceholderImportEmail = contact.email.endsWith('@import.local');
  const matches = await findMatchingPolicyHolders({
    tx: args.tx,
    email: isPlaceholderImportEmail ? '' : contact.email,
    nif: contact.nif,
    excludePolicyHolderId: args.currentPolicyHolderId,
  });

  if (args.resolution?.action === 'attachExisting') {
    const target = await policyHolderDelegate(args.tx).findUnique({
        where: { id: args.resolution.policyHolderId },
        select: { id: true, name: true, address: true, contact: true },
      }) as { id: string; name: string; address: string | null; contact: string | null } | null;
    if (!target) throw new Error('Selected customer account was not found.');
    await policyDelegate(args.tx).update({
      where: { id: args.policyId },
      data: { policyHolderId: args.resolution.policyHolderId },
    });
    await enqueueAccountProjectionRefreshByAccountId(args.tx, args.resolution.policyHolderId);
    return {
      status: 'materialized',
      policyHolder: {
        id: args.resolution.policyHolderId,
        name: target.name,
        address: target.address,
        contact: target.contact,
      },
      attachedExisting: true,
    };
  }

  if (matches.length && args.conflictMode === 'requireResolution' && args.resolution?.action !== 'createNew') {
    return { status: 'conflict', matches };
  }

  if (matches.length && args.conflictMode === 'autoAttach') {
    const target = matches[0];
    await policyDelegate(args.tx).update({
      where: { id: args.policyId },
      data: { policyHolderId: target.policyHolderId },
    });
    await enqueueAccountProjectionRefreshByAccountId(args.tx, target.policyHolderId);
    const holder = await policyHolderDelegate(args.tx).findUniqueOrThrow({
      where: { id: target.policyHolderId },
      select: { id: true, name: true, address: true, contact: true },
    }) as { id: string; name: string; address: string | null; contact: string | null };
    return { status: 'materialized', policyHolder: holder, attachedExisting: true };
  }

  const policyHolderData: WithoutTenantScope<Prisma.PolicyHolderUncheckedCreateInput> = {
    name: contact.name,
    segment: args.segment,
    address: contact.addressText,
    contact: JSON.stringify(contact.contact),
  };

  const holder = (args.resolution?.action === 'createNew'
    ? await policyHolderDelegate(args.tx).create({ data: policyHolderData as Prisma.PolicyHolderUncheckedCreateInput })
    : await policyHolderDelegate(args.tx).update({
        where: { id: args.currentPolicyHolderId },
        data: policyHolderData as Prisma.PolicyHolderUncheckedUpdateInput,
      })) as { id: string; name: string; address: string | null; contact: string | null };

  if (holder.id !== args.currentPolicyHolderId) {
    await policyDelegate(args.tx).update({ where: { id: args.policyId }, data: { policyHolderId: holder.id } });
  }
  await enqueueAccountProjectionRefreshByAccountId(args.tx, holder.id);

  return { status: 'materialized', policyHolder: holder, attachedExisting: false };
}
