import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted; mock functions must be created via vi.hoisted so they
// exist before the mock factory runs.
const { programFindUnique, programFindMany, binderFindUnique, programBinderLinkFindFirst, programBinderLinkFindMany } = vi.hoisted(() => ({
  programFindUnique: vi.fn(),
  programFindMany: vi.fn(),
  binderFindUnique: vi.fn(),
  programBinderLinkFindFirst: vi.fn(),
  programBinderLinkFindMany: vi.fn(),
}));

vi.mock('../../../../../platform/db/connection.js', () => ({
  prisma: {
    programBinderLink: {
      findFirst: programBinderLinkFindFirst,
      findMany: programBinderLinkFindMany,
    },
  },
  tenantScopedPrisma: {
    program: {
      findUnique: programFindUnique,
      findMany: programFindMany,
    },
    binder: {
      findUnique: binderFindUnique,
    },
  },
}));

// Imported AFTER the mock so the module under test sees the mocked Prisma.
const { resolveBinderForEvaluation, resolveProgramBinder } = await import('../bdxImportContext.js');

const MOTOR_PROGRAM = { id: 'prog-motor', name: 'Abbeygate Motor', status: 'ACTIVE', productType: 'MOTOR', updatedAt: new Date('2026-01-01') };
const HOME_PROGRAM = { id: 'prog-home', name: 'Abbeygate Home', status: 'ACTIVE', productType: 'HOME', updatedAt: new Date('2026-02-01') };
const TRAVEL_PROGRAM = { id: 'prog-travel', name: 'Abbeygate Travel', status: 'ACTIVE', productType: 'TRAVEL', updatedAt: new Date('2026-05-01') };

const MOTOR_BINDER = { id: 'binder-motor', status: 'ACTIVE' };
const HOME_BINDER = { id: 'binder-home', status: 'ACTIVE' };
const TRAVEL_BINDER = { id: 'binder-travel', status: 'ACTIVE' };
const TRAVEL_2024_BINDER = {
  id: 'TRAVEL-24EEA6153',
  status: 'EXPIRED',
  startDate: new Date('2024-11-15T00:00:00.000Z'),
  endDate: new Date('2025-11-14T23:59:59.999Z'),
};
const TRAVEL_2025_BINDER = {
  id: 'TRAVEL-25EEA6153',
  status: 'ACTIVE',
  startDate: new Date('2025-11-15T00:00:00.000Z'),
  endDate: new Date('2026-11-14T23:59:59.999Z'),
};

function programLookup(productType: string) {
  if (productType === 'MOTOR') return [MOTOR_PROGRAM];
  if (productType === 'HOME') return [HOME_PROGRAM];
  if (productType === 'TRAVEL') return [TRAVEL_PROGRAM];
  return [];
}

function binderForProgram(programId: string) {
  if (programId === MOTOR_PROGRAM.id) return MOTOR_BINDER;
  if (programId === HOME_PROGRAM.id) return HOME_BINDER;
  if (programId === TRAVEL_PROGRAM.id) return TRAVEL_BINDER;
  return null;
}

beforeEach(() => {
  programFindUnique.mockReset();
  programFindMany.mockReset();
  binderFindUnique.mockReset();
  programBinderLinkFindFirst.mockReset();
  programBinderLinkFindMany.mockReset();

  programFindMany.mockImplementation(async ({ where }: { where: { productType?: string; status: string } }) => {
    if (where.status !== 'ACTIVE') return [];
    return programLookup(String(where.productType || ''));
  });
  programFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    return [MOTOR_PROGRAM, HOME_PROGRAM, TRAVEL_PROGRAM].find((p) => p.id === where.id) || null;
  });
  programBinderLinkFindMany.mockImplementation(async ({ where }: { where: { programId: string; status: string } }) => {
    const binder = binderForProgram(where.programId);
    return binder ? [{ binder }] : [];
  });
});

describe('resolveProgramBinder', () => {
  it('motor BDX job resolves the MOTOR program/binder', async () => {
    const out = await resolveProgramBinder({ productType: 'MOTOR' });
    expect(out.program?.id).toBe(MOTOR_PROGRAM.id);
    expect(out.binders.map((b: { id: string }) => b.id)).toEqual([MOTOR_BINDER.id]);
    expect(out.linkOk).toBe(true);
  });

  it('home BDX job resolves the HOME program/binder', async () => {
    const out = await resolveProgramBinder({ productType: 'HOME' });
    expect(out.program?.id).toBe(HOME_PROGRAM.id);
    expect(out.binders.map((b: { id: string }) => b.id)).toEqual([HOME_BINDER.id]);
  });

  it('travel BDX job resolves the TRAVEL program/binder', async () => {
    const out = await resolveProgramBinder({ productType: 'TRAVEL' });
    expect(out.program?.id).toBe(TRAVEL_PROGRAM.id);
    expect(out.binders.map((b: { id: string }) => b.id)).toEqual([TRAVEL_BINDER.id]);
  });

  it('keeps date-valid historical binders available for BDX replay', async () => {
    programBinderLinkFindMany.mockResolvedValueOnce([
      { status: 'ACTIVE', binder: TRAVEL_2025_BINDER },
      { status: 'EXPIRED', binder: TRAVEL_2024_BINDER },
      { status: 'ACTIVE', binder: { id: 'TRAVEL-DRAFT', status: 'DRAFT' } },
    ]);

    const out = await resolveProgramBinder({ productType: 'TRAVEL' });

    expect(programBinderLinkFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        programId: TRAVEL_PROGRAM.id,
        status: { in: ['ACTIVE', 'EXPIRED', 'PENDING'] },
      },
    }));
    expect(out.binders.map((b: { id: string }) => b.id)).toEqual([
      TRAVEL_2025_BINDER.id,
      TRAVEL_2024_BINDER.id,
    ]);
  });

  it('selects the binder whose window contains the BDX inception date', () => {
    const binder = resolveBinderForEvaluation({
      evaluation: {
        dto: { inceptionDate: '2025-07-01T00:00:00.000Z' },
      },
      binders: [TRAVEL_2025_BINDER, TRAVEL_2024_BINDER],
    });

    expect(binder?.id).toBe(TRAVEL_2024_BINDER.id);
  });

  it('does NOT pick the most recently updated ACTIVE program when productType differs (May 2026 regression)', async () => {
    // Travel was the most recently updated ACTIVE program on staging — the old
    // code returned it for every BDX commit. With productType plumbed through,
    // a MOTOR job must never resolve to the Travel program.
    const out = await resolveProgramBinder({ productType: 'MOTOR' });
    expect(out.program?.productType).toBe('MOTOR');
    expect(out.program?.id).not.toBe(TRAVEL_PROGRAM.id);
  });

  it('refuses to guess when productType matches multiple ACTIVE programs', async () => {
    programFindMany.mockResolvedValueOnce([MOTOR_PROGRAM, { ...MOTOR_PROGRAM, id: 'prog-motor-2' }]);
    const out = await resolveProgramBinder({ productType: 'MOTOR' });
    expect(out.program).toBeNull();
    expect(out.binders).toEqual([]);
    expect(out.linkOk).toBe(false);
  });

  it('returns no program when productType matches zero ACTIVE programs', async () => {
    programFindMany.mockResolvedValueOnce([]);
    const out = await resolveProgramBinder({ productType: 'PET' });
    expect(out.program).toBeNull();
  });

  it('returns no program when neither programId nor productType is supplied', async () => {
    const out = await resolveProgramBinder({});
    expect(out.program).toBeNull();
    expect(out.binders).toEqual([]);
    expect(programFindMany).not.toHaveBeenCalled();
  });

  it('honours an explicit programId without consulting productType', async () => {
    const out = await resolveProgramBinder({ programId: HOME_PROGRAM.id, productType: 'MOTOR' });
    expect(out.program?.id).toBe(HOME_PROGRAM.id);
    expect(programFindMany).not.toHaveBeenCalled();
  });

  it('honours an explicit binderId only when it is linked to the resolved program', async () => {
    binderFindUnique.mockResolvedValueOnce(MOTOR_BINDER);
    programBinderLinkFindFirst.mockResolvedValueOnce({ id: 'link-1' });
    const ok = await resolveProgramBinder({ programId: MOTOR_PROGRAM.id, binderId: MOTOR_BINDER.id });
    expect(ok.linkOk).toBe(true);
    expect(ok.binders.map((b: { id: string }) => b.id)).toEqual([MOTOR_BINDER.id]);

    binderFindUnique.mockResolvedValueOnce(TRAVEL_BINDER);
    programBinderLinkFindFirst.mockResolvedValueOnce(null);
    const bad = await resolveProgramBinder({ programId: MOTOR_PROGRAM.id, binderId: TRAVEL_BINDER.id });
    expect(bad.linkOk).toBe(false);
    expect(bad.binders).toEqual([]);
  });
});
