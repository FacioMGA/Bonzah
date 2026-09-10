/**
 * useClientCancelPolicyController — Controller for ClientCancelPolicyPage
 *
 * Owns: policy list loading, cancellation form state, 2-step flow, submit.
 * API ownership: clientPortalClient (listPolicies, requestPolicyCancellation).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';

function isoDate(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function useClientCancelPolicyController() {
    const navigate = useNavigate();
    const { policyId: policyIdFromRoute = '' } = useParams();
    const { search } = useLocation();
    const q = useMemo(() => new URLSearchParams(search || ''), [search]);
    const initialPolicyId = String(q.get('policyId') || '').trim();

    const [loading, setLoading] = useState(true);
    const [policies, setPolicies] = useState<Array<{ id?: string; policyId?: string; policyNumber?: string }>>([]);
    const [policyId, setPolicyId] = useState(initialPolicyId);
    const [reason, setReason] = useState('');
    const [effectiveDate, setEffectiveDate] = useState(isoDate(new Date()));
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<1 | 2>(1);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const res = await api.listPolicies({ page: 1, pageSize: 200, statusIn: ['ACTIVE', 'ISSUED'], projection: 'compact' });
                const data = res.success && res.data && Array.isArray(res.data) ? res.data : [];
                setPolicies(data);
                if (policyIdFromRoute) {
                    const match = data.find((p) => String(p.id || p.policyId) === String(policyIdFromRoute));
                    if (match) setPolicyId(String(match.id || match.policyId || ''));
                    else if (!policyId && data.length) setPolicyId(String(data[0].id || data[0].policyId || ''));
                } else if (!policyId && data.length) {
                    setPolicyId(String(data[0].id || data[0].policyId || ''));
                }
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [policyIdFromRoute]);

    const canSubmit = Boolean(policyId);

    const submit = useCallback(async () => {
        if (!canSubmit) return;
        setSaving(true);
        setError(null);
        try {
            const res = await api.requestPolicyCancellation(String(policyId), {
                reason: reason || undefined,
                requestedEffectiveDate: effectiveDate || undefined,
            });
            if (!res.success) throw new Error(res.error?.message || 'Cancellation request failed');
            setResult((res.data as Record<string, unknown>) || { status: 'CANCELLATION_REQUESTED' });
        } catch (e) {
            setError((e as Error).message || 'Cancellation request failed');
        } finally {
            setSaving(false);
        }
    }, [canSubmit, policyId, reason, effectiveDate]);

    const backToPolicy = useCallback(() => {
        if (policyId) navigate(`/client?policy=${encodeURIComponent(policyId)}`);
        else navigate('/client');
    }, [navigate, policyId]);

    const goToStep2 = useCallback(() => setStep(2), []);
    const goToStep1 = useCallback(() => setStep(1), []);

    return {
        loading, saving, error, result, step,
        policies, policyId, reason, effectiveDate, canSubmit,
        policyIdFromRoute,
        setPolicyId, setReason, setEffectiveDate,
        submit, backToPolicy, goToStep1, goToStep2,
    };
}
