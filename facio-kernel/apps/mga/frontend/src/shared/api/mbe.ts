
import { boApiClient as api } from '@/src/shared/api/boApiClient';

type EndorsementScope = "POLICY" | "VEHICLE" | "DRIVER" | "COVER";
type FormFieldType = "string" | "currency" | "date" | "boolean" | "select" | "vehicle_select" | "multiselect" | "text" | "textarea";

interface FormField {
    name: string;
    label: string;
    type: FormFieldType;
    options?: string[];
    required?: boolean;
}

interface EndorsementTemplate {
    id: string;
    program_code: string;
    code: string;
    title: string;
    type: string;
    scope: EndorsementScope;
    jurisdiction: string[];
    legal_text: string;
    summary?: string;
    document_template?: string;
    parameters_schema: Record<string, unknown>;
    default_params: Record<string, unknown>;
    ui: {
        group: string;
        help_text: string;
        form_fields: FormField[];
    };
    requires_underwriter_approval: boolean;
    allowed_with: string[];
    disallowed_with: string[];
}

interface EndorsementInstance {
    id: string;
    policyId: string;
    transactionId: string;
    templateId: string;
    code: string;
    title: string;
    scope: EndorsementScope;
    targetId?: string | null;
    params: Record<string, unknown>;
    effectiveFrom: string;
    effectiveTo?: string | null;
    status: "APPLIED" | "PENDING" | "REJECTED" | "SUPERSEDED";
    premiumDelta: number;
    createdAt: string;
    createdBy?: string;
    approvedBy?: string;
    approvedAt?: string;
}

interface PreviewResponse {
    success: boolean;
    validation: {
        status: "VALID" | "WARN" | "ERROR";
        messages: string[];
    };
    premiumDelta: number;
    newPremium: number;
    newExcess: number;
    docPreview?: string;
    schedule_diff_html?: string;
}

type MbeApiResponse<T> = {
    success: boolean;
    data?: T;
    error?: { code?: string; message?: string };
};

function buildMbeScopeQuery(scope?: { productType?: string; policyId?: string; programId?: string }): string {
    if (!scope) return '';
    const params = new URLSearchParams();
    if (scope.productType) params.set('productType', scope.productType);
    if (scope.policyId) params.set('policyId', scope.policyId);
    if (scope.programId) params.set('programId', scope.programId);
    const q = params.toString();
    return q ? `?${q}` : '';
}

export const mbeApi = {
    getGroups: async (scope?: { productType?: string; policyId?: string; programId?: string }): Promise<Array<{ id: string; title: string; templates: string[] }>> => {
        const query = buildMbeScopeQuery(scope);
        const res = await api.request<Array<{ id: string; title: string; templates: string[] }>>(`mbe/groups${query}`);
        if (!res.success) throw new Error(res.error?.message || 'Failed to fetch groups');
        return res.data || [];
    },

    getTemplates: async (scope?: { productType?: string; policyId?: string; programId?: string }): Promise<EndorsementTemplate[]> => {
        const query = buildMbeScopeQuery(scope);
        const res = await api.request<EndorsementTemplate[]>(`mbe/templates${query}`);
        if (!res.success) throw new Error(res.error?.message || 'Failed to fetch templates');
        return res.data || [];
    },

    preview: async (payload: {
        policyId: string;
        endorsementCode: string;
        params: Record<string, unknown>;
        targetId?: string;
    }): Promise<PreviewResponse> => {
        const res = await api.request<PreviewResponse>('mbe/preview', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!res.success) throw new Error(res.error?.message || 'Preview failed');
        return res.data as PreviewResponse;
    },

    apply: async (payload: {
        policyId: string;
        endorsementCode: string;
        params: Record<string, unknown>;
        targetId?: string;
    }, idempotencyKey?: string): Promise<MbeApiResponse<EndorsementInstance>> => {
        const headers: Record<string, string> = {};
        if (idempotencyKey) {
            headers['Idempotency-Key'] = idempotencyKey;
        }
        const res = await api.request<EndorsementInstance>('mbe/apply', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers
        });

        return res;
    },

    approve: async (id: string): Promise<EndorsementInstance> => {
        const res = await api.request<EndorsementInstance>(`mbe/endorsements/${id}/approve`, { method: 'POST' });
        if (!res.success) throw new Error(res.error?.message || 'Approve failed');
        return res.data as EndorsementInstance;
    },

    decline: async (id: string): Promise<EndorsementInstance> => {
        const res = await api.request<EndorsementInstance>(`mbe/endorsements/${id}/decline`, { method: 'POST' });
        if (!res.success) throw new Error(res.error?.message || 'Decline failed');
        return res.data as EndorsementInstance;
    },

    removeEndorsement: async (_policyId: string, instanceId: string): Promise<{ id: string }> => {
        const res = await api.request<{ id: string }>(`mbe/endorsements/${instanceId}`, { method: 'DELETE' });
        if (!res.success) throw new Error(res.error?.message || 'Remove failed');
        return res.data as { id: string };
    }
};
