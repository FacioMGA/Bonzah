import { PrismaClient } from '@prisma/client';
import { sendTimelineMessageEmail } from '../../backend/core/notifications/email.js';

const prisma = new PrismaClient();

async function run() {
  const p = await prisma.policy.findFirst({ where: { productType: 'MOTOR' } });
  if (!p) {
    console.log('No policies found.');
    return;
  }

  const admin = await prisma.user.findFirst();
  if (!admin) {
    console.log('No users found.');
    return;
  }

  console.log('Executing Email Dispatch');
  console.log(`Policy: ${p.id}, Agent: ${admin.name}`);

  const targetEmail = 'uriel@example.com'; // Use a sink/test email

  // Mock the exact structure extracted from API route mapping.
  let contactName = 'there';
  const qd = p.quoteData;
  if (qd && typeof qd === 'object' && qd.proposer && typeof qd.proposer === 'object' && 'firstName' in qd.proposer) {
    contactName = String(qd.proposer.firstName);
  }

  const result = await sendTimelineMessageEmail({
    toEmail: targetEmail,
    contactName,
    senderName: admin.name || 'Agent',
    messageBody:
      'Hello! Just reaching out to confirm we have received your latest documents and your policy has been fully updated with the new valuation.',
    policyId: p.id,
  });

  console.log(`SendGrid dispatch result: ${result ? 'SUCCESS' : 'FAILED'}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
