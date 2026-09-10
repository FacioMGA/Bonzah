/**
 * Config MCP API client (Phase 0).
 *
 * Single-tool /invoke for synchronous calls (catalog + draft summary)
 * and the SSE /stream for multi-tool agent turns. Lives at
 * `/api/mcp/config/*` — the canonical AI tool surface per ADR-0036.
 */
import { http } from '@/src/shared/api/http';

export interface McpToolDescriptorSummary {
    name: string;
    family: string;
    description: string;
    requiredPermission: string;
    auditClass: string;
}

export interface McpSuccessEnvelope<T> {
    success: true;
    toolName: string;
    result: T;
}

export interface McpErrorEnvelope {
    success: false;
    toolName: string;
    error: {
        code: string;
        message: string;
        suggestedFix?: string;
        path?: string;
        ticket?: { kind: string; summary: string; canonicalOwner: string };
    };
}

export type McpEnvelope<T> = McpSuccessEnvelope<T> | McpErrorEnvelope;

export interface TemplateSummary {
    templateId: string;
    name: string;
    vertical: string;
    description: string;
    supportedCapabilities: string[];
}

export interface DraftSummaryResult {
    draftId: string;
    productName: string;
    productCode: string;
    baseTemplateId: string;
    status: 'draft' | 'validation_failed' | 'validated' | 'simulated' | 'sandbox_published' | 'archived';
    configuredCapabilities: string[];
    missingDecisions: string[];
    delta: Record<string, unknown>;
    publishedProgramId: string | null;
    publishedBinderId: string | null;
}

// The MCP HTTP transport returns the envelope shape directly
// ({ success, toolName, result } or { success: false, ... error })
// rather than the platform-standard ApiResponse wrapper. We re-cast
// the http.request<T> response to the MCP envelope shape here.
function asMcpEnvelope<T>(value: unknown): McpEnvelope<T> {
    return value as McpEnvelope<T>;
}

export const configurationApi = {
    async listCatalog(): Promise<McpToolDescriptorSummary[]> {
        const response = await http.request<unknown>('mcp/config/catalog');
        const body = response as unknown as { success: boolean; catalog?: McpToolDescriptorSummary[] };
        return body.catalog ?? [];
    },

    async invoke<T = unknown>(
        toolName: string,
        input: unknown,
        opts?: { sessionId?: string },
    ): Promise<McpEnvelope<T>> {
        const raw = await http.request<unknown>('mcp/config/invoke', {
            method: 'POST',
            body: JSON.stringify({ toolName, input, sessionId: opts?.sessionId, channel: 'web' }),
        });
        return asMcpEnvelope<T>(raw);
    },

    async listTemplates(): Promise<TemplateSummary[]> {
        const envelope = await this.invoke<{ templates: TemplateSummary[] }>(
            'config.products.listTemplates',
            {},
        );
        if (!envelope.success) {
            throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
        }
        return envelope.result.templates;
    },

    async cloneTemplate(templateId: string, productName: string) {
        const envelope = await this.invoke<{
            draftId: string;
            status: 'draft';
            summary: string;
            nextRecommendedSteps: string[];
        }>('config.products.cloneTemplate', { templateId, productName });
        if (!envelope.success) {
            throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
        }
        return envelope.result;
    },

    async getDraftSummary(draftId: string) {
        const envelope = await this.invoke<DraftSummaryResult>(
            'config.products.getDraftSummary',
            { draftId },
        );
        if (!envelope.success) {
            throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
        }
        return envelope.result;
    },

    /**
     * Phase 1 thin wrappers around the write tools. Each returns the raw
     * envelope so the conversation panel can render success / error rows
     * with the same shape it gets from the SSE stream.
     */
    async addReferralRule(args: {
        draftId: string;
        ruleKey: string;
        name: string;
        condition: {
            field: string;
            operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'in' | 'contains';
            value: string | number | boolean | string[] | number[];
        };
        severity: 'low' | 'medium' | 'high';
        reason: string;
        appliesAt: Array<'quote' | 'bind' | 'endorsement'>;
    }) {
        return this.invoke<{
            ruleId: string;
            targetKey: string;
            summary: string;
            warnings: string[];
        }>('config.underwriting.addReferralRule', args);
    },

    async setRequiredDocument(args: {
        draftId: string;
        documentType: 'certificate' | 'schedule' | 'statement_of_fact' | 'green_card' | 'invoice' | 'receipt';
        requiredAt: Array<'quote' | 'bind' | 'endorsement' | 'cancellation'>;
        issuanceTrigger: 'manual' | 'on_bind' | 'on_payment_received' | 'on_request';
    }) {
        return this.invoke<{ documentRuleId: string; summary: string; missingTemplateVariables: string[] }>(
            'config.documents.setRequiredDocument',
            args,
        );
    },

    async setBillingTerms(args: {
        draftId: string;
        currency: string;
        paymentTerms: 'pay_before_bind' | 'invoice_after_bind' | 'installments';
        commissionPercent?: number;
        adminFee?: number;
        cancellationRefundBasis: 'pro_rata' | 'short_rate' | 'manual_review';
        nonRefundableFees?: string[];
    }) {
        return this.invoke<{ billingRuleId: string; summary: string; warnings: string[] }>(
            'config.billing.setCommercialTerms',
            args,
        );
    },

    // Phase 2 / Phase 3 — validation, simulation, publish.

    async validateDraft(draftId: string) {
        return this.invoke<{
            status: 'passed' | 'failed';
            issues: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string; path?: string; suggestedFix?: string }>;
            draftId: string;
            nextStatus: string;
            summary: string;
        }>('config.validation.validateDraft', { draftId });
    },

    async runDemoScenarioPack(draftId: string) {
        return this.invoke<{
            draftId: string;
            scenariosRun: number;
            passed: number;
            failed: number;
            results: Array<{ scenarioName: string; expected: string; actual: string; outcome: 'passed' | 'failed'; summary: string }>;
        }>('config.simulation.runDemoScenarioPack', { draftId });
    },

    async publishToSandbox(args: { draftId: string; sandboxTenantSlug: string; confirmationText: string }) {
        return this.invoke<{
            sandboxConfigVersionId: string;
            publishedProgramId: string;
            publishedBinderId: string;
            status: 'sandbox_published';
            summary: string;
        }>('config.publish.publishToSandbox', args);
    },
};
