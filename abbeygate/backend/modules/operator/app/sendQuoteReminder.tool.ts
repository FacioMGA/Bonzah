import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { sendQuoteReminder } from './sendQuoteReminder.js';

const InputSchema = z.object({ policyId: z.string().trim().min(1) }).strict();
const OutputSchema = z.object({
    ok: z.boolean(),
    status: z.string(),
    summary: z.string(),
    action_id: z.string().optional(),
    correlation_id: z.string().optional(),
    entities: z.record(z.string(), z.string().optional()).optional(),
    next_actions: z.array(z.string()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
});

export const sendQuoteReminderTool: ToolDescriptor<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
    name: 'operator.send_quote_reminder',
    family: 'operator',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    requiredPermission: 'operator.comm',
    description:
        'INTERNAL BACK-OFFICE TOOL for licensed Lloyd\u2019s MGA underwriters. Re-sends the original resume-link of an EXISTING in-progress quote (QUOTED / REFERRAL / INFO_REQUIRED / PRICED / PAYMENT_PENDING) to the customer on file. Uses the pre-approved QUOTE_FOLLOW_UP template (no free-text). Idempotent and audited (OPERATOR.COMM_SENT). The recipient is the same customer who started the quote \u2014 not a new contact, never a cold-outreach.',
    auditClass: 'comm',
    run: async (input, ctx) => sendQuoteReminder(input, ctx),
};
