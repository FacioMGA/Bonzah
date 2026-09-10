import { logger } from '../utils/logger.js';

export type NonHttpBootstrapDeps = {
  ensureDbIndexes: () => Promise<void>;
  startEventSystem: () => Promise<void>;
  ensureDefaultProgram: () => Promise<void>;
  loadMbeRegistry: () => Promise<void>;
  ensureMbeTemplatesSeeded: () => Promise<void>;
  seedAccessControlPermissions: () => Promise<void>;
  initPdfWorker: () => Promise<void>;
};

async function safe(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.error({ err: e }, `${label} failed (non-fatal):`);
  }
}

export async function runNonHttpBootstraps(deps: NonHttpBootstrapDeps): Promise<void> {
  // Event system must start first (workers may depend on queue connectivity).
  await safe('Event system bootstrap', deps.startEventSystem);

  // Independent bootstraps run in parallel for faster startup.
  await Promise.all([
    safe('DB index bootstrap', deps.ensureDbIndexes),
    safe('Program bootstrap', deps.ensureDefaultProgram),
    safe('MBE registry load', deps.loadMbeRegistry),
    safe('Access control permission seed', deps.seedAccessControlPermissions),
    safe('PDF worker init', deps.initPdfWorker),
  ]);

  // MBE template seeding depends on registry being loaded, so runs after.
  try {
    await deps.ensureMbeTemplatesSeeded();
  } catch (error: unknown) {
    const prismaCode = (error as { code?: string })?.code;
    const prismaTable = (error as { meta?: { table?: string } })?.meta?.table;
    const isMissingTable = prismaCode === 'P2021';
    const isMbeTable =
      typeof prismaTable === 'string' &&
      (prismaTable.includes('endorsement_templates_mbe') ||
        prismaTable.includes('endorsement_instances_mbe') ||
        prismaTable.includes('endorsement_bundles_mbe'));

    if (isMissingTable && isMbeTable) {
      logger.error(
        { prismaCode, prismaTable },
        'MBE: Skipping template seeding — required DB tables are missing. Run `prisma db push` against DATABASE_URL.',
      );
    } else {
      logger.error({ err: error }, 'MBE template seeding failed (non-fatal):');
    }
  }
}
