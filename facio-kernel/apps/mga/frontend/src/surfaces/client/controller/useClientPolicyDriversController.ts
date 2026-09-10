/**
 * useClientPolicyDriversController — Controller for ClientPolicyDriversNewPage
 *
 * Owns: policy loading, driver list state, validation, endorsement orchestration
 * (create draft → patch → rate → bind → issue), and confirmation modal state.
 *
 * API ownership: clientPortalClient (getPolicy, createEndorsementDraft,
 * patchEndorsementDraft, rateEndorsementDraft, bindEndorsementDraft, issueEndorsement).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import {
    ageFromDateOfBirth,
    validateDriverDraft,
    youngestAgeFromDrivers,
    type DriverFieldErrors,
} from '@/src/products/motor/public';
import { REGION_CONFIG } from '@/src/shared/config/region';
import type PhoneInput from 'react-phone-number-input';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';

// ─── Types ───────────────────────────────────────────────────────
export type DriverDraft = {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    licenseYears: string;
    email: string;
    telephone: string;
};
type EditTarget =
  | { kind: 'new' }
  | { kind: 'current'; key: string }
  | { kind: 'pendingAdd'; key: string }
  | { kind: 'pendingUpdate'; beforeKey: string; afterKey: string; before: DriverDraft };

// ─── Helpers (pure) ──────────────────────────────────────────────
function normalizeDrivers(value: unknown): DriverDraft[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => asRecord(entry))
        .map((entry) => ({
            firstName: String(entry.firstName || '').trim(),
            lastName: String(entry.lastName || '').trim(),
            dateOfBirth: String(entry.dateOfBirth || '').trim(),
            licenseYears: String(entry.licenseYears ?? '').trim(),
            email: String(entry.email || '').trim(),
            telephone: String(entry.telephone || '').trim(),
        }))
        .filter((entry) => Boolean(entry.firstName || entry.lastName || entry.dateOfBirth || entry.licenseYears || entry.email || entry.telephone));
}

function stableDriverKey(driver: DriverDraft): string {
    return `${driver.firstName}|${driver.lastName}|${driver.dateOfBirth}`.toLowerCase();
}

function computeDriversDelta(previous: DriverDraft[], next: DriverDraft[]) {
    type DriverUpdate = { before: DriverDraft; after: DriverDraft };
    const prevMap = new Map(previous.map((d) => [stableDriverKey(d), d]));
    const nextMap = new Map(next.map((d) => [stableDriverKey(d), d]));
    const driversAdded = next.filter((d) => !prevMap.has(stableDriverKey(d)));
    const driversRemoved = previous.filter((d) => !nextMap.has(stableDriverKey(d)));
    const driversUpdated: DriverUpdate[] = next
        .filter((d) => prevMap.has(stableDriverKey(d)))
        .map((d) => {
            const prev = prevMap.get(stableDriverKey(d))!;
            if (prev.email !== d.email || prev.telephone !== d.telephone || prev.licenseYears !== d.licenseYears) {
                return { before: prev, after: d };
            }
            return null;
        })
        .filter((entry): entry is DriverUpdate => Boolean(entry));
    return { driversAdded, driversRemoved, driversUpdated };
}

export function toPhoneDefaultCountry(code: string): React.ComponentProps<typeof PhoneInput>['defaultCountry'] {
    switch (code) {
        case 'US': return 'US';
        case 'GB': return 'GB';
        case 'CY': return 'CY';
        case 'PT': return 'PT';
        case 'ES': return 'ES';
        default: return undefined;
    }
}

// ─── Controller ──────────────────────────────────────────────────
export function useClientPolicyDriversController() {
    const navigate = useNavigate();
    const { policyId = '' } = useParams();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const [mode, setMode] = useState<'view' | 'add' | 'edit'>('view');
    const [confirmIntent, setConfirmIntent] = useState<'save' | 'remove'>('save');
    const [drivers, setDrivers] = useState<DriverDraft[]>([]);
    const [editTarget, setEditTarget] = useState<EditTarget>({ kind: 'new' });
    const [draftDriver, setDraftDriver] = useState<DriverDraft | null>(null);
    const [draftErrors, setDraftErrors] = useState<DriverFieldErrors>({});
    const [originalDrivers, setOriginalDrivers] = useState<DriverDraft[]>([]);
    const [baseQuoteData, setBaseQuoteData] = useState<UnknownRecord>({});

    const defaultPhoneCountry = toPhoneDefaultCountry(REGION_CONFIG.defaultRegionCode);

    useEffect(() => {
        const run = async () => {
            if (!policyId) return;
            setLoading(true);
            setError(null);
            try {
                const resp = await api.getPolicy(policyId);
                if (!resp?.success || !resp.data) throw new Error(resp?.error?.message || 'Policy not found');
                const quoteData = asRecord(resp.data.quoteData);
                const parsedDrivers = normalizeDrivers(quoteData.additionalDrivers);
                setDrivers(parsedDrivers);
                setDraftDriver(null);
                setDraftErrors({});
                setMode('view');
                setOriginalDrivers(parsedDrivers);
                setBaseQuoteData(quoteData);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load policy');
            } finally {
                setLoading(false);
            }
        };
        void run();
    }, [policyId]);

    const mainDriver = useMemo(() => {
        const firstName = String(baseQuoteData.firstName || '').trim();
        const lastName = String(baseQuoteData.lastName || '').trim();
        return {
            fullName: [firstName, lastName].filter(Boolean).join(' ') || 'Policy holder',
            dateOfBirth: String(baseQuoteData.dateOfBirth || '').trim(),
            email: String(baseQuoteData.email || '').trim(),
            telephone: String(baseQuoteData.telephone || '').trim(),
        };
    }, [baseQuoteData]);

    const setDraftField = useCallback((key: keyof DriverDraft, value: string) => {
        setDraftDriver((prev) => ({ ...(prev || { firstName: '', lastName: '', dateOfBirth: '', licenseYears: '', email: '', telephone: '' }), [key]: value }));
        setDraftErrors((prev) => {
            const next: DriverFieldErrors = { ...(prev || {}) };
            delete next[key as keyof DriverFieldErrors];
            return next;
        });
    }, []);

    const validateDraftDriver = useCallback(() => {
        const candidate = draftDriver || { firstName: '', lastName: '', dateOfBirth: '', licenseYears: '', email: '', telephone: '' };
        const nextErrors = validateDriverDraft(candidate, { requireCore: true });
        setDraftErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
    }, [draftDriver]);

    const startAddDriver = useCallback(() => {
        setMode('add');
        setEditTarget({ kind: 'new' });
        setDraftDriver({ firstName: '', lastName: '', dateOfBirth: '', licenseYears: '', email: '', telephone: '' });
        setDraftErrors({});
    }, []);

    const startEditDriver = useCallback((index: number) => {
        const target = originalDrivers[index];
        if (!target) return;
        setMode('edit');
        setEditTarget({ kind: 'current', key: stableDriverKey(target) });
        setDraftDriver({ ...target });
        setDraftErrors({});
    }, [originalDrivers]);

    const startEditPendingAdd = useCallback((driver: DriverDraft) => {
        setMode('edit');
        setEditTarget({ kind: 'pendingAdd', key: stableDriverKey(driver) });
        setDraftDriver({ ...driver });
        setDraftErrors({});
    }, []);

    const startEditPendingUpdate = useCallback((before: DriverDraft, after: DriverDraft) => {
        setMode('edit');
        setEditTarget({
            kind: 'pendingUpdate',
            before,
            beforeKey: stableDriverKey(before),
            afterKey: stableDriverKey(after),
        });
        setDraftDriver({ ...after });
        setDraftErrors({});
    }, []);

    const removeDraftDriver = useCallback(() => {
        setDraftDriver(null);
        setDraftErrors({});
        setMode('view');
        setEditTarget({ kind: 'new' });
    }, []);

    const cancelEdit = useCallback(() => {
        setDraftDriver(null);
        setDraftErrors({});
        setMode('view');
        setEditTarget({ kind: 'new' });
        setShowConfirm(false);
        setConfirmIntent('save');
    }, []);

    const openConfirm = useCallback(() => {
        if (!validateDraftDriver()) return;
        setConfirmIntent('save');
        setShowConfirm(true);
    }, [validateDraftDriver]);

    const openRemoveConfirm = useCallback(() => {
        setConfirmIntent('remove');
        setShowConfirm(true);
    }, []);

    const closeConfirm = useCallback(() => setShowConfirm(false), []);

    const backToPolicy = useCallback(() => navigate(`/client?policy=${encodeURIComponent(policyId)}`), [navigate, policyId]);

    const addAnotherDriver = useCallback(() => {
        if (mode !== 'add') return;
        const candidate = draftDriver || { firstName: '', lastName: '', dateOfBirth: '', licenseYears: '', email: '', telephone: '' };
        const nextErrors = validateDriverDraft(candidate, { requireCore: true });
        setDraftErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        setDrivers((prev) => [...prev, candidate]);
        setDraftDriver({ firstName: '', lastName: '', dateOfBirth: '', licenseYears: '', email: '', telephone: '' });
        setDraftErrors({});
        setShowConfirm(false);
        setMode('add');
    }, [draftDriver, mode]);

    const confirmAndSubmit = useCallback(async () => {
        if (!policyId) return;
        setSaving(true);
        setError(null);
        try {
            const draft = draftDriver || { firstName: '', lastName: '', dateOfBirth: '', licenseYears: '', email: '', telephone: '' };
            let nextDrivers: DriverDraft[] = [...drivers];
            if (confirmIntent === 'remove' && mode === 'edit') {
                if (editTarget.kind === 'current') {
                    nextDrivers = drivers.filter((driver) => stableDriverKey(driver) !== editTarget.key);
                } else if (editTarget.kind === 'pendingAdd') {
                    nextDrivers = drivers.filter((driver) => stableDriverKey(driver) !== editTarget.key);
                } else if (editTarget.kind === 'pendingUpdate') {
                    nextDrivers = drivers.map((driver) =>
                        stableDriverKey(driver) === editTarget.afterKey ? editTarget.before : driver
                    );
                }
            } else if (mode === 'add') {
                nextDrivers = [...drivers, draft];
            } else if (mode === 'edit') {
                if (editTarget.kind === 'current') {
                    nextDrivers = drivers.map((driver) => (stableDriverKey(driver) === editTarget.key ? draft : driver));
                } else if (editTarget.kind === 'pendingAdd') {
                    nextDrivers = drivers.map((driver) => (stableDriverKey(driver) === editTarget.key ? draft : driver));
                } else if (editTarget.kind === 'pendingUpdate') {
                    nextDrivers = drivers.map((driver) =>
                        stableDriverKey(driver) === editTarget.afterKey ? draft : driver
                    );
                }
            }
            const normalizedDrivers = normalizeDrivers(nextDrivers);
            const hasAdditionalDrivers = normalizedDrivers.length > 0;
            const declaredYoungestAge = Number(baseQuoteData.youngestDriverAge);
            const nextQuoteData = {
                ...baseQuoteData,
                hasAdditionalDrivers,
                additionalDrivers: normalizedDrivers,
            };
            const driversDelta = computeDriversDelta(originalDrivers, normalizedDrivers);
            const hasYoungerNewDriver =
                Number.isFinite(declaredYoungestAge) &&
                declaredYoungestAge > 0 &&
                driversDelta.driversAdded.some((driver) => {
                    const age = ageFromDateOfBirth(String(driver?.dateOfBirth || ''));
                    return age !== null && age < declaredYoungestAge;
                });
            const hasYoungDriver = normalizedDrivers.some((driver) => {
                const age = ageFromDateOfBirth(String(driver?.dateOfBirth || ''));
                return age !== null && age < 25;
            });
            const hasLowLicenseYears = normalizedDrivers.some((driver) => {
                const years = Number(String(driver?.licenseYears || '').trim());
                return Number.isFinite(years) && years < 2;
            });
            const requiresUwReview = hasYoungerNewDriver || hasYoungDriver || hasLowLicenseYears;

            const draftResp = await api.createEndorsementDraft(policyId, {
                effectiveDate: new Date().toISOString(),
                reason: 'Driver details updated by customer',
                reasonCode: 'DRIVERS_CHANGE',
            });
            if (!draftResp?.success) throw new Error(draftResp?.error?.message || 'Failed to create endorsement draft');
            const riskTransactionId = String((draftResp.data as UnknownRecord)?.riskTransactionId || '').trim();
            if (!riskTransactionId) throw new Error('Missing endorsement draft id');

            const youngestFromDraftDrivers = youngestAgeFromDrivers(normalizedDrivers);
            const nextQuoteDataWithYoungest =
                hasYoungerNewDriver && youngestFromDraftDrivers !== null
                    ? { ...nextQuoteData, youngestDriverAge: youngestFromDraftDrivers }
                    : nextQuoteData;

            const patched = await api.patchEndorsementDraft(policyId, riskTransactionId, {
                quoteData: nextQuoteDataWithYoungest,
                endorsementMeta: {
                    changeType: 'DRIVERS_CHANGE',
                    driversDelta,
                    pendingUnderwritingReview: requiresUwReview,
                    pendingUnderwritingReasons: [
                        ...(hasYoungerNewDriver ? ['NEW_DRIVER_BELOW_DECLARED_YOUNGEST_AGE'] : []),
                        ...(hasYoungDriver ? ['YOUNG_DRIVER_UNDER_25'] : []),
                        ...(hasLowLicenseYears ? ['LOW_LICENSE_EXPERIENCE'] : []),
                    ],
                    submittedByCustomerAt: new Date().toISOString(),
                    recalculatedYoungestDriverAge: hasYoungerNewDriver ? youngestFromDraftDrivers : undefined,
                },
            });
            if (!patched?.success) throw new Error(patched?.error?.message || 'Failed to patch endorsement draft');

            if (requiresUwReview) {
                window.alert(
                    'Your request was submitted for underwriting review. We created an endorsement draft for manual approve/bind/issue in back office.',
                );
                setDrivers(normalizedDrivers);
                setOriginalDrivers(normalizedDrivers);
                setBaseQuoteData((prev) => ({ ...prev, hasAdditionalDrivers: normalizedDrivers.length > 0, additionalDrivers: normalizedDrivers }));
                setDraftDriver(null);
                setDraftErrors({});
                setMode('view');
                setEditTarget({ kind: 'new' });
                return;
            }

            const rated = await api.rateEndorsementDraft(policyId, riskTransactionId);
            if (!rated?.success) throw new Error(rated?.error?.message || 'Failed to rate endorsement draft');
            const bound = await api.bindEndorsementDraft(policyId, riskTransactionId);
            if (!bound?.success) throw new Error(bound?.error?.message || 'Failed to bind endorsement draft');
            const issued = await api.issueEndorsement(policyId, riskTransactionId);
            if (!issued?.success) throw new Error(issued?.error?.message || 'Failed to issue endorsement');

            setDrivers(normalizedDrivers);
            setOriginalDrivers(normalizedDrivers);
            setBaseQuoteData((prev) => ({ ...prev, hasAdditionalDrivers: normalizedDrivers.length > 0, additionalDrivers: normalizedDrivers }));
            setDraftDriver(null);
            setDraftErrors({});
            setMode('view');
            setEditTarget({ kind: 'new' });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to process driver endorsement');
        } finally {
            setSaving(false);
            setShowConfirm(false);
        }
    }, [policyId, confirmIntent, mode, editTarget, draftDriver, drivers, baseQuoteData, originalDrivers]);

    const removePendingAddition = useCallback((driver: DriverDraft) => {
        const key = stableDriverKey(driver);
        setDrivers((prev) => prev.filter((d) => stableDriverKey(d) !== key));
    }, []);

    const removePendingUpdate = useCallback((before: DriverDraft, after: DriverDraft) => {
        const afterKey = stableDriverKey(after);
        setDrivers((prev) => prev.map((d) => (stableDriverKey(d) === afterKey ? before : d)));
    }, []);

    const removePendingRemoval = useCallback((before: DriverDraft) => {
        setDrivers((prev) => [...prev, before]);
    }, []);

    const pending = useMemo(() => computeDriversDelta(originalDrivers, drivers), [originalDrivers, drivers]);

    const canAddAnotherDriver = mode === 'add' && confirmIntent === 'save';
    const isRemoveIntent = confirmIntent === 'remove';
    const removeButtonLabel =
        mode === 'add'
            ? 'Discard'
            : editTarget.kind === 'pendingAdd' || editTarget.kind === 'pendingUpdate'
                ? 'Remove Pending Change'
                : 'Remove Driver';

    return {
        loading, saving, error, showConfirm,
        mode, drivers, draftDriver, draftErrors, mainDriver,
        currentDrivers: originalDrivers,
        pending,
        defaultPhoneCountry,
        canSubmit: !saving,
        canAddAnotherDriver, isRemoveIntent,
        removeButtonLabel,
        setDraftField, startAddDriver, startEditDriver, startEditPendingAdd, startEditPendingUpdate,
        removeDraftDriver, cancelEdit, removePendingAddition, removePendingUpdate, removePendingRemoval,
        openConfirm, openRemoveConfirm, closeConfirm, addAnotherDriver, backToPolicy, confirmAndSubmit,
    };
}
