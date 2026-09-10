/**
 * useClientPolicyDetailController — Controller for ClientPolicyDetailPage
 *
 * Owns: policy loading, tab state, doc upload, invoices/claims filtering.
 * API ownership: clientPortalClient (getPolicy, listInvoices, listClaims, uploadPublicDocument).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { mapDocumentsToVM } from '@/src/surfaces/client/api/mappers/dashboardMapper';
import { addClientDoc, pushClientFeed, readClientDocs } from '@/src/shared/lib/clientStore';
import { formatCompanyName } from '@/src/shared/lib/format';
import { humanizePolicyStatus } from '@/src/modules/policies/model/policyDisplayLabels';
import type { DocumentDTO } from '../types/dashboard.contract';

export type PolicyDetailTab = 'Overview' | 'Documents' | 'Billing' | 'Claims';

type ClientPolicy = {
    id?: string; policyNumber?: string; status?: string;
    inceptionDate?: string; expiryDate?: string; productType?: string;
    insuredName?: string; name?: string; startDate?: string; endDate?: string; start?: string; end?: string;
    totalPremium?: number; premium?: number;
    policyHolder?: { name?: string }; policyHolderId?: { name?: string };
    currency?: string;
};
type ClientInvoice = { id?: string; status?: string; amount?: number; dueDate?: string; createdAt?: string; policyId?: string };
type ClientClaim = { id?: string; status?: string; claimType?: string; createdAt?: string; amount?: number; policyId?: string; claimNumber?: string; reportedDate?: string; incidentDate?: string; policy?: { id?: string } };

function readAuthToken(): string | null {
    try {
        return localStorage.getItem('auth_token');
    } catch {
        return null;
    }
}

function productLabel(productType: unknown): string {
    const normalized = String(productType || '').trim().toUpperCase();
    if (normalized === 'HOME') return 'Home Insurance';
    if (normalized === 'TRAVEL') return 'Travel Insurance';
    if (normalized === 'MOTOR') return 'Motor Insurance';
    return 'Insurance';
}

export function useClientPolicyDetailController() {
    const navigate = useNavigate();
    const { id } = useParams();
    const [loading, setLoading] = useState(true);
    const [policy, setPolicy] = useState<ClientPolicy | null>(null);
    const [activeTab, setActiveTab] = useState<PolicyDetailTab>('Overview');
    const [uploading, setUploading] = useState(false);
    const [docs, setDocs] = useState(readClientDocs());
    const [invoices, setInvoices] = useState<ClientInvoice[]>([]);
    const [claims, setClaims] = useState<ClientClaim[]>([]);

    useEffect(() => {
        (async () => {
            if (!id) return;
            try {
                setLoading(true);
                const [pRes, iRes, cRes, dRes] = await Promise.all([
                    api.getPolicy(id),
                    api.listInvoices({ page: 1, pageSize: 200 }),
                    api.listClaims({ page: 1, pageSize: 200 }),
                    api.listPolicyDocuments(id),
                ]);
                if (pRes.success && pRes.data) setPolicy(pRes.data as ClientPolicy);
                setInvoices(iRes.success && iRes.data ? (Array.isArray(iRes.data) ? (iRes.data as ClientInvoice[]) : []) : []);
                setClaims(cRes.success && cRes.data ? (Array.isArray(cRes.data) ? (cRes.data as ClientClaim[]) : []) : []);
                const serverDocs = dRes.success && Array.isArray(dRes.data)
                    ? mapDocumentsToVM(dRes.data as DocumentDTO[], readAuthToken()).map((doc) => ({
                        id: doc.id,
                        name: doc.typeLabel || doc.filename || 'Document',
                        entityType: 'policy' as const,
                        entityId: id,
                        status: 'Approved' as const,
                        url: doc.href,
                        uploadedAt: doc.createdAt,
                    }))
                    : [];
                setDocs([...serverDocs, ...readClientDocs()]);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    const view = useMemo(() => {
        const insured = formatCompanyName(policy?.insuredName || policy?.policyHolder?.name || policy?.policyHolderId?.name || policy?.name || 'Policy');
        const policyNumber = policy?.policyNumber || policy?.id || id || '—';
        const start = policy?.inceptionDate || policy?.startDate || policy?.start || '—';
        const end = policy?.expiryDate || policy?.endDate || policy?.end || '—';
        const premium = policy?.totalPremium || policy?.premium || 0;
        const status = humanizePolicyStatus(String(policy?.status || 'ACTIVE'));
        const product = productLabel(policy?.productType);
        const currency = String(policy?.currency || 'EUR').toUpperCase();
        return { insured, policyNumber, start, end, premium, status, product, currency };
    }, [policy, id]);

    const uploadDoc = useCallback(async (file: File) => {
        if (!id) return;
        setUploading(true);
        try {
            const res = await api.uploadPublicDocument(file);
            if (!res.success || !res.data) throw new Error(res.error?.message || 'Upload failed');
            const url = (res.data as { url?: string }).url;
            addClientDoc({ id: `doc_${Date.now()}`, name: file.name, entityType: 'policy', entityId: id, status: 'Uploaded', url: url || '', uploadedAt: new Date().toISOString() });
            pushClientFeed({ type: 'document', title: 'Document uploaded', detail: `${file.name} uploaded for ${view.policyNumber}.`, href: `/client/policies/${id}` });
            setDocs(readClientDocs());
        } finally {
            setUploading(false);
        }
    }, [id, view.policyNumber]);

    const policyDocs = docs.filter((d) => d.entityType === 'policy' && d.entityId === id);
    const policyInvoices = invoices.filter((inv) => inv.policyId === id);
    const policyClaims = claims.filter((c) => c.policyId === id || c.policy?.id === id);

    const goBackToPolicies = useCallback(() => navigate('/client/policies'), [navigate]);
    const goToFileClaim = useCallback(() => navigate(`/client/policy/${encodeURIComponent(String(id || ''))}/claim/new`), [navigate, id]);
    const goToDocuments = useCallback(() => navigate(`/client/policy/${encodeURIComponent(String(id || ''))}/documents`), [navigate, id]);

    return {
        loading, policy, activeTab, uploading,
        view, policyDocs, policyInvoices, policyClaims,
        id,
        setActiveTab, uploadDoc, goBackToPolicies, goToFileClaim, goToDocuments,
    };
}
