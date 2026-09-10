import { prisma } from '../../../platform/db/connection.js';
import crypto from 'crypto';

type Arm = { bundleId: string; successes: number; failures: number };

function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function gammaSample(k: number, theta = 1): number {
  if (k < 1) {
    const u = Math.random();
    return gammaSample(1 + k, theta) * Math.pow(u, 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = randn();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.331 * Math.pow(x, 4)) return d * v * theta;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * theta;
  }
}

function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha, 1);
  const y = gammaSample(beta, 1);
  return x / (x + y);
}

export function shouldApplyBandit(): boolean {
  const enabled = String(process.env.RECS_BANDIT_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return false;
  const pct = Math.max(0, Math.min(1, Number(process.env.RECS_BANDIT_PERCENT ?? 1)));
  return Math.random() < pct;
}

export function bucketGate(seed: string, pct: number): boolean {
  const p = Math.max(0, Math.min(1, Number(pct)));
  if (p <= 0) return false;
  if (p >= 1) return true;
  const h = crypto.createHash('sha256').update(String(seed || ''), 'utf8').digest('hex');
  const x = parseInt(h.slice(0, 8), 16);
  const u = x / 0xffffffff;
  return u < p;
}

export function shouldApplyBanditForSeed(seed: string): boolean {
  const enabled = String(process.env.RECS_BANDIT_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return false;
  const pct = Math.max(0, Math.min(1, Number(process.env.RECS_BANDIT_PERCENT ?? 1)));
  return bucketGate(seed, pct);
}

export async function banditReRank(args: {
  tenantId: string;
  productType: string;
  bundleIds: string[];
}): Promise<Array<{ bundleId: string; sample: number }>> {
  const { tenantId, productType } = args;
  const ids = (args.bundleIds || []).map(String).filter(Boolean);
  if (ids.length === 0) return [];

  const client = prisma as {
    recoBanditArm?: {
      findMany: (args: unknown) => Promise<Arm[]>;
    };
  };
  if (!client?.recoBanditArm) {
    return ids.map((bundleId) => ({ bundleId, sample: 0 }));
  }

  const armsRaw: Arm[] = await client.recoBanditArm.findMany({
    where: { tenantId, productType, bundleId: { in: ids } },
    select: { bundleId: true, successes: true, failures: true },
  });
  const byId = new Map<string, Arm>(armsRaw.map((a) => [String(a.bundleId), a]));

  return ids.map((bundleId) => {
    const arm = byId.get(bundleId);
    const a = (arm?.successes ?? 0) + 1;
    const b = (arm?.failures ?? 0) + 1;
    const sample = betaSample(Math.max(1, a), Math.max(1, b));
    return { bundleId, sample };
  });
}

export async function updateBanditFromEvent(args: {
  tenantId: string;
  productType: string;
  rewardType: 'select' | 'purchase';
  selectedBundleId: string;
  shownBundleIds?: string[];
}): Promise<void> {
  const client = prisma as {
    recoBanditArm?: unknown;
    $transaction?: <T>(
      fn: (tx: { recoBanditArm: { upsert: (args: unknown) => Promise<unknown> } }) => Promise<T>,
    ) => Promise<T>;
  };
  if (!client?.recoBanditArm) return;
  const tenantId = String(args.tenantId || '').trim();
  const productType = String(args.productType || '').trim();
  if (!productType) return;
  if (!tenantId) throw new Error('tenantId is required for bandit updates');
  const selected = String(args.selectedBundleId || '').trim();
  if (!selected) return;

  const shown = Array.isArray(args.shownBundleIds) ? args.shownBundleIds.map(String).filter(Boolean) : [];
  const others = shown.filter((x) => x !== selected);

  await client
    .$transaction?.(async (tx) => {
      await tx.recoBanditArm.upsert({
        where: { tenantId_productType_bundleId: { tenantId, productType, bundleId: selected } },
        update: { successes: { increment: 1 } },
        create: { tenantId, productType, bundleId: selected, successes: 1, failures: 0 },
      });

      if (args.rewardType === 'select' && others.length) {
        for (const b of others.slice(0, 12)) {
          await tx.recoBanditArm.upsert({
            where: { tenantId_productType_bundleId: { tenantId, productType, bundleId: b } },
            update: { failures: { increment: 1 } },
            create: { tenantId, productType, bundleId: b, successes: 0, failures: 1 },
          });
        }
      }
    })
    .catch(() => undefined);
}
