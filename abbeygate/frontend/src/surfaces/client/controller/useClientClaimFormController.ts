/**
 * useClientClaimFormController — Controller for ClientClaimFormPage
 *
 * Owns: claim form package loading, field responses, validation, submit.
 * API ownership: clientPortalClient (getClaimFormPackage, openClaimFormPackage, submitClaimFormPackage).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';

// ─── Types ───────────────────────────────────────────────────────
export type ClaimFormField = {
    fieldId: string;
    section: string;
    label: string;
    type: 'text' | 'date' | 'select' | 'textarea' | 'checkbox';
    mode?: 'locked' | 'editable_prefilled' | 'blank_required' | 'blank_optional' | 'derived';
    valueSource?: 'policy' | 'fnol' | 'user' | 'derived';
    validation?: string;
    required: boolean;
    prefill?: string | boolean | null;
    options?: Array<{ value: string; label: string }>;
};

export type ClaimFormPackage = {
    status: 'SENT' | 'OPEN' | 'COMPLETED';
    fields: ClaimFormField[];
    context?: { namedDrivers?: Array<{ id: string; name: string }> };
};

// ─── Helpers (pure) ──────────────────────────────────────────────
function asString(v: unknown): string {
    return String(v ?? '');
}

function initialValue(field: ClaimFormField): string | boolean {
    if (field.type === 'checkbox') return Boolean(field.prefill);
    return asString(field.prefill || '');
}

function isDateInPast(value: string): boolean {
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) && ts < Date.now();
}

function fieldValidationError(field: ClaimFormField, value: unknown): string | null {
    const text = asString(value).trim();
    const rule = asString(field.validation).toLowerCase();
    if (field.required && (field.type === 'checkbox' ? !Boolean(value) : !text)) {
        return `${field.label} is required.`;
    }
    if (!text && field.type !== 'checkbox') return null;

    if (rule.includes('email')) {
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
        if (!emailOk) return 'Please enter a valid email address.';
    }
    if (rule.includes('phone') || rule.includes('e.164')) {
        const phoneOk = /^\+?[0-9()\-.\s]{7,}$/.test(text);
        if (!phoneOk) return 'Please enter a valid phone number.';
    }
    if ((field.type === 'date' && rule.includes('past')) || rule.includes('must be in past')) {
        if (!isDateInPast(text)) return 'Date must be in the past.';
    }
    const minLenMatch = rule.match(/min(?:imum)?(?:\s+length)?\s*[:=]?\s*(\d+)/i);
    if (minLenMatch) {
        const minLen = Number(minLenMatch[1]);
        if (Number.isFinite(minLen) && text.length < minLen) {
            return `Please enter at least ${minLen} characters.`;
        }
    }
    return null;
}

export function isEditableField(field: ClaimFormField, pkgStatus: ClaimFormPackage['status']): boolean {
    if (pkgStatus === 'COMPLETED') return false;
    return field.mode !== 'locked' && field.mode !== 'derived';
}

export { asString };

// ─── Controller ──────────────────────────────────────────────────
export function useClientClaimFormController() {
    const navigate = useNavigate();
    const { policyId = '', claimId = '' } = useParams();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [claimPackage, setClaimPackage] = useState<ClaimFormPackage | null>(null);
    const [responses, setResponses] = useState<Record<string, unknown>>({});

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const pkgRes = await api.getClaimFormPackage(claimId);
                if (!pkgRes.success || !pkgRes.data) throw new Error(pkgRes.error?.message || 'Claim form package not available');
                const pkg = pkgRes.data as ClaimFormPackage;
                setClaimPackage(pkg);
                if (pkg.status !== 'COMPLETED') {
                    const openRes = await api.openClaimFormPackage(claimId);
                    if (!openRes.success) throw new Error(openRes.error?.message || 'Failed to initialize claim form');
                }
                const seed: Record<string, unknown> = {};
                (pkg.fields || []).forEach((f) => {
                    seed[f.fieldId] = initialValue(f);
                });
                setResponses(seed);
            } catch (e) {
                setError((e as Error).message || 'Failed to load claim form');
            } finally {
                setLoading(false);
            }
        })();
    }, [claimId]);

    const fieldsBySection = useMemo(() => {
        const map: Record<string, ClaimFormField[]> = {};
        (claimPackage?.fields || []).forEach((f) => {
            const k = f.section || 'General';
            map[k] = map[k] || [];
            map[k].push(f);
        });
        return map;
    }, [claimPackage]);

    const missingRequired = useMemo(
        () =>
            (claimPackage?.fields || []).some((f) => {
                if (!f.required) return false;
                const v = responses[f.fieldId];
                return f.type === 'checkbox' ? !Boolean(v) : !asString(v).trim();
            }),
        [claimPackage, responses],
    );

    useEffect(() => {
        const nextErrors: Record<string, string> = {};
        const status = claimPackage?.status ?? 'SENT';
        (claimPackage?.fields || []).forEach((field) => {
            if (!isEditableField(field, status)) return;
            const err = fieldValidationError(field, responses[field.fieldId]);
            if (err) nextErrors[field.fieldId] = err;
        });
        setFieldErrors(nextErrors);
    }, [claimPackage, responses]);

    const setResponse = useCallback((fieldId: string, value: unknown) => {
        setResponses((p) => ({ ...p, [fieldId]: value }));
    }, []);

    const submit = useCallback(async () => {
        if (!claimPackage || claimPackage.status === 'COMPLETED') return;
        if (missingRequired || Object.keys(fieldErrors).length > 0) return;
        try {
            setSaving(true);
            setError(null);
            const res = await api.submitClaimFormPackage(claimId, { responses });
            if (!res.success) {
                const serverFieldErrors = ((res.error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors) || null;
                if (serverFieldErrors && Object.keys(serverFieldErrors).length > 0) {
                    setFieldErrors((prev) => ({ ...prev, ...serverFieldErrors }));
                }
                throw new Error(res.error?.message || 'Failed to submit claim form');
            }
            navigate(`/client/policy/${encodeURIComponent(policyId)}/claim/${encodeURIComponent(claimId)}`);
        } catch (e) {
            setError((e as Error).message || 'Submission failed');
        } finally {
            setSaving(false);
        }
    }, [claimPackage, missingRequired, fieldErrors, claimId, responses, navigate, policyId]);

    const goBackToClaim = useCallback(
        () => navigate(`/client/policy/${encodeURIComponent(policyId)}/claim/${encodeURIComponent(claimId)}`),
        [navigate, policyId, claimId],
    );

    return {
        loading, saving, error, fieldErrors,
        claimPackage, responses, fieldsBySection, missingRequired,
        setResponse, submit, goBackToClaim,
    };
}
