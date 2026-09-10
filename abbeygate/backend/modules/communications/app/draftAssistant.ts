/**
 * Draft Assistant — generates message draft suggestions from thread context.
 *
 * Architecture: pluggable LLM provider. Currently ships with a context-aware
 * rule-based fallback. Wire in OpenAI/Azure/Anthropic by implementing
 * the LLMProvider interface and setting COMMS_LLM_PROVIDER env var.
 */
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';

// ── Provider Interface ──────────────────────────────────────────────────────

export interface LLMProvider {
    generateDrafts(prompt: string, options?: { count?: number }): Promise<string[]>;
}

// ── Context Gathering ───────────────────────────────────────────────────────

interface DraftContext {
    entityType: string;
    entityId: string;
    threadSummary: string;
    recentMessages: Array<{ direction: string; from: string; body: string; createdAt: string }>;
    entityData: Record<string, unknown>;
}

async function gatherContext(entityType: string, entityId: string, threadId?: string): Promise<DraftContext> {
    // Get recent thread messages
    const where = threadId
        ? { id: threadId }
        : { entityType, entityId };

    const thread = await prisma.communicationThread.findFirst({
        where,
        include: {
            messages: {
                orderBy: { createdAt: 'desc' },
                take: 10,
            },
        },
        orderBy: { lastActivityAt: 'desc' },
    });

    const recentMessages = (thread?.messages ?? []).map((m) => ({
        direction: m.direction,
        from: m.fromActor,
        body: m.body.slice(0, 300),
        createdAt: m.createdAt.toISOString(),
    }));

    // Gather entity context for enrichment
    let entityData: Record<string, unknown> = {};
    try {
        if (entityType === 'POLICY') {
            const policy = await tenantScopedPrisma.policy.findUnique({
                where: { id: entityId },
                select: {
                    policyNumber: true,
                    status: true,
                    inceptionDate: true,
                    expiryDate: true,
                    quoteData: true,
                },
            });
            if (policy) {
                const qd = policy.quoteData && typeof policy.quoteData === 'object'
                    ? policy.quoteData as Record<string, unknown>
                    : {};
                const proposer = (qd.proposer && typeof qd.proposer === 'object' ? qd.proposer : {}) as Record<string, unknown>;
                entityData = {
                    policyNumber: policy.policyNumber,
                    status: policy.status,
                    startDate: policy.inceptionDate,
                    endDate: policy.expiryDate,
                    insuredName: proposer.firstName ? `${proposer.firstName} ${proposer.lastName || ''}` : undefined,
                };
            }
        } else if (entityType === 'CLAIM') {
            const claim = await tenantScopedPrisma.claim.findUnique({
                where: { id: entityId },
                select: {
                    claimNumber: true,
                    status: true,
                    incidentDate: true,
                    description: true,
                },
            });
            if (claim) {
                entityData = {
                    claimNumber: claim.claimNumber,
                    status: claim.status,
                    incidentDate: claim.incidentDate,
                    description: claim.description?.slice(0, 200),
                };
            }
        }
    } catch {
        // Entity lookup is best-effort
    }

    const threadSummary = recentMessages.length > 0
        ? `Thread has ${recentMessages.length} recent messages. Last was ${recentMessages[0]?.direction} from ${recentMessages[0]?.from}.`
        : 'New conversation — no prior messages.';

    return { entityType, entityId, threadSummary, recentMessages, entityData };
}

// ── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(ctx: DraftContext, intent?: string): string {
    const entityInfo = Object.entries(ctx.entityData)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('\n');

    const messageHistory = ctx.recentMessages
        .reverse()
        .map((m) => `[${m.direction}] ${m.from}: ${m.body}`)
        .join('\n');

    return [
        `You are a professional insurance communications assistant for this MGA.`,
        `Generate 2-3 draft reply options for the following context.`,
        `Each draft should be a separate option with different tone/approach.`,
        intent ? `\nUser intent: ${intent}` : '',
        `\n--- Entity Context ---`,
        `Entity type: ${ctx.entityType}`,
        entityInfo ? entityInfo : '(no entity details available)',
        `\n--- Thread Context ---`,
        ctx.threadSummary,
        messageHistory ? `\n--- Recent Messages ---\n${messageHistory}` : '',
        `\n--- Instructions ---`,
        `- Be professional and empathetic`,
        `- Reference specific policy/claim details when available`,
        `- Keep drafts concise (2-4 sentences each)`,
        `- Return drafts separated by "---"`,
    ].filter(Boolean).join('\n');
}

// ── Rule-Based Fallback (no LLM) ───────────────────────────────────────────

function generateFallbackDrafts(ctx: DraftContext, intent?: string): string[] {
    const name = typeof ctx.entityData.insuredName === 'string'
        ? ctx.entityData.insuredName
        : typeof ctx.entityData.claimNumber === 'string'
            ? `regarding claim ${ctx.entityData.claimNumber}`
            : 'valued customer';

    const drafts: string[] = [];

    if (intent?.toLowerCase().includes('follow up') || intent?.toLowerCase().includes('follow-up')) {
        drafts.push(
            `Dear ${name},\n\nThis is a friendly follow-up regarding our previous correspondence. We wanted to check if you had any questions or needed further assistance. Please don't hesitate to reach out at your convenience.\n\nKind regards`,
            `Dear ${name},\n\nI hope this message finds you well. I'm reaching out to follow up on our recent communication. If there's anything outstanding that requires your attention, please let us know and we'll be happy to assist.\n\nBest regards`,
        );
    } else if (intent?.toLowerCase().includes('acknowledge') || intent?.toLowerCase().includes('receipt')) {
        drafts.push(
            `Dear ${name},\n\nThank you for your message. We have received your correspondence and our team is currently reviewing it. We will get back to you shortly with a detailed response.\n\nKind regards`,
            `Dear ${name},\n\nWe acknowledge receipt of your recent communication. Rest assured, this matter has been assigned to the appropriate team member who will be in touch within the next business day.\n\nBest regards`,
        );
    } else if (ctx.entityType === 'CLAIM') {
        drafts.push(
            `Dear ${name},\n\nThank you for reaching out regarding your claim${ctx.entityData.claimNumber ? ` (${ctx.entityData.claimNumber})` : ''}. Our claims team is actively reviewing your case and will provide an update as soon as possible.\n\nKind regards`,
            `Dear ${name},\n\nWe appreciate you contacting us about your claim. Your case is being handled with priority, and a member of our team will be in touch shortly with the next steps.\n\nBest regards`,
        );
    } else {
        drafts.push(
            `Dear ${name},\n\nThank you for your correspondence. We appreciate you reaching out and our team is reviewing your inquiry. We will respond with a detailed update at our earliest convenience.\n\nKind regards`,
            `Dear ${name},\n\nThank you for contacting us. We have noted your message and will address it promptly. Please feel free to reach out if you have any immediate questions.\n\nBest regards`,
        );
    }

    return drafts;
}

// ── Public API ──────────────────────────────────────────────────────────────

let llmProvider: LLMProvider | null = null;

export function setLLMProvider(provider: LLMProvider): void {
    llmProvider = provider;
}

export async function generateDrafts(
    entityType: string,
    entityId: string,
    options?: { threadId?: string; intent?: string },
): Promise<{ drafts: string[]; source: 'llm' | 'fallback'; prompt?: string }> {
    const ctx = await gatherContext(entityType, entityId, options?.threadId);
    const prompt = buildPrompt(ctx, options?.intent);

    if (llmProvider) {
        try {
            const drafts = await llmProvider.generateDrafts(prompt, { count: 3 });
            return { drafts, source: 'llm' };
        } catch (err) {
            logger.warn({ err }, 'comms.draft.llm_failed, falling back to rules');
        }
    }

    // Fallback: rule-based drafts
    const drafts = generateFallbackDrafts(ctx, options?.intent);
    return { drafts, source: 'fallback', prompt };
}
