import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';
import type { BdxRowDto, BdxRowEvaluation } from '../../../reporting/app/bdxImport/types.js';
import { latestTermOrderBy } from '../policyTermFamily.js';

export async function resolveProgramBinder(args: {
  programId?: string;
  binderId?: string;
  productType?: string;
}) {
  const program = args.programId
    ? await tenantScopedPrisma.program.findUnique({ where: { id: args.programId } })
    : await resolveProgramByProductType(args.productType);
  if (!program) return { program: null, binders: [], linkOk: false };
  if (args.binderId) {
    const binder = await tenantScopedPrisma.binder.findUnique({ where: { id: args.binderId } });
    if (!binder) return { program, binders: [], linkOk: false };
    const link = await prisma.programBinderLink.findFirst({
      where: { programId: program.id, binderId: binder.id, status: 'ACTIVE' },
      select: { id: true },
    });
    return { program, binders: link ? [binder] : [], linkOk: Boolean(link) };
  }
  const links = await prisma.programBinderLink.findMany({
    where: { programId: program.id, status: { in: ['ACTIVE', 'EXPIRED', 'PENDING'] } },
    include: { binder: true },
    orderBy: { updatedAt: 'desc' },
  });
  const binders = links
    .map((link) => link.binder)
    .filter((binder) => ['ACTIVE', 'EXPIRED', 'PENDING'].includes(String(binder.status || '').toUpperCase()));
  return { program, binders, linkOk: binders.length > 0 };
}

/**
 * Resolve the exact authority that owns a BDX rating run. The BDX request
 * carries this resolved ID internally so reporting can rate through the same
 * published programme definition as public and BO quote journeys.
 */
export async function resolveBdxBinderProductAuthorityId(args: {
  binderId?: string | null;
  productType?: string | null;
}): Promise<string | null> {
  const binderId = String(args.binderId || '').trim();
  const productCode = String(args.productType || '').trim().toUpperCase();
  if (!binderId || !productCode) return null;
  const authority = await tenantScopedPrisma.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId, productCode } },
    select: { id: true },
  });
  return authority?.id || null;
}

/**
 * BDX history can span binder periods. Select the same binder used by the
 * execution path for this row, then resolve its product authority; never pin
 * validation to the first linked binder in the programme.
 */
export async function resolveBdxBinderProductAuthorityForEvaluation(args: {
  dto: Pick<BdxRowDto, 'inceptionDate' | 'bookedDate'>;
  binders: Array<{ id: string; startDate: Date | null; endDate: Date | null }>;
  productType: string;
}): Promise<string | null> {
  const binder = resolveBinderForEvaluation({ evaluation: { dto: args.dto }, binders: args.binders });
  return resolveBdxBinderProductAuthorityId({ binderId: binder?.id, productType: args.productType });
}

/**
 * Resolve the unique ACTIVE program for a given productType. Refuses to guess
 * when zero or more than one program matches — the BDX worker turns that into a
 * loud failure rather than silently tagging every imported row to whatever
 * program happens to have the most recent updatedAt. See ADR-0007 lifecycle
 * rules and the May 2026 staging incident where 5,702 MOTOR rows were pinned
 * to the Travel program because the previous fallback used "latest ACTIVE".
 */
async function resolveProgramByProductType(productType: string | undefined) {
  const normalized = String(productType || '').trim().toUpperCase();
  if (!normalized) return null;
  const matches = await tenantScopedPrisma.program.findMany({
    where: { status: 'ACTIVE', productType: normalized },
    orderBy: { updatedAt: 'desc' },
  });
  if (matches.length !== 1) return null;
  return matches[0]!;
}

export async function findImportedPolicyByRowKey(rowKey: string): Promise<string | null> {
  const existing = await tenantScopedPrisma.policyStateCurrent.findFirst({
    where: {
      snapshot: {
        path: ['bdxImport', 'rowKey'],
        equals: rowKey,
      },
    },
    select: { policyId: true },
  });
  return existing?.policyId || null;
}

export async function findImportedPoliciesByRowKeys(rowKeys: string[]): Promise<Map<string, string>> {
  const uniqueRowKeys = [...new Set(rowKeys.map((rowKey) => String(rowKey || '').trim()).filter(Boolean))];
  if (uniqueRowKeys.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ policyId: string; rowKey: string }>>`
    SELECT psc."policyId" AS "policyId",
           psc.snapshot -> 'bdxImport' ->> 'rowKey' AS "rowKey"
    FROM "policy_state_current" psc
    WHERE psc.snapshot -> 'bdxImport' ->> 'rowKey' IN (${Prisma.join(uniqueRowKeys)})
  `;
  return new Map(rows.map((row) => [String(row.rowKey || '').trim(), row.policyId]));
}

export async function findImportedEndorsementsByRowKeys(
  rowKeys: string[]
): Promise<Map<string, { policyId: string; riskTransactionId: string }>> {
  const uniqueRowKeys = [...new Set(rowKeys.map((rowKey) => String(rowKey || '').trim()).filter(Boolean))];
  if (uniqueRowKeys.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ policyId: string; riskTransactionId: string; rowKey: string }>>`
    SELECT rt."policyId" AS "policyId",
           rt.id AS "riskTransactionId",
           COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'rowKey' AS "rowKey"
    FROM "risk_transactions" rt
    WHERE rt."transactionType" = 'ENDORSEMENT'
      AND COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'rowKey' IN (${Prisma.join(uniqueRowKeys)})
  `;
  return new Map(rows.map((row) => [
    String(row.rowKey || '').trim(),
    { policyId: row.policyId, riskTransactionId: row.riskTransactionId },
  ]));
}

export async function findImportedPolicyByPolicyNumber(policyNumber: string, termKey?: string): Promise<string | null> {
  const normalized = String(policyNumber || '').trim();
  if (!normalized) return null;
  const normalizedTermKey = String(termKey || '').trim();
  if (normalizedTermKey) {
    const existingByTerm = await tenantScopedPrisma.policyStateCurrent.findFirst({
      where: {
        policy: { policyNumber: normalized },
        snapshot: {
          path: ['bdxImport', 'termKey'],
          equals: normalizedTermKey,
        },
      },
      select: { policyId: true },
    });
    return existingByTerm?.policyId || null;
  }
  const existing = await tenantScopedPrisma.policy.findFirst({
    where: { policyNumber: normalized },
    orderBy: latestTermOrderBy(),
    select: { id: true },
  });
  return existing?.id || null;
}

export function resolveBinderForEvaluation(args: {
  evaluation: { dto: Pick<BdxRowDto, 'inceptionDate' | 'bookedDate'> };
  binders: Array<{ id: string; startDate: Date | null; endDate: Date | null }>;
}): { id: string; startDate: Date | null; endDate: Date | null } | null {
  if (args.binders.length === 0) return null;
  if (args.binders.length === 1) return args.binders[0]!;
  const anchorDateRaw = args.evaluation.dto.inceptionDate || args.evaluation.dto.bookedDate;
  const anchorDate = anchorDateRaw ? new Date(anchorDateRaw) : null;
  if (!anchorDate || Number.isNaN(anchorDate.getTime())) return args.binders[0]!;
  const matched = args.binders.find((binder) => {
    const start = binder.startDate ? new Date(binder.startDate) : null;
    const end = binder.endDate ? new Date(binder.endDate) : null;
    if (!start || !end) return false;
    return anchorDate >= start && anchorDate <= end;
  });
  return matched || args.binders[0]!;
}

export function endorsementEffectiveDate(evaluation: BdxRowEvaluation): string {
  return evaluation.dto.bookedDate || evaluation.dto.inceptionDate || new Date().toISOString().split('T')[0];
}

export function endorsementReasonCode(evaluation: BdxRowEvaluation): string {
  const entry = String(evaluation.dto.entry || '').trim().toUpperCase();
  if (entry === 'RNL') return 'RENEWAL';
  return entry === 'CAN' ? 'CANCELLATION' : entry || 'BDX_ENDORSEMENT';
}

export function replayTransactionType(evaluation: BdxRowEvaluation): 'ENDORSEMENT' | 'RENEWAL' {
  return evaluation.policyImportDisposition === 'IMPORT_RENEWAL'
    || String(evaluation.dto.entry || '').trim().toUpperCase() === 'RNL'
    ? 'RENEWAL'
    : 'ENDORSEMENT';
}

export function migrationManualUwApprovalSnapshot(uwDecision: unknown): Record<string, unknown> | null {
  const decision = uwDecision && typeof uwDecision === 'object' ? uwDecision as Record<string, unknown> : {};
  if (String(decision.outcome || '').toLowerCase() !== 'referral') return null;
  return {
    completedAt: new Date().toISOString(),
    validationResult: { isValid: true, source: 'BDX_IMPORT_AUTO_APPROVAL' },
    manualApproval: {
      approvedAt: new Date().toISOString(),
      approvedBy: {
        id: 'bdx-import',
        name: 'BDX Import',
        email: null,
        role: 'SYSTEM',
      },
      note: 'Migration auto-approved underwriting referral; retain lane indication in UW tab.',
    },
  };
}

export async function uploadToTempBdx(file: Express.Multer.File): Promise<{ sourceFilePath: string; sourceHash: string }> {
  const sourceHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const safeName = String(file.originalname || 'uploaded-bdx.xlsx').replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpPath = path.join(os.tmpdir(), `bdx-import-${Date.now()}-${sourceHash.slice(0, 12)}-${safeName}`);
  await fs.writeFile(tmpPath, file.buffer);
  return { sourceFilePath: tmpPath, sourceHash };
}

export async function sourceHashFromPath(sourceFilePath: string): Promise<string> {
  const bytes = await fs.readFile(sourceFilePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
