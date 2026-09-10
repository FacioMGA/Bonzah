import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { openApiRegistry, ErrorResponseSchema } from '../../../platform/openapi/openapi.js';
import { logger } from '../../../platform/utils/logger.js';
import { claimsHttpDeps } from '../app/httpConductorDeps.js';
import { resolveProgrammeClaimsContract } from '../app/resolveProgrammeClaimsContract.js';

const router = Router();

const ClaimStatusEnum = z.enum(['OPEN', 'UNDER_REVIEW', 'APPROVED', 'DENIED']);
const ClaimTypeEnum = z.enum(['THEFT', 'COLLISION', 'WINDSCREEN', 'FIRE', 'THIRD_PARTY']);

// `spine/v2` Wave 5 collapsed the public FNOL surface to one shape: the
// canonical `intake` block. The pre-Wave-5 contract carried four parallel
// fields (`incidentDate`, `claimType`, `description`, `fnolData`) plus a
// nested `fnolData.incident.*`, with the route doing alias resolution.
// The new contract is `{ policyId, intake }` where `intake` matches
// `CanonicalIntakeSchema` (see `backend/modules/claims/domain/intakeCanonical.ts`).
const FnolIntakeApiSchema = z.object({
    incident: z.object({
        type: z.string().describe('Incident type token, e.g. "collision", "theft", "windscreen".'),
        date: z.string().describe('ISO date (YYYY-MM-DD) when the incident occurred.'),
        time: z.string().nullable().optional(),
        location: z.object({
            address: z.string().nullable().optional(),
            city: z.string().nullable().optional(),
            country: z.string().nullable().optional(),
        }).optional(),
        description: z.string().min(10).max(2000),
    }),
    driver: z.record(z.string(), z.unknown()).optional(),
    thirdParty: z.record(z.string(), z.unknown()).optional(),
    police: z.record(z.string(), z.unknown()).optional(),
    triage: z.record(z.string(), z.unknown()).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    declarationAccepted: z.boolean().optional(),
}).passthrough();

const FnolRequestSchema = openApiRegistry.register('FnolRequest', z.object({
    policyId: z.string().uuid().describe('The ID of the policy this claim is against'),
    intake: FnolIntakeApiSchema.describe('Canonical FNOL intake payload (matches CanonicalIntakeSchema).'),
}).openapi({
    example: {
        policyId: "a7b2c300-44b0-4e0a-bf15-1d6789ccba02",
        intake: {
            incident: {
                type: "collision",
                date: "2026-05-15",
                time: "14:30",
                location: { address: "A3 Highway, Mile 4", city: "London", country: "UK" },
                description: "Rear-ended at a traffic light by a third party."
            },
            driver: { kind: "named", id: "driver-jane doe" },
            thirdParty: { involved: true, kinds: ["another_car"] },
            police: { involved: false },
            triage: { carDrivable: true, needTow: false, injuriesReported: false }
        }
    }
}));

const ClaimResponseSchema = openApiRegistry.register('ClaimResponse', z.object({
    id: z.string().uuid(),
    policyId: z.string().uuid(),
    claimNumber: z.string().describe('Human-readable serial number for the claim'),
    incidentDate: z.string().datetime(),
    reportedDate: z.string().datetime(),
    status: ClaimStatusEnum.describe('The current progression status of the claim'),
    claimType: ClaimTypeEnum.optional(),
    description: z.string().optional(),
}).openapi({
    example: {
        id: "c8c3d400-55c1-5f1b-cg26-2e7890ddcb03",
        policyId: "a7b2c300-44b0-4e0a-bf15-1d6789ccba02",
        claimNumber: "CLM-2026-00102",
        incidentDate: "2026-05-15T14:30:00.000Z",
        reportedDate: "2026-05-16T09:00:00.000Z",
        status: "OPEN",
        claimType: "COLLISION",
        description: "Third party rear-ended the insured vehicle at a traffic light."
    }
}));

openApiRegistry.registerPath({
    method: 'post',
    path: '/v1/claims',
    operationId: 'submitFnol',
    summary: 'File First Notice of Loss (FNOL)',
    description: 'Programmatically logs a new incident against an active policy, pushing it straight into the internal claims review workflow and returning the assigned claim reference.',
    tags: ['5. Claims (FNOL)'],
    request: {
        body: {
            content: { 'application/json': { schema: FnolRequestSchema } },
        },
    },
    responses: {
        201: {
            description: 'Claim successfully created',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: ClaimResponseSchema }) } },
        },
        400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        403: { description: 'Forbidden (Policy not owned by account)', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Policy not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/v1/claims/{claimId}/contract',
    operationId: 'getClaimContract',
    summary: 'Get product claim contract',
    description: 'Returns the dynamic claims contract resolved for the policy/product behind the claim.',
    tags: ['5. Claims (FNOL)'],
    request: {
        params: z.object({ claimId: z.string().uuid() }),
    },
    responses: {
        200: {
            description: 'Successful contract retrieval',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.object({
                            claimId: z.string().uuid(),
                            policyId: z.string().uuid(),
                            contract: z.record(z.string(), z.unknown()),
                        }),
                    }),
                },
            },
        },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Claim not found or unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/v1/claims/{claimId}',
    operationId: 'getClaim',
    summary: 'Poll Claim Status',
    description: 'Retrieves the current operational workflow status of an active claim within the back-office.',
    tags: ['5. Claims (FNOL)'],
    request: {
        params: z.object({ claimId: z.string().uuid() }),
    },
    responses: {
        200: {
            description: 'Successful retrieval of claim',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: ClaimResponseSchema }) } },
        },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Claim not found or unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

// POST /v1/claims (Submit FNOL)
router.post('/', async (req, res) => {
    try {
        // 1. Validate Request Body
        const parsed = FnolRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, error: parsed.error.format() });
        }
        const { policyId, intake } = parsed.data;
        const incidentDateString = String(intake.incident.date || '').trim();
        const incidentTimeString = String((intake.incident as Record<string, unknown>).time || '').trim();
        const incidentDateIso = incidentTimeString
            ? `${incidentDateString}T${incidentTimeString.length === 5 ? `${incidentTimeString}:00` : incidentTimeString}.000Z`
            : `${incidentDateString}T00:00:00.000Z`;
        const description = String(intake.incident.description || '');

        // 2. Validate Authentication & Policy Ownership
        const requestAccount = req.apiAccount;
        if (!requestAccount) {
            return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
        }

        const policy = await tenantScopedPrisma.policy.findFirst({
            where: { id: policyId, accountId: requestAccount.id },
            include: { program: true }
        });

        if (!policy) {
            return res.status(404).json({ success: false, error: { message: 'Policy not found or unauthorized' } });
        }

        // 3. Evaluate Dynamic Claims Contract
        const { validateGuidedFnolForm } = await import('../domain/claimsValidation.js');
        const { extractNamedDriversFromPolicy, resolveDriverRestrictionFromPolicy } = await import('../domain/claimsHelpers.js');

        const claimsContract = await resolveProgrammeClaimsContract({
            policyId: policy.id,
            productType: policy.productType,
            programId: policy.programId,
            binderId: policy.binderId,
        });

        const fnolValidation = validateGuidedFnolForm({
            form: intake as Record<string, unknown>,
            contract: claimsContract,
            policyId: String(policy.id),
            namedDrivers: extractNamedDriversFromPolicy(policy),
            driverRestriction: resolveDriverRestrictionFromPolicy(policy),
        });

        if (!fnolValidation.valid) {
            return res.status(400).json({
                success: false,
                error: {
                    message: 'FNOL validation failed. Please check the provided field errors.',
                    details: {
                        fieldErrors: fnolValidation.errors,
                        contractVersion: claimsContract.version,
                    },
                },
            });
        }

        // --- Idempotency Check: Prevent duplicate FNOL submissions ---
        const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();

        // 5. Perform transactional Claim creation to reserve serial safely
        const claim = await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
            if (idempotencyKey) {
                const existingList = await tx.claim.findMany({ where: { policyId } });
                const existing = existingList.find((c) => {
                    const d = (c.data && typeof c.data === 'object') ? (c.data as Record<string, unknown>) : {};
                    return d.idempotencyKey === idempotencyKey;
                });
                if (existing) return existing;
            }

            // Create Abbeygate sequence number based on incident
            const incidentAt = new Date(incidentDateIso);
            const claimNumber = await claimsHttpDeps.reserveNextClaimNumber(tx, incidentAt);

            const fnolDataToSave = { ...(intake as Record<string, unknown>), idempotencyKey: idempotencyKey || undefined };
            const incidentTypeToken = String(intake.incident.type || '').toLowerCase();
            const claimTypeFromIntake = incidentTypeToken === 'theft' ? 'THEFT'
                : incidentTypeToken === 'windscreen' ? 'WINDSCREEN'
                : incidentTypeToken === 'fire' ? 'FIRE'
                : incidentTypeToken === 'third_party' ? 'THIRD_PARTY'
                : 'COLLISION';

            const created = await tx.claim.create({
                data: {
                    policyId,
                    claimNumber,
                    incidentDate: incidentAt,
                    status: 'PENDING', // Initial status matching the BackOffice flow
                    claimType: claimTypeFromIntake,
                    description,
                    data: fnolDataToSave as Prisma.InputJsonValue,
                } as unknown as Prisma.ClaimUncheckedCreateInput,
            });

            const { enqueuePolicyListIndexUpdate } = await import('../../policy/infra/projections/policyListIndex.js');
            await enqueuePolicyListIndexUpdate(tx, String(policyId));

            return created;
        });

        const { AuditLogger } = await import('../../../platform/audit/logger.js');
        void AuditLogger.log(String(policyId), 'POLICY', 'CLAIM.SUBMITTED', requestAccount.id, 'SYSTEM', {
            claimNumber: claim.claimNumber,
        });

        const responseData = {
            id: claim.id,
            policyId: claim.policyId,
            claimNumber: claim.claimNumber,
            incidentDate: claim.incidentDate.toISOString(),
            reportedDate: claim.reportedDate.toISOString(),
            status: claim.status === 'NEW' ? 'OPEN' : claim.status, // Basic sanitize mapping
            claimType: claim.claimType ?? undefined,
            description: claim.description ?? undefined,
        };

        // Fire and forget webhook
        void claimsHttpDeps.dispatchWebhook(requestAccount.id, 'claim.created', responseData);

        // 4. Return Public Projection
        return res.status(201).json({
            success: true,
            data: responseData
        });

    } catch (err: unknown) {
        logger.error({ err }, 'Error in POST /v1/claims');
        return res.status(500).json({ success: false, error: { message: 'Failed to submit claim' } });
    }
});

// GET /v1/claims/:claimId (Status Check)
router.get('/:claimId', async (req, res) => {
    try {
        const claimId = req.params.claimId;
        const requestAccount = req.apiAccount;

        if (!requestAccount) {
            return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
        }

        // Strict traversal via Policy to ensure Tenant Isolation
        const claim = await tenantScopedPrisma.claim.findFirst({
            where: {
                id: claimId,
                policy: { accountId: requestAccount.id }
            }
        });

        if (!claim) {
            return res.status(404).json({ success: false, error: { message: 'Claim not found or unauthorized' } });
        }

        return res.json({
            success: true,
            data: {
                id: claim.id,
                policyId: claim.policyId,
                claimNumber: claim.claimNumber,
                incidentDate: claim.incidentDate.toISOString(),
                reportedDate: claim.reportedDate.toISOString(),
                status: claim.status === 'NEW' ? 'OPEN' : claim.status, // Basic sanitize mapping
                claimType: claim.claimType ?? undefined,
                description: claim.description ?? undefined,
            }
        });

    } catch (err) {
        logger.error({ err }, 'Error in GET /v1/claims/:id');
        return res.status(500).json({ success: false, error: { message: 'Failed to retrieve claim' } });
    }
});

router.get('/:claimId/contract', async (req, res) => {
    try {
        const claimId = req.params.claimId;
        const requestAccount = req.apiAccount;
        if (!requestAccount) {
            return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });
        }
        const claim = await tenantScopedPrisma.claim.findFirst({
            where: {
                id: claimId,
                policy: { accountId: requestAccount.id },
            },
            include: {
                policy: {
                    include: {
                        program: true,
                    },
                },
            },
        });
        if (!claim) {
            return res.status(404).json({ success: false, error: { message: 'Claim not found or unauthorized' } });
        }
        if (!claim.policy) {
            return res.status(404).json({ success: false, error: { message: 'Claim policy not linked' } });
        }
        const contract = await resolveProgrammeClaimsContract({
            policyId: claim.policy.id,
            productType: claim.policy.productType,
            programId: claim.policy.programId,
            binderId: claim.policy.binderId,
        });
        return res.json({
            success: true,
            data: {
                claimId: claim.id,
                policyId: claim.policyId,
                contract,
            },
        });
    } catch (err) {
        logger.error({ err }, 'Error in GET /v1/claims/:id/contract');
        return res.status(500).json({ success: false, error: { message: 'Failed to retrieve claim contract' } });
    }
});

export default router;
