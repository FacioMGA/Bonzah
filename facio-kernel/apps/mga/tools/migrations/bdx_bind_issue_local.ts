import jwt from 'jsonwebtoken';
import { prisma } from '../backend/db/connection.js';

async function main() {
  const secret = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
  const admin = await prisma.user.findFirst({
    where: { isActive: true, role: 'ADMIN' },
    select: { id: true, tokenVersion: true },
  });
  if (!admin) throw new Error('No active admin user found');
  const token = jwt.sign({ id: admin.id, tokenVersion: admin.tokenVersion }, secret, { expiresIn: '2h' });

  const recent = await prisma.policy.findMany({
    where: {
      policyNumber: { startsWith: 'ABQ10000' },
      status: 'QUOTED',
      createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    },
    select: { id: true, policyNumber: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  const results: Array<{ policyNumber: string; statusCode: number; ok: boolean; response: unknown }> = [];
  for (const p of recent) {
    const res = await fetch(`http://localhost:3000/api/policies/${p.id}/bind`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    results.push({ policyNumber: p.policyNumber, statusCode: res.status, ok: res.ok, response: body });
  }

  console.log(JSON.stringify({ totalCandidates: recent.length, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
