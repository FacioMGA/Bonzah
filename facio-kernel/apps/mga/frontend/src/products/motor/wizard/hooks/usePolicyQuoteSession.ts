import { getSelectedTenant } from '@/src/shared/lib/tenant/runtimeProfile';
import React, { useRef, useMemo, useCallback } from 'react';
import { policyCrudApiClient } from '@/src/modules/policies/api/policyCrudApiClient';
import { asRecord } from '@/src/shared/lib/record';
import { logger } from '@/src/shared/lib/logger';

type UnknownRecord = Record<string, unknown>;

interface UsePolicyQuoteSessionOpts {
    routeId: string | undefined;
    locationPathname: string;
    navigate: (to: string | { pathname: string; search?: string; hash?: string }, opts?: { replace?: boolean }) => void;
    setSelectedPortfolio: (v: unknown) => void;
    setView: (v: string) => void;
    setActiveTab: (v: string) => void;
    setIsEditing: (v: boolean) => void;
    toast: (message: string) => void;
}

/**
 * Manages auto-insurance quote session creation (BO flow).
 *
 * This is application-layer orchestration: creating sessions via API,
 * seeding default data, and navigating to the new policy.
 *
 * Does NOT interpret questionnaire fields — only seeds identity/contact
 * from account data and delegates to the backend session API.
 */
export function usePolicyQuoteSession({
    routeId,
    locationPathname,
    navigate,
    setSelectedPortfolio,
    setView,
    setActiveTab,
    setIsEditing,
    toast,
}: UsePolicyQuoteSessionOpts) {
    const creatingNewAutoRef = useRef(false);
    const forceEditOnNextLoadRef = useRef(false);

    const DEFAULT_AUTO_QUOTE_DATA = useMemo(() => ({
        __meta: { origin: 'bo' as const },
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        nationality: '',
        nif: '',
        occupation: '',
        whereDidYouHear: '',
        addressLine: '',
        city: '',
        province: '',
        postCode: '',
        country: '',
        telephone: '',
        email: '',
    }), []);

    const getQuoteOrigin = useCallback((portfolio: unknown): 'customer' | 'bo' | 'unknown' => {
        const o = asRecord(asRecord(asRecord(portfolio).quoteData).__meta).origin;
        if (o === 'customer' || o === 'bo') return o;
        return 'unknown';
    }, []);

    const resolvePublicAutoSessionId = useCallback(async (policyId: string): Promise<string> => {
        try {
            const res = await policyCrudApiClient.getPublicSessionToken(policyId);
            return String(res?.data?.publicSessionToken || policyId);
        } catch {
            return String(policyId);
        }
    }, []);

    const openQuoteWizard = useCallback(async (policyId: string, hash: string = 'policy-holder') => {
        const safeHash = String(hash || 'policy-holder').replace(/^#/, '');
        try {
            const res = await policyCrudApiClient.getPublicSessionToken(policyId);
            const publicId = res?.data?.publicSessionToken || policyId;
            const product = String(res?.data?.productType || '').trim().toLowerCase();
            const query = new URLSearchParams();
            if (product) query.set('product', product);
            const workspace = getSelectedTenant()?.id;
            if (workspace) query.set('workspace', workspace);
            const productQuery = query.size ? '?' + query.toString() : '';
            window.open(`/quote/${publicId}${productQuery}#${safeHash}`, '_blank', 'noopener,noreferrer');
        } catch (e) {
            logger.error('[openQuoteWizard] Failed to resolve public session token', e);
            toast('Could not open customer quote link (public session token missing). Please try again in a few seconds or refresh the policy.');
        }
    }, [toast]);

    const createAndOpenAutoPolicySession = React.useCallback(async (opts?: { account?: unknown; forceNewRoute?: boolean }) => {
        if (creatingNewAutoRef.current) return;

        // React 18 StrictMode: guard before any await to prevent duplicate creates.
        creatingNewAutoRef.current = true;
        const startedPathname = locationPathname;
        try {
            if (opts?.forceNewRoute && routeId !== 'new') return;
            const resp = await policyCrudApiClient.createQuoteSession('MOTOR', { origin: 'bo' });
            if (!resp?.success || !resp?.data?.policyId) throw new Error(resp?.error?.message || 'Failed to create auto quote session');

            const policyId = String(resp.data.policyId);
            const publicId = String(resp?.data?.publicSessionToken || policyId);
            const account = opts?.account;

            // Best-effort: seed the session with anything we know from the account (name/contact).
            const contact = (account && typeof account === 'object') ? (asRecord(account).contact || {}) : {};
            const fullName = String(asRecord(account)?.name || '').trim();
            const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
            const lastName = rest.join(' ').trim();
            const nextQd: UnknownRecord = {
                ...DEFAULT_AUTO_QUOTE_DATA,
                ...(firstName ? { firstName } : {}),
                ...(lastName ? { lastName } : {}),
                ...(asRecord(contact)?.email ? { email: asRecord(contact).email } : {}),
                ...(asRecord(contact)?.telephone ? { telephone: asRecord(contact).telephone } : {}),
                __meta: { origin: 'bo' },
            };

            await policyCrudApiClient.patchQuoteSession('MOTOR', publicId, { quoteData: nextQd, step: 'policy-holder', origin: 'bo' });

            // Only continue if we're still on the same route context where creation started.
            if (locationPathname !== startedPathname && opts?.forceNewRoute) return;

            if (opts?.account) {
                // Clear state to prevent loops if user navigates back.
                window.history.replaceState({}, document.title);
            }

            forceEditOnNextLoadRef.current = true;
            navigate({ pathname: `/policies/${policyId}`, search: '?edit=1', hash: '#policy-holder' }, { replace: true });
            setSelectedPortfolio({ id: policyId });
            setView('detail');
            setActiveTab('Policy Holder');
            setIsEditing(true);
        } catch (e) {
            logger.error(e);
            toast(`Failed to create new policy: ${(e as Error)?.message || 'Unknown error'}`);
            navigate('/policies', { replace: true });
        } finally {
            creatingNewAutoRef.current = false;
        }
    }, [DEFAULT_AUTO_QUOTE_DATA, locationPathname, navigate, routeId, setActiveTab, setSelectedPortfolio, setView, setIsEditing, toast]);

    const handleCreateSubmission = useCallback(async (newQuote: UnknownRecord | null, setShowQuoteModal: (v: boolean) => void) => {
        try {
            const resp = await policyCrudApiClient.createQuoteSession('MOTOR', { origin: 'bo' });
            if (!resp?.success || !resp?.data?.policyId) throw new Error(resp?.error?.message || 'Failed to create auto quote session');

            const policyId = String(resp.data.policyId);
            const publicId = String(resp?.data?.publicSessionToken || policyId);

            // Seed a minimal prefill so the header looks sensible when it opens.
            const rawName = String(asRecord(newQuote)?.insuredName || '').trim();
            const parts = rawName.split(/\s+/).filter(Boolean);
            const firstName = parts[0] || '';
            const lastName = parts.slice(1).join(' ').trim();
            const nextQd: UnknownRecord = {
                ...DEFAULT_AUTO_QUOTE_DATA,
                ...(firstName ? { firstName } : {}),
                ...(lastName ? { lastName } : {}),
                __meta: { origin: 'bo' },
            };
            await policyCrudApiClient.patchQuoteSession('MOTOR', publicId, { quoteData: nextQd, step: 'policy-holder', origin: 'bo' });

            setShowQuoteModal(false);
            navigate({ pathname: `/policies/${policyId}`, search: '?edit=1', hash: '#policy-holder' });
            setSelectedPortfolio({ id: policyId });
            setView('detail');
            setActiveTab('Policy Holder');
        } catch (err) {
            logger.error('Exception during submission:', err);
            toast((err as Error)?.message || 'Failed to create new submission');
        }
    }, [DEFAULT_AUTO_QUOTE_DATA, navigate, setActiveTab, setSelectedPortfolio, setView, toast]);

    return {
        createAndOpenAutoPolicySession,
        handleCreateSubmission,
        getQuoteOrigin,
        openQuoteWizard,
        resolvePublicAutoSessionId,
        forceEditOnNextLoadRef,
        DEFAULT_AUTO_QUOTE_DATA,
    };
}
