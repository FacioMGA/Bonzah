import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { z } from 'zod';
import { reserveNextClaimNumber } from '../../../platform/utils/platformIds.js';
import { actorFromRequest, getMethod, parseRecord } from '../app/shared.js';
import {
  computeFnolRiskFlags,
  normalizeCanonicalIntake,
  resolveClaimsContractFromProgram,
} from '../app/claimsInterop.js';

import { logger } from '../../../platform/utils/logger.js';
function policyAuditLog(req: Request, _res: Response, next: NextFunction): void {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
    const textUser = req.user;
    const actorId = textUser?.id || 'system';
    const actorType = textUser?.role || 'SYSTEM';
    req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
    next();
  } catch {
    next();
  }
}

export function registerPolicyClaimRoutes(router: Router) {
  function extractNamedDrivers(policyQuoteData: unknown): Array<{ id: string; name: string }> {
    const qd = parseRecord(policyQuoteData);
    const out: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    const push = (idRaw: unknown, nameRaw: unknown, idx = 0) => {
      const name = String(nameRaw || '').trim();
      if (!name) return;
      const id = String(idRaw || '').trim() || `driver-${idx}-${name.toLowerCase()}`;
      const key = `${id}|${name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id, name });
    };
    const proposer = parseRecord(qd.proposer);
    const baseName = [String(proposer.firstName || '').trim(), String(proposer.lastName || '').trim()].filter(Boolean).join(' ');
    if (baseName) push('policyholder-driver', baseName);
    const arr = Array.isArray(qd.namedDrivers) ? qd.namedDrivers : Array.isArray(qd.drivers) ? qd.drivers : [];
    arr.forEach((x, idx) => {
      if (typeof x === 'string') push('', x, idx);
      else {
        const rec = parseRecord(x);
        push(rec.id, rec.name ?? rec.fullName ?? rec.driverName, idx);
      }
    });
    return out;
  }

  /**
   * POST /api/policies/:id/claims (FNOL)
   * First Notice of Loss - Submit a Claim
   */
  router.post('/:id/claims', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      // `spine/v2` Wave 5: this endpoint accepts ONLY the canonical
      // FNOL intake shape now. Pre-Wave 5 the body had a parallel
      // shape with flat `incidentDate / description / lossLocation /
      // contact / vehicleId` aliases plus a nested `fnol` object that
      // duplicated the canonical layout. The reviewer flagged that as
      // drift surface — the FE was emitting both, the BE was reading
      // both, and `normalizeCanonicalIntake` had a 60-line alias-
      // resolution function to cope. Now: one shape, end-to-end.
      const BodySchema = z.object({
        form: z.record(z.string(), z.unknown()),
        vehicleId: z.string().trim().optional(),
      });

      const parsed = BodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid request body', details: parsed.error.flatten() } });
      }

      const { form, vehicleId } = parsed.data;

      const policy = await tenantScopedPrisma.policy.findUnique({ where: { id } });
      if (!policy) return res.status(404).json({ success: false, error: 'Policy not found' });
      const namedDrivers = extractNamedDrivers(policy.quoteData);
      const fnolPayload = normalizeCanonicalIntake(form);
      const incidentDateStr = fnolPayload.incident.date;
      const description = fnolPayload.incident.description || '';
      if (description.length < 10) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'incident.description must be at least 10 characters' } });
      }
      const lossLocation = fnolPayload.incident.location.address || null;
      const reporterContact = {
        phone: fnolPayload.driver.contact.phone || null,
        email: fnolPayload.driver.contact.email || null,
      };

      const riskFlags = computeFnolRiskFlags({
        fnol: fnolPayload,
        policyQuoteData: policy.quoteData,
        namedDrivers,
      });

      const incidentAt = incidentDateStr ? new Date(incidentDateStr) : new Date();
      if (Number.isNaN(incidentAt.getTime())) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid incident.date' } });
      }

      const actor = actorFromRequest(req);

      const claim = await tenantScopedPrisma.$transaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        const claimNumber = await reserveNextClaimNumber(tx, incidentAt);
        const claimCreate = getMethod(Reflect.get(tx, 'claim'), 'create');
        if (!claimCreate) throw new Error('Claim delegate unavailable');
        const createdClaim = await claimCreate({
          data: {
            policyId: id,
            claimNumber,
            incidentDate: incidentAt,
            reportedDate: new Date(),
            status: riskFlags.requiresReferral ? 'QUERIED' : 'PENDING',
            claimType: 'FNOL',
            description,
            data: {
              fnol: {
                ...fnolPayload,
                vehicleId: vehicleId ? String(vehicleId) : null,
                lossLocation,
                contact: reporterContact,
                riskFlags,
                receivedAt: new Date().toISOString(),
                submittedAt: new Date().toISOString(),
                channel: actor ? 'BO' : 'CUSTOMER',
              }
            },
            documents: [],
          }
        });
        if (riskFlags.requiresReferral) {
          const infoReqCreate = getMethod(Reflect.get(tx, 'claimInfoRequest'), 'create');
          await Promise.resolve(infoReqCreate?.({
            data: {
              claimId: String(parseRecord(createdClaim).id || ''),
              message: `Auto referral triggered: ${(riskFlags.notes || []).join(', ') || 'Risk review required'}`,
              requestedByUserId: actor?.id || null,
              status: 'OPEN',
            },
          })).catch(() => undefined);
        }
        return createdClaim;
      });
      const claimRecord = parseRecord(claim);

      void AuditLogger.log(
        id,
        'POLICY',
        'CLAIM.SUBMITTED',
        actor?.id || 'customer',
        actor ? 'USER' : 'SYSTEM',
        { claimId: claimRecord.id, claimNumber: claimRecord.claimNumber, incidentDate: incidentAt.toISOString(), vehicleId, lossLocation },
        actor?.name || 'Customer'
      );

      return res.json({ success: true, data: { claimId: claimRecord.id, claimNumber: claimRecord.claimNumber, status: claimRecord.status } });

    } catch (error) {
      logger.error({ err: error }, 'FNOL error:');
      return res.status(500).json({ success: false, error: 'Failed to submit claim' });
    }
  });

  router.get('/:id/claims/contract', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const policy = await tenantScopedPrisma.policy.findUnique({
        where: { id: String(id) },
        include: { program: true, policyHolder: true },
      });
      if (!policy) return res.status(404).json({ success: false, error: 'Policy not found' });

      const actor = actorFromRequest(req);
      if (String(actor?.role ?? '').toUpperCase() === 'CUSTOMER') {
        const primaryAccountId = String(actor?.primaryAccountId ?? '').trim();
        const ownsByAccount = primaryAccountId && String(policy.accountId ?? '') === primaryAccountId;
        const email = String(actor?.email ?? '').trim().toLowerCase();
        const contact = String(policy.policyHolder?.contact ?? '').toLowerCase();
        const ownsByEmail = Boolean(email) && contact.includes(email);
        if (!ownsByAccount && !ownsByEmail) {
          return res.status(403).json({ success: false, error: 'Access denied' });
        }
      }

      const contract = resolveClaimsContractFromProgram({
        productType: policy.productType,
        programMetadata: policy.program?.metadata,
      });
      return res.json({
        success: true,
        data: {
          policyId: policy.id,
          productType: policy.productType,
          programId: policy.programId,
          contract,
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Policy claims contract error:');
      return res.status(500).json({ success: false, error: 'Failed to load claims contract' });
    }
  });
}

