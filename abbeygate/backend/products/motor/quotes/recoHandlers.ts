/**
 * recoHandlers.ts — Recommendations handlers for public auto quotes.
 *
 * Owns recommendation-specific domain:
 *   - getRecommendationsHandler — serve ML/rules-based coverage recommendations
 *   - recoEventHandler — capture recommendation interaction events + bandit updates
 */
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asRecord } from './quoteDataGuards.js';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { RecommendationsEngine } from '../../../modules/recommendations/app/engine.js';
import { updateBanditFromEvent } from '../../../modules/recommendations/app/bandit.js';
import { jsonStringify } from '../../../modules/policy/app/shared.js';
import { TenantResolutionError } from '../../../platform/tenant/tenantResolution.js';

import {
    type RequestWithPerf,
    policyIdFrom,
    isQuoteResponse,
    sendPublicError,
} from './controllerUtils.js';

type PublicSessionModule = typeof import('./publicSession.js');
const publicSessionModule: PublicSessionModule = await import('./publicSession.js');
const { enforcePublicToken, resolvePublicAutoPolicyFull, resolvePublicAutoPolicyLight } = publicSessionModule;

function resolvePublicRecoTenantId(req: Request, policy: { accountId?: unknown } | null | undefined): string {
    const fromPolicy = String(policy?.accountId || '').trim();
    if (fromPolicy) return fromPolicy;
    const fromHeader = String(req.headers['x-tenant-id'] || '').trim();
    if (fromHeader) return fromHeader;
    // Public quote sessions can exist before tenant/account materialization in local/dev flows.
    // Fall back to a deterministic public tenant key instead of hard-failing recommendation UX.
    return 'public';
}
const RecoEventBodySchema = z.object({
    type: z.string().trim().min(1),
    quoteRef: z.string().trim().optional(),
    artifactVersion: z.string().trim().optional(),
    modelKey: z.string().trim().optional(),
    shownBundleIds: z.array(z.union([z.string(), z.number()])).max(12).optional(),
    selectedBundleId: z.union([z.string(), z.number()]).optional(),
    uiContext: z.record(z.string(), z.unknown()).optional(),
});

export async function getRecommendationsHandler(req: Request, res: Response) {
    try {
        const request = req as RequestWithPerf;
        const policyId = policyIdFrom(req);
        const resolved = await resolvePublicAutoPolicyFull(policyId, { perf: request.perf });
        const policy = resolved.policy;
        if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
        if (!enforcePublicToken(request, resolved.mode, res)) return;

        const snapshot = asRecord(asRecord(policy.stateCurrent).snapshot);
        const quoteData = asRecord(snapshot.quoteData && typeof snapshot.quoteData === 'object' ? snapshot.quoteData : policy.quoteData);
        const quoteResponseRaw =
            snapshot.quoteResponse && typeof snapshot.quoteResponse === 'object'
                ? snapshot.quoteResponse
                : policy.quoteResponse;
        if (!isQuoteResponse(quoteResponseRaw)) {
            return res.status(422).json({ success: true, data: { recommendations: [], artifactVersion: 'none' } });
        }
        const quoteResponse = quoteResponseRaw;

        const enabledFlag = String(process.env.RECS_ENABLED_PUBLIC_AUTO || 'true').toLowerCase() !== 'false';
        if (!enabledFlag) {
            return res.json({ success: true, data: { recommendations: [], artifactVersion: 'disabled' } });
        }

        const tenantId = resolvePublicRecoTenantId(req, policy);
        const result = await RecommendationsEngine.recommendForWorkspace({
            tenantId,
            quoteData,
            quoteResponse,
            programId: policy.programId || null,
            productType: 'MOTOR',
        });

        return res.json({ success: true, data: result });
    } catch (e) {
        if (e instanceof TenantResolutionError) {
            return res.status(e.statusCode).json({ success: false, error: { code: e.code, message: e.message } });
        }
        return sendPublicError(res, e, 'Get recommendations failed');
    }
}

export async function recoEventHandler(req: Request, res: Response) {
    try {
        const request = req as RequestWithPerf;
        const policyId = policyIdFrom(req);
        const resolved = await resolvePublicAutoPolicyLight(policyId, { perf: request.perf });
        const policy = resolved.policy;
        if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
        if (!enforcePublicToken(request, resolved.mode, res)) return;

        const tenantId = resolvePublicRecoTenantId(req, policy);
        const parsed = RecoEventBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid recommendation event payload' },
                details: parsed.error.flatten(),
            });
        }
        const body = parsed.data;
        const type = body.type;

        const nowIso = new Date().toISOString();
        const event = {
            type,
            at: nowIso,
            quoteRef: body.quoteRef || null,
            artifactVersion: body.artifactVersion || null,
            modelKey: body.modelKey || null,
            shownBundleIds: Array.isArray(body.shownBundleIds) ? body.shownBundleIds.slice(0, 12).map(String) : undefined,
            selectedBundleId: body.selectedBundleId ? String(body.selectedBundleId) : undefined,
            uiContext: body.uiContext || undefined,
        };

        // v1 persistence: best-effort snapshot trace (bounded).
        const existingState = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: policy.id }, select: { snapshot: true } });
        const existingSnapshot = asRecord(existingState?.snapshot);
        const existingRecommendations = asRecord(existingSnapshot.recommendations);
        const existingEvents = Array.isArray(existingRecommendations.events) ? existingRecommendations.events : [];
        await tenantScopedPrisma.policyStateCurrent.upsert({
            where: { policyId: policy.id },
            update: {
                snapshot: jsonStringify({
                    ...existingSnapshot,
                    recommendations: {
                        ...existingRecommendations,
                        events: [
                            ...existingEvents.slice(-99),
                            event,
                        ],
                    },
                }),
            },
            create: {
                policyId: policy.id,
                snapshot: jsonStringify({
                    recommendations: { events: [event] },
                }),
            } as unknown as Prisma.PolicyStateCurrentUncheckedCreateInput,
        }).catch(() => undefined);

        void AuditLogger.log(
            policy.id,
            'POLICY',
            'RECO.EVENT',
            'customer',
            'USER',
            event,
            'Customer'
        );

        // Persist to reco_events table (if available)
        try {
            const maybeRecoEvent = (asRecord(prisma).recoEvent as { create?: (args: unknown) => Promise<unknown> } | undefined);
            if (maybeRecoEvent && typeof maybeRecoEvent.create === 'function') {
                await maybeRecoEvent.create({
                    data: {
                        tenantId,
                        productType: 'MOTOR',
                        policyId: policy.id,
                        quoteRef: event.quoteRef || undefined,
                        type: String(event.type),
                        artifactVersion: event.artifactVersion || undefined,
                        modelKey: event.modelKey || undefined,
                        shownBundleIds: event.shownBundleIds || undefined,
                        selectedBundleId: event.selectedBundleId || undefined,
                        uiContext: event.uiContext || undefined,
                        occurredAt: new Date(nowIso),
                    },
                });
            }
        } catch {
            // best-effort
        }

        // Bandit update (guarded by env + schema presence). Default reward is purchase, so select updates are opt-in.
        const rewardType = String(process.env.RECS_BANDIT_REWARD || 'purchase').toLowerCase() === 'select' ? 'select' : 'purchase';
        if (rewardType === 'select' && type === 'select' && event.selectedBundleId) {
            await updateBanditFromEvent({
                tenantId,
                productType: 'MOTOR',
                rewardType: 'select',
                selectedBundleId: event.selectedBundleId,
                shownBundleIds: event.shownBundleIds,
            });
        }

        return res.json({ success: true, data: { receivedAt: nowIso } });
    } catch (e) {
        if (e instanceof TenantResolutionError) {
            return res.status(e.statusCode).json({ success: false, error: { code: e.code, message: e.message } });
        }
        return sendPublicError(res, e, 'Reco event failed');
    }
}
