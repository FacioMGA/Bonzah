import crypto from 'crypto';
import type { Prisma, RiskTransaction } from '@prisma/client';
import { isIssuedLifecycleByPolicyState } from './policyStateService.js';
import { isPolicyChangeTransactionType } from '../domain/riskTransactionTypes.js';

// Shared helpers for policy routes.
// Keep generic identity typing so existing call sites remain strongly typed.
function toInputJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => (item === null ? null : toInputJson(item)));
  if (value && typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value)) out[k] = v === null ? null : toInputJson(v);
    return out;
  }
  return {};
}

export const jsonStringify = (data: unknown): Prisma.InputJsonValue => toInputJson(data);

export const jsonParse = (data: unknown): Record<string, unknown> | null => {
  if (!data) return null;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
};

// Canonical implementation lives in backend/platform/json/parseRecord.ts.
// Re-exported here to keep the existing import path stable for in-module callers.
import { parseRecord, type UnknownRecord } from '../../../platform/json/parseRecord.js';
export { parseRecord, type UnknownRecord };

export function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : undefined,
    name: user && typeof user.name === 'string' ? user.name : undefined,
    email: user && typeof user.email === 'string' ? user.email : undefined,
    role: user && typeof user.role === 'string' ? user.role : undefined,
    primaryAccountId: user && typeof user.primaryAccountId === 'string' ? user.primaryAccountId : undefined,
  };
}

// Canonical implementation lives in backend/platform/http/httpErrors.ts.
export { errorMessage } from '../../../platform/http/httpErrors.js';

export function getMethod(target: unknown, methodName: string): ((...args: unknown[]) => unknown) | null {
  const obj = parseRecord(target);
  const method = obj[methodName];
  return typeof method === 'function' ? (...args: unknown[]) => method(...args) : null;
}

export function newPublicSessionToken(): string {
  // 32 bytes => 256 bits of entropy. base64url is URL-safe and compact.
  return crypto.randomBytes(32).toString('base64url');
}

const ISSUED_STATUSES = new Set<string>(['ACTIVE', 'ISSUED']);
export function isIssuedLifecycleStatus(status: unknown): boolean {
  const raw = String(status || '').toUpperCase();
  if (ISSUED_STATUSES.has(raw)) return true;
  return isIssuedLifecycleByPolicyState({ status: raw });
}

export type UwEditMode = 'preBind' | 'readOnly' | 'endorsementDraft';

export function resolveUwEditMode(args: {
  policyStatus?: unknown;
  riskTransactionId?: unknown;
}): UwEditMode {
  const riskTransactionId = String(args.riskTransactionId || '').trim();
  if (riskTransactionId) return 'endorsementDraft';
  return isIssuedLifecycleStatus(args.policyStatus) ? 'readOnly' : 'preBind';
}

// Canonical CardCorp config resolver lives in the payments module and is
// tenant-aware (per-country entity + secret, shared bearer; ADR-0049).
// Re-exported here so existing policy-layer callers keep a stable import path.
// Called with no args it resolves the ALS operating tenant's country.
export { getCardcorpConfig } from '../../payments/app/cardcorpConfig.js';

type TxClient = Prisma.TransactionClient;

export async function assertEndorsementDraftRiskTransaction(
  tx: TxClient,
  args: { policyId: string; riskTransactionId: string }
): Promise<RiskTransaction> {
  const riskTxn = await tx.riskTransaction.findFirst({
    where: { id: args.riskTransactionId, policyId: args.policyId },
  });
  if (!riskTxn) throw new Error('Policy change draft not found');
  if (!isPolicyChangeTransactionType(riskTxn.transactionType)) throw new Error('Invalid policy change draft');
  if (String(riskTxn.status || '').toUpperCase() !== 'DRAFT') throw new Error('Policy change draft is not editable');
  return riskTxn;
}

export async function persistWorkspaceSnapshot(
  tx: TxClient,
  args: { policyId: string; riskTransactionId?: string | null; nextSnapshot: unknown }
): Promise<void> {
  const existingState = await tx.policyStateCurrent.findUnique({
    where: { policyId: args.policyId },
    select: { snapshot: true },
  });
  const existingSnapshot = jsonParse(existingState?.snapshot) || {};
  const nextSnapshotRecord = jsonParse(args.nextSnapshot) || {};
  const mergedSnapshot = {
    ...existingSnapshot,
    ...nextSnapshotRecord,
    bdxImport: parseRecord(nextSnapshotRecord).bdxImport ?? parseRecord(existingSnapshot).bdxImport,
    endorsementMeta: {
      ...parseRecord(parseRecord(existingSnapshot).endorsementMeta),
      ...parseRecord(parseRecord(nextSnapshotRecord).endorsementMeta),
      bdxImport:
        parseRecord(parseRecord(nextSnapshotRecord).endorsementMeta).bdxImport
        ?? parseRecord(parseRecord(existingSnapshot).endorsementMeta).bdxImport,
    },
  };
  await tx.policyStateCurrent.upsert({
    where: { policyId: args.policyId },
    update: { snapshot: jsonStringify(mergedSnapshot) },
    create: { policyId: args.policyId, snapshot: jsonStringify(mergedSnapshot) } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
  });

  if (args.riskTransactionId) {
    await tx.riskTransaction.update({
      where: { id: args.riskTransactionId },
      data: { snapshotDraft: jsonStringify(mergedSnapshot) },
    });
  }
}

