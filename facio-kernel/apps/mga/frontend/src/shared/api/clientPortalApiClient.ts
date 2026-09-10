import { http } from '@/src/shared/api/http';

type PolicyRecord = {
  id: string;
  policyId?: string;
  status?: string;
  quoteData?: Record<string, unknown>;
};

type PublicFnolContext = {
  claimId: string;
  claimNumber: string;
  policyId: string;
  policyNumber: string | null;
  policyHolderName: string;
  policyHolderContact: string;
  quoteData: Record<string, unknown>;
  driverInfo: Record<string, unknown>;
  vehicleInfo: Record<string, unknown>;
  expiresAt: string | null;
  contract?: Record<string, unknown>;
};

export const clientPortalApiClient = {
  // Policy CRUD — domain client
  listPolicies: (filters?: {
    status?: string;
    statusIn?: string[];
    q?: string;
    projection?: string;
    productType?: string;
    page?: number;
    pageSize?: number;
    viewId?: string;
    filterOps?: Record<string, string>;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.statusIn?.length) params.append('statusIn', filters.statusIn.join(','));
    if (filters?.q) params.append('q', filters.q);
    if (filters?.projection) params.append('projection', filters.projection);
    if (filters?.productType) params.append('productType', filters.productType);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
    if (filters?.viewId) params.append('viewId', String(filters.viewId));
    if (filters?.filterOps && typeof filters.filterOps === 'object') {
      for (const [k, v] of Object.entries(filters.filterOps)) {
        if (!k) continue;
        const value = String(v || '').trim();
        if (!value) continue;
        params.append(k, value);
      }
    }
    return http.request<PolicyRecord[]>(`policies?${params.toString()}`);
  },
  getPolicy: (id: string) => http.request<PolicyRecord>(`policies/${id}`),
  bindPolicy: (policyId: string) => http.request(`policies/${policyId}/bind`, { method: 'POST' }),
  // Cancellation — domain client
  requestPolicyCancellation: (policyId: string, payload: { reason?: string; requestedEffectiveDate?: string }) =>
    http.request(`policies/${policyId}/cancellation/request`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  // Endorsements — domain client
  createEndorsementDraft: (policyId: string, payload: { effectiveDate: string; reason?: string; reasonCode?: string }) =>
    http.request(`policies/${policyId}/endorsements/draft`, { method: 'POST', body: JSON.stringify(payload) }),
  patchEndorsementDraft: (policyId: string, riskTransactionId: string, patch: Record<string, unknown>) =>
    http.request(`policies/${policyId}/endorsements/${riskTransactionId}/draft`, { method: 'PATCH', body: JSON.stringify(patch || {}) }),
  rateEndorsementDraft: (policyId: string, riskTransactionId: string, payload?: { overrideExcess?: number }) =>
    http.request(`policies/${policyId}/endorsements/${riskTransactionId}/rate`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  bindEndorsementDraft: (policyId: string, riskTransactionId: string) =>
    http.request(`policies/${policyId}/endorsements/${riskTransactionId}/bind`, { method: 'POST' }),
  issueEndorsement: (policyId: string, riskTransactionId: string, payload?: { confirmManualRefundAck?: boolean }) =>
    http.request(`policies/${policyId}/endorsements/${riskTransactionId}/issue`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  // Claims — domain client
  listClaims: (filters?: { status?: string; statusIn?: string[]; policyId?: string; include?: string[]; page?: number; pageSize?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.statusIn?.length) params.append('statusIn', filters.statusIn.join(','));
    if (filters?.policyId) params.append('policyId', filters.policyId);
    if (filters?.include?.length) params.append('include', filters.include.join(','));
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
    return http.request(`claims?${params.toString()}`);
  },
  getClaim: (id: string) => http.request(`claims/${id}`),
  getPublicFnolContext: (token: string) => http.request<PublicFnolContext>(`public/fnol/${encodeURIComponent(token)}/context`),
  getPolicyClaimsContract: (policyId: string) => http.request(`policies/${policyId}/claims/contract`),
  submitFnol: (policyId: string, fnol: Record<string, unknown>) =>
    http.request(`policies/${policyId}/claims`, { method: 'POST', body: JSON.stringify(fnol || {}) }),
  submitPublicFnol: (token: string, payload: { form: Record<string, unknown> }) =>
    http.request(`public/fnol/${encodeURIComponent(token)}/submit`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  submitFnolFinal: (claimId: string, payload: { form: Record<string, unknown> }) =>
    http.request(`claims/${claimId}/fnol/submit`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  getClaimFormPackage: (claimId: string) => http.request(`claims/${claimId}/claim-form-package`),
  openClaimFormPackage: (claimId: string) => http.request(`claims/${claimId}/claim-form-package/open`, { method: 'POST' }),
  submitClaimFormPackage: (claimId: string, payload: { responses: Record<string, unknown> }) =>
    http.request(`claims/${claimId}/claim-form-package/submit`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  // Invoices — domain client
  listInvoices: (filters?: { status?: string; page?: number; pageSize?: number }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
    return http.request(`invoices?${params.toString()}`);
  },
  // Documents — domain client
  uploadPublicDocument: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return http.request<{ url: string; filename: string }>('public/documents/upload', {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
  listPolicyDocuments: (policyId: string) => http.request<Record<string, unknown>[]>(`policies/${policyId}/documents`),
  emailPolicyDocuments: (policyId: string, documentIds: string[]) =>
    http.request<{ sent: boolean; toEmail: string; count: number }>(`policies/${policyId}/documents/email`, {
      method: 'POST',
      body: JSON.stringify({ documentIds }),
    }),
  getPolicyFeed: (policyId: string) => http.request<Record<string, unknown>[]>(`policies/${policyId}/feed`),
};

export type ClientPortalApiClient = typeof clientPortalApiClient;
