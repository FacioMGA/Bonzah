/**
 * Program Product Config Repository — Prisma-backed persistence.
 *
 * CHAMPS: Extracted from domain/programProduct.ts to keep domain pure.
 * The domain module owns normalization and resolution logic;
 * this repo handles reads/writes to the database.
 */
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { Prisma } from '@prisma/client';
import { normalizeProgramMbeProductConfig, type ProgramMbeProductConfigV1 } from '../domain/programProduct.js';

type UnknownRecord = Record<string, unknown>;
const asRecord = (x: unknown): UnknownRecord =>
    Boolean(x) && typeof x === 'object' && !Array.isArray(x) ? (x as UnknownRecord) : {};

export async function getOrInitProgramMbeProductConfig(programId: string): Promise<ProgramMbeProductConfigV1> {
    const program = await tenantScopedPrisma.program.findUnique({
        where: { id: programId },
        select: { id: true, metadata: true, productType: true },
    });
    if (!program) throw new Error('Program not found');

    const meta = asRecord(program.metadata);
    const existing = meta.mbeProductConfig;
    const normalized = normalizeProgramMbeProductConfig(existing, {
        productType: String(program.productType || '').trim().toUpperCase() || undefined,
        programCode: String(asRecord(existing).programCode || '').trim() || undefined,
    });

    const normalizedJson = JSON.stringify(normalized);
    const existingJson = JSON.stringify(existing ?? null);

    if (!existing || normalizedJson !== existingJson) {
        // Persist defaults once, so operators can see/edit a real config rather than implicit behavior.
        const nextMeta = { ...meta, mbeProductConfig: normalized };
        await tenantScopedPrisma.program.update({
            where: { id: programId },
            data: { metadata: JSON.parse(JSON.stringify(nextMeta)) as Prisma.InputJsonValue },
        });
    }

    return normalized;
}

export async function saveProgramMbeProductConfig(programId: string, cfg: unknown): Promise<ProgramMbeProductConfigV1> {
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, metadata: true, productType: true } });
    if (!program) throw new Error('Program not found');
    const normalized = normalizeProgramMbeProductConfig(cfg, {
        productType: String(program.productType || '').trim().toUpperCase() || undefined,
        programCode: String(asRecord(cfg).programCode || '').trim() || undefined,
    });
    const nextMeta = { ...asRecord(program.metadata), mbeProductConfig: normalized };
    await tenantScopedPrisma.program.update({
        where: { id: programId },
        data: { metadata: JSON.parse(JSON.stringify(nextMeta)) as Prisma.InputJsonValue },
    });
    return normalized;
}
