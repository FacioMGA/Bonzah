/**
 * useClientPoliciesController — Controller for ClientPoliciesPage
 *
 * Owns: paginated policy listing, debounced search, load-more.
 * API ownership: clientPortalClient (listPolicies).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';

type ClientPolicyRow = {
    id?: string; policyId?: string; policyNumber?: string;
    insuredName?: string; name?: string; status?: string;
    totalPremium?: number; premium?: number;
    startDate?: string; endDate?: string; start?: string; end?: string;
};

const PAGE_SIZE = 25;
const STATUS_IN = ['ISSUED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'CANCELED'];

export function useClientPoliciesController() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [rows, setRows] = useState<ClientPolicyRow[]>([]);
    const [q, setQ] = useState('');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const loadSeqRef = useRef(0);

    const [qDebounced, setQDebounced] = useState('');
    useEffect(() => {
        const t = window.setTimeout(() => setQDebounced(q.trim()), 250);
        return () => window.clearTimeout(t);
    }, [q]);

    const loadPage = useCallback(async (p: number, opts?: { replace?: boolean }) => {
        const replace = Boolean(opts?.replace);
        const seq = ++loadSeqRef.current;
        if (p === 1 || replace) setLoading(true);
        else setLoadingMore(true);

        try {
            const res = await api.listPolicies({
                page: p, pageSize: PAGE_SIZE, statusIn: STATUS_IN,
                q: qDebounced || undefined, projection: 'compact',
            });
            if (seq !== loadSeqRef.current) return;

            const policies = res?.success && res?.data ? (Array.isArray(res.data) ? res.data : []) : [];
            const incoming = policies
                .map((it) => {
                    const row = (it || {}) as ClientPolicyRow;
                    return { ...row, id: row.id || row.policyId };
                })
                .filter((it) => Boolean(it?.id));

            setRows((prev) => {
                const base = (p === 1 || replace) ? [] : (Array.isArray(prev) ? prev : []);
                const combined = [...base, ...incoming];
                const seen = new Set<string>();
                return combined.filter((r) => {
                    const id = String(r?.id || '');
                    if (!id) return false;
                    if (seen.has(id)) return false;
                    seen.add(id);
                    return true;
                });
            });

            const pagination = (res as { pagination?: { page?: number; totalPages?: number } }).pagination;
            if (pagination && typeof pagination.page === 'number' && typeof pagination.totalPages === 'number') {
                setHasMore(pagination.page < pagination.totalPages);
            } else {
                setHasMore(incoming.length === PAGE_SIZE);
            }
            setPage(p);
        } finally {
            if (seq === loadSeqRef.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [qDebounced]);

    useEffect(() => {
        setRows([]);
        setPage(1);
        setHasMore(true);
        void loadPage(1, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [qDebounced]);

    const loadMore = useCallback(() => loadPage(page + 1), [loadPage, page]);
    const goToPolicy = useCallback((id: string) => navigate(`/client/policies/${id}`), [navigate]);
    const goToQuotes = useCallback(() => navigate('/client/quotes'), [navigate]);

    return {
        loading, loadingMore, hasMore, q,
        filtered: rows,
        setQ, loadMore, goToPolicy, goToQuotes,
    };
}
