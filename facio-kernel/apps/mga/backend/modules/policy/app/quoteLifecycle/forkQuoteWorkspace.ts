/**
 * Canonical service for archiving the current quoteData/quoteResponse
 * into PolicyQuoteHistory and unlocking the policy for editing — the
 * "fork the working quote" behaviour the BO Premium tab exposes via
 * `POST /api/policies/:id/quote-history/archive`.
 *
 * Operator MCP V2 (ADR-0039) `operator.fork_quote` calls this directly
 * so the agent reproduces the BO Premium "Save & start a new version"
 * action byte-for-byte. UI-preservation pin: writes are identical
 * because both callers share this code (no parallel implementation).
 *
 * Pattern follows the existing extracted service `saveQuoteVersion` —
 * accepts a Prisma.TransactionClient so the caller controls the
 * transaction boundary (BO opens its TX in the router; the operator
 * MCP tool opens its own).
 */
import type { Prisma } from '@prisma/client';
import { runTenantScopedTransaction } from '../../../../platform/db/connection.js';
import { Prisma as PrismaNs } from '@prisma/client';
import { AuditLogger } from '../../../../platform/audit/logger.js';
import { saveQuoteVersion } from '../history/saveQuoteVersion.js';
import { transitionPolicyLifecycle } from '../commands/policyLifecycleCommands.js';
import { jsonParse, jsonStringify } from '../shared.js';
import { parseRecord } from '../../../../platform/json/parseRecord.js';

export interface ForkQuoteWorkspaceActor {
    id: string;
    role: 'OPERATOR_AGENT' | 'UNDERWRITER' | 'SYSTEM';
    name?: string;
}

export interface ForkQuoteWorkspaceInput {
    policyId: string;
    actor: ForkQuoteWorkspaceActor;
    correlationId?: string;
}

export interface ForkQuoteWorkspaceResult {
    policyId: string;
    archivedVersion: number;
}

function parseSnapshot(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            return parseRecord(JSON.parse(value));
        } catch {
            return {};
        }
    }
    return parseRecord(value);
}

/**
 * Run within an existing transaction. Pre-condition: caller already
 * loaded the policy (or this function will). Returns the new history
 * version number.
 */
export async function forkQuoteWorkspaceInTx(
    tx: Prisma.TransactionClient,
    input: ForkQuoteWorkspaceInput,
): Promise<ForkQuoteWorkspaceResult> {
    const policy = await tx.policy.findUnique({
        where: { id: input.policyId },
        select: {
            id: true,
            quoteData: true,
            quoteResponse: true,
            isLocked: true,
        },
    });
    if (!policy) {
        throw new Error(`forkQuoteWorkspace: policy "${input.policyId}" not found.`);
    }

    const created = await saveQuoteVersion(tx, {
        policyId: input.policyId,
        quoteData: policy.quoteData || {},
        quoteResponse: policy.quoteResponse || {},
        isLockedSnapshot: Boolean(policy.isLocked),
    });

    await tx.policy.update({
        where: { id: input.policyId },
        data: {
            isLocked: false,
            quoteResponse: PrismaNs.JsonNull,
        },
    });

    await transitionPolicyLifecycle({
        tx,
        policyId: input.policyId,
        to: 'DRAFT',
        actorId: input.actor.id,
        actorType: input.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
        reasonCode: 'QUOTE_VERSION_ARCHIVED',
        correlationId: input.correlationId,
        data: { version: created.version },
    });

    // Keep state snapshot aligned (quoteResponse cleared; quoteData retained).
    // Identical to the BO router's inline behaviour.
    const state = await tx.policyStateCurrent.findUnique({ where: { policyId: input.policyId } });
    const prev = state ? parseSnapshot(jsonParse(state.snapshot)) : {};
    const nextSnap = { ...prev, quoteData: policy.quoteData || {}, quoteResponse: null };
    await tx.policyStateCurrent.upsert({
        where: { policyId: input.policyId },
        update: { snapshot: jsonStringify(nextSnap) },
        create: {
            policyId: input.policyId,
            snapshot: jsonStringify(nextSnap),
        } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
    });

    return { policyId: input.policyId, archivedVersion: created.version };
}

/**
 * Standalone entrypoint for callers that don't already own a TX
 * (operator MCP tools). Opens the TX, calls the in-TX function, then
 * emits the canonical POLICY.QUOTE_VERSION.ARCHIVED audit row — same
 * order BO router uses, so projection/event consumers see identical
 * sequences.
 */
export async function forkQuoteWorkspace(
    input: ForkQuoteWorkspaceInput,
): Promise<ForkQuoteWorkspaceResult> {
    const result = await runTenantScopedTransaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        return forkQuoteWorkspaceInTx(tx, input);
    });
    await AuditLogger.log(
        input.policyId,
        'POLICY',
        'POLICY.QUOTE_VERSION.ARCHIVED',
        input.actor.id,
        input.actor.role === 'SYSTEM' ? 'SYSTEM' : 'USER',
        { version: result.archivedVersion, correlationId: input.correlationId, source: 'operator-mcp-v2' },
        input.actor.name,
    );
    return result;
}
