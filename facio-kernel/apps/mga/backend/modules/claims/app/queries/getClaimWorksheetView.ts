import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { buildClaimWorksheetProjection } from '../../domain/worksheetProjection.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function getClaimWorksheetView(claimId: string) {
  const claim = await tenantScopedPrisma.claim.findUnique({
    where: { id: claimId },
    include: { events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!claim) return null;
  const projection = buildClaimWorksheetProjection({
    claimId: claim.id,
    claimReference: claim.claimNumber,
    certificateReference: String(asRecord(claim.data).cr0029_certificate_reference || ''),
    events: claim.events,
  });
  return {
    claimId: claim.id,
    worksheet: projection,
  };
}
