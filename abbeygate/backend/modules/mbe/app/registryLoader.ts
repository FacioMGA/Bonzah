/**
 * MagicB Registry Loader — Prisma-backed data fetcher.
 *
 * CHAMPS: Extracted from domain/magicb/registry.ts to keep domain pure.
 * The registry owns indexing and lookup; this loader fetches from DB.
 */
import { prisma } from '../../../platform/db/connection.js';
import { Registry } from '../domain/magicb/registry.js';

/**
 * Fetches slugs, mappings, and rules from the database, then hydrates the registry.
 * Call once at system startup.
 */
export async function loadRegistryFromDb(): Promise<void> {
    const [dbSlugs, dbMappings, dbRules] = await Promise.all([
        prisma.magicB_Slug.findMany(),
        prisma.magicB_StorageMapping.findMany(),
        prisma.magicB_Rule.findMany(),
    ]);

    Registry.hydrate({
        slugs: dbSlugs as Record<string, unknown>[],
        mappings: dbMappings as Record<string, unknown>[],
        rules: dbRules as Record<string, unknown>[],
    });
}
