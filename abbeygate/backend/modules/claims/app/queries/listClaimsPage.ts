import { tenantScopedPrisma } from '../../../../platform/db/connection.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function summarizeClaim(claim: {
  id: string;
  claimNumber: string;
  status: string;
  policyId?: string | null;
  description?: string | null;
  incidentDate?: Date | string | null;
  reportedDate?: Date | string | null;
  updatedAt?: Date | string | null;
  data: unknown;
  policy?: { policyNumber?: string | null; policyHolder?: { name?: string | null; contact?: string | null } | null } | null;
}) {
  const data = asRecord(claim.data);
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    status: claim.status,
    policyId: claim.policyId,
    policyNumber: String(claim.policy?.policyNumber || ''),
    policyHolderName: String(claim.policy?.policyHolder?.name || ''),
    incidentDate: claim.incidentDate ? new Date(String(claim.incidentDate)).toISOString() : '',
    reportedDate: claim.reportedDate ? new Date(String(claim.reportedDate)).toISOString() : '',
    updatedAt: claim.updatedAt ? new Date(String(claim.updatedAt)).toISOString() : '',
    summary: {
      incidentDate: String(data.cr0119_date_of_loss_from || ''),
      lossCountry: String(data.cr0116_loss_country || ''),
      causeOfLossCode: String(data.cr0117_cause_of_loss_code || ''),
      lossDescription: String(data.cr0118_loss_description || ''),
      description: String(claim.description || data.cr0118_loss_description || ''),
      certificateReference: String(data.cr0029_certificate_reference || ''),
      originalCurrency: String(data.cr0109_original_currency || 'EUR'),
    },
  };
}

export async function listClaimsPage(args: {
  page: number;
  pageSize: number;
  policyId?: string;
  policyIds?: string[];
  status?: string;
  statusIn?: string;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}) {
  const where: Record<string, unknown> = {};
  if (args.policyId) where.policyId = args.policyId;
  else if (args.policyIds && args.policyIds.length > 0) where.policyId = { in: args.policyIds };
  if (args.statusIn || args.status) {
    const statuses = [
      ...String(args.statusIn || '').split(',').map((s) => s.trim()).filter(Boolean),
      ...(args.status ? [args.status] : []),
    ];
    where.status = { in: Array.from(new Set(statuses.map((s) => s.toUpperCase()))) };
  }
  if (args.search) {
    where.OR = [
      { claimNumber: { contains: args.search, mode: 'insensitive' } },
      { status: { contains: args.search, mode: 'insensitive' } },
      { policy: { policyNumber: { contains: args.search, mode: 'insensitive' } } },
      { policy: { policyHolder: { name: { contains: args.search, mode: 'insensitive' } } } },
      { data: { path: ['cr0116_loss_country'], string_contains: args.search } },
      { data: { path: ['cr0117_cause_of_loss_code'], string_contains: args.search } },
      { data: { path: ['cr0118_loss_description'], string_contains: args.search } },
    ];
  }
  const sortDir = args.sortDir === 'asc' ? 'asc' : 'desc';
  const sortMap: Record<string, unknown> = {
    claimNumber: { claimNumber: sortDir },
    policyNumber: { policy: { policyNumber: sortDir } },
    policyHolderName: { policy: { policyHolder: { name: sortDir } } },
    incidentDate: { incidentDate: sortDir },
    reportedDate: { reportedDate: sortDir },
    updatedAt: { updatedAt: sortDir },
    status: { status: sortDir },
  };
  const orderBy = (sortMap[String(args.sortBy || '').trim()] || { reportedDate: 'desc' }) as never;

  const [items, total] = await Promise.all([
    tenantScopedPrisma.claim.findMany({
      where,
      orderBy,
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
      select: {
        id: true,
        claimNumber: true,
        status: true,
        policyId: true,
        description: true,
        incidentDate: true,
        reportedDate: true,
        updatedAt: true,
        data: true,
        policy: {
          select: {
            policyNumber: true,
            policyHolder: {
              select: {
                name: true,
                contact: true,
              },
            },
          },
        },
      },
    }),
    tenantScopedPrisma.claim.count({ where }),
  ]);
  return {
    items: items.map((item) => summarizeClaim(item)),
    total,
    totalPages: Math.ceil(total / args.pageSize),
  };
}
