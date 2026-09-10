/**
 * Staging CrashLoop (AKS Deploy Staging, SHA d090b8ceca9d):
 * `PolicyReportQuerySchema.omit({ format: true })` threw at module load
 * because Zod 4 forbids `.omit()` on object schemas that already have
 * refinements. Importing the router is the boot hop.
 */
import { describe, expect, it } from 'vitest';

describe('operationalReportsRouter boot', () => {
  it('loads without throwing on Zod omit + superRefine', async () => {
    await expect(
      import('../reportsRouter/operationalReportsRouter.js'),
    ).resolves.toBeDefined();
  });
});
