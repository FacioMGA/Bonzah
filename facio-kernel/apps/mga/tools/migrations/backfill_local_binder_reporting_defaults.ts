import { prisma } from '../../backend/platform/db/connection.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

async function main() {
  const apply = process.argv.includes('--apply');
  const binders = await prisma.binder.findMany({
    select: {
      id: true,
      agreementNumber: true,
      coverholderPin: true,
      config: true,
    },
  });

  const target = binders.filter((b) => String(b.agreementNumber || '').toUpperCase() === 'ABBEYGATE0125');
  let updates = 0;
  for (const binder of target) {
    const cfg = asRecord(binder.config);
    const reporting = asRecord(cfg.reporting);
    const nextConfig: UnknownRecord = {
      ...cfg,
      reporting: {
        ...reporting,
        lloydsPlatform: String(reporting.lloydsPlatform || 'LBS').trim().toUpperCase(),
        territory: String(reporting.territory || 'CYPRUS').trim().toUpperCase(),
      },
    };

    const nextPin = '115933OFE';
    const changed = JSON.stringify(nextConfig) !== JSON.stringify(cfg) || nextPin !== String(binder.coverholderPin || '');
    if (!changed) continue;

    updates += 1;
    if (apply) {
      await prisma.binder.update({
        where: { id: binder.id },
        data: {
          coverholderPin: nextPin,
          config: nextConfig as object,
        },
      });
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        scanned: binders.length,
        target: target.length,
        updates,
      },
      null,
      2
    ) + '\n'
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

