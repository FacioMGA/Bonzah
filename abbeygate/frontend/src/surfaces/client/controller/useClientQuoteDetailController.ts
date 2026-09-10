/**
 * useClientQuoteDetailController — Controller for ClientQuoteDetailPage
 *
 * Owns: quote loading, tab state, approve-and-bind flow, doc upload.
 * API ownership: clientPortalClient (getPolicy, bindPolicy, uploadPublicDocument).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { addClientDoc, pushClientFeed, readClientDocs } from '@/src/shared/lib/clientStore';
import { formatCompanyName } from '@/src/shared/lib/format';
import { humanizePolicyStatus } from '@/src/modules/policies/model/policyDisplayLabels';

export type QuoteDetailTab = 'Overview' | 'Details' | 'Documents' | 'Billing';

type PolicyView = {
    id?: string; policyNumber?: string; inceptionDate?: string; expiryDate?: string;
    startDate?: string; endDate?: string; start?: string; end?: string;
    totalPremium?: number; premium?: number; status?: string;
    insuredName?: string; name?: string; policyHolderId?: { name?: string };
};

export function useClientQuoteDetailController() {
    const navigate = useNavigate();
    const { id } = useParams();
    const [loading, setLoading] = useState(true);
    const [policy, setPolicy] = useState<PolicyView | null>(null);
    const [activeTab, setActiveTab] = useState<QuoteDetailTab>('Overview');
    const [uploading, setUploading] = useState(false);
    const [docs, setDocs] = useState(readClientDocs());
    const [binding, setBinding] = useState(false);

    useEffect(() => {
        (async () => {
            if (!id) return;
            try {
                setLoading(true);
                const res = await api.getPolicy(id);
                if (res.success && res.data) setPolicy(res.data);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    const view = useMemo(() => {
        const insured = formatCompanyName(policy?.insuredName || policy?.policyHolderId?.name || policy?.name || 'Quote');
        const policyNumber = policy?.policyNumber || policy?.id || id || '—';
        const start = policy?.inceptionDate || policy?.startDate || policy?.start || '—';
        const end = policy?.expiryDate || policy?.endDate || policy?.end || '—';
        const premium = policy?.totalPremium || policy?.premium || 0;
        const status = humanizePolicyStatus(String(policy?.status || 'PENDING'));
        return { insured, policyNumber, start, end, premium, status };
    }, [policy, id]);

    const approveAndBind = useCallback(async () => {
        if (!id) return;
        setBinding(true);
        try {
            const res = await api.bindPolicy(id);
            if (!res.success) throw new Error(res.error?.message || 'Bind failed');
            pushClientFeed({ type: 'policy', title: 'Quote approved and issued', detail: `${view.policyNumber} is now active in your portal.`, href: `/client/policies/${id}` });
            navigate(`/client/policies/${id}`);
        } finally {
            setBinding(false);
        }
    }, [id, view.policyNumber, navigate]);

    const uploadDoc = useCallback(async (file: File) => {
        if (!id) return;
        setUploading(true);
        try {
            const res = await api.uploadPublicDocument(file);
            if (!res.success || !res.data) throw new Error(res.error?.message || 'Upload failed');
            const url = String((res.data as { url?: string }).url || '');
            addClientDoc({ id: `doc_${Date.now()}`, name: file.name, entityType: 'quote', entityId: id, status: 'Uploaded', url, uploadedAt: new Date().toISOString() });
            pushClientFeed({ type: 'document', title: 'Document uploaded', detail: `${file.name} uploaded for ${view.policyNumber}.`, href: `/client/quotes/${id}` });
            setDocs(readClientDocs());
        } finally {
            setUploading(false);
        }
    }, [id, view.policyNumber]);

    const quoteDocs = docs.filter((d) => d.entityType === 'quote' && d.entityId === id);

    const goBackToQuotes = useCallback(() => navigate('/client/quotes'), [navigate]);

    return {
        loading, policy, activeTab, uploading, binding,
        view, quoteDocs, id,
        setActiveTab, approveAndBind, uploadDoc, goBackToQuotes,
    };
}
