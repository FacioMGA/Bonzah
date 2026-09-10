/**
 * useClientProfileController — Controller for ClientProfilePage
 *
 * Owns: user state, form data, validation, save logic (including
 * policy amendment endorsements for material changes), and modal state.
 *
 * API ownership: clientPortalClient (listPolicies, endorsement draft commands).
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { clientPortalClient as api } from '@/src/surfaces/client/api/clientPortalClient';
import { countries as ALL_COUNTRIES } from '@facio/products';
import { addFlagsToCountryOptions } from '@/src/shared/lib/utils/countryOptions';
import { logger } from '@/src/shared/lib/logger';

type UnknownRecord = Record<string, unknown>;
type UserProfile = UnknownRecord & {
    firstName?: string;
    lastName?: string;
    name?: string;
    dateOfBirth?: string;
    dob?: string;
    addressLine?: string;
    address?: string;
    city?: string;
    province?: string;
    postCode?: string;
    zip?: string;
    country?: string;
    email?: string;
    telephone?: string;
    phone?: string;
    nationality?: string;
    nif?: string;
};

export type ProfileFormData = {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    addressLine: string;
    city: string;
    province: string;
    postCode: string;
    country: string;
    email: string;
    telephone: string;
    nationality: string;
    nif: string;
};

type PolicyRow = { id: string; status?: string };

const INITIAL_FORM: ProfileFormData = {
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    addressLine: '',
    city: '',
    province: '',
    postCode: '',
    country: 'Cyprus',
    email: '',
    telephone: '',
    // Canonical Nationality contract: country name, not demonym.
    nationality: 'Cyprus',
    nif: '',
};

function loadUserFromStorage(): UserProfile | null {
    try {
        const raw = localStorage.getItem('user_info');
        return raw ? (JSON.parse(raw) as UserProfile) : null;
    } catch {
        return null;
    }
}

function userToFormData(user: UserProfile): ProfileFormData {
    let fName = user.firstName || '';
    let lName = user.lastName || '';
    if (!fName && !lName && user.name) {
        const parts = user.name.split(' ');
        fName = parts[0];
        lName = parts.slice(1).join(' ');
    }
    return {
        firstName: fName,
        lastName: lName,
        dateOfBirth: user.dateOfBirth || user.dob || '',
        addressLine: user.addressLine || user.address || '',
        city: user.city || '',
        province: user.province || '',
        postCode: user.postCode || user.zip || '',
        country: user.country || 'Cyprus',
        email: user.email || '',
        telephone: user.telephone || user.phone || '',
        nationality: user.nationality || 'Cyprus',
        nif: user.nif || '',
    };
}

export function useClientProfileController() {
    const user = useMemo(() => loadUserFromStorage(), []);

    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<ProfileFormData>(INITIAL_FORM);
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [loadingPolicies, setLoadingPolicies] = useState(false);
    const [activePolicies, setActivePolicies] = useState<PolicyRow[]>([]);
    const [showToast, setShowToast] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (user) setFormData(userToFormData(user));
    }, [user]);

    const COUNTRY_OPTIONS = useMemo(
        () => addFlagsToCountryOptions([{ value: '', label: 'Select...' }, ...ALL_COUNTRIES.map((c) => ({ value: c, label: c }))]),
        [],
    );

    const validate = useCallback(() => {
        const errors: Record<string, string> = {};
        if (!formData.firstName) errors.firstName = 'Required';
        if (!formData.lastName) errors.lastName = 'Required';
        if (!formData.email) errors.email = 'Required';
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formData.firstName, formData.lastName, formData.email]);

    const performSave = useCallback(async (policiesToAmend: PolicyRow[] = []) => {
        setIsSaving(true);
        try {
            if (policiesToAmend.length > 0) {
                // Canonical payload path per ADR-0010: every proposer
                // field lives under `quoteData.proposer.*`. Flat keys at
                // the quoteData root are forbidden — the HTTP boundary
                // (`uwRouter.findLegacyTravelRootKey`) already rejects
                // them for travel; the consistency guard verifies the
                // nationality field specifically. The non-nationality
                // fields below are migrated as a follow-up.
                const amendmentChanges = {
                    quoteData: {
                        firstName: formData.firstName,
                        lastName: formData.lastName,
                        email: formData.email,
                        telephone: formData.telephone,
                        dateOfBirth: formData.dateOfBirth,
                        address: formData.addressLine,
                        city: formData.city,
                        postCode: formData.postCode,
                        country: formData.country,
                        province: formData.province,
                        proposer: {
                            nationality: formData.nationality,
                        },
                        nif: formData.nif,
                    },
                };

                const amendments = policiesToAmend.map(async (p) => {
                    const draft = await api.createEndorsementDraft(p.id, {
                        effectiveDate: new Date().toISOString(),
                        reason: 'Client Profile Update (Material Change)',
                    });
                    const riskTransactionId = String(
                        (draft as { data?: { riskTransactionId?: unknown } }).data?.riskTransactionId || '',
                    );
                    if (!riskTransactionId) {
                        throw new Error('Endorsement draft response missing riskTransactionId');
                    }
                    return api.patchEndorsementDraft(p.id, riskTransactionId, { quoteData: amendmentChanges });
                });

                await Promise.all(amendments);
            }

            const nextUser = {
                ...user,
                ...formData,
                name: `${formData.firstName} ${formData.lastName}`.trim(),
                phone: formData.telephone,
            };
            localStorage.setItem('user_info', JSON.stringify(nextUser));

            setIsEditing(false);
            setShowConfirmModal(false);
            setShowToast(true);
        } catch (err) {
            logger.error('Failed to save profile/amendments:', err);
            alert('There was an error updating your profile. Please try again.');
        } finally {
            setIsSaving(false);
        }
    }, [formData, user]);

    const handleSaveClick = useCallback(async () => {
        if (!validate()) return;

        setLoadingPolicies(true);
        try {
            const res = await api.listPolicies({ page: 1, pageSize: 100 });
            const policies = res.success && Array.isArray(res.data) ? res.data : [];

            const activeStatuses = new Set(['ACTIVE', 'ISSUED', 'BOUND']);
            const active = policies.filter((p: PolicyRow) =>
                activeStatuses.has(String(p.status || '').toUpperCase()),
            );

            if (active.length > 0) {
                setActivePolicies(active);
                setShowConfirmModal(true);
            } else {
                void performSave([]);
            }
        } catch (e) {
            logger.error('Failed to check policies', e);
            void performSave([]);
        } finally {
            setLoadingPolicies(false);
        }
    }, [validate, performSave]);

    const handleChange = useCallback((field: keyof ProfileFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setFormErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });
    }, []);

    const handleAddressSelect = useCallback((data: { address?: string; city?: string; state?: string; zip?: string; country?: string }) => {
        setFormData((prev) => ({
            ...prev,
            addressLine: data.address || prev.addressLine,
            city: data.city || prev.city,
            province: data.state || prev.province,
            postCode: data.zip || prev.postCode,
            country: data.country || prev.country,
        }));
    }, []);

    const startEditing = useCallback(() => setIsEditing(true), []);
    const closeModal = useCallback(() => setShowConfirmModal(false), []);
    const closeToast = useCallback(() => setShowToast(false), []);
    const confirmSave = useCallback(() => void performSave(activePolicies), [performSave, activePolicies]);

    return {
        // State
        isEditing,
        formData,
        formErrors,
        showConfirmModal,
        loadingPolicies,
        showToast,
        isSaving,

        // Derived
        countryOptions: COUNTRY_OPTIONS,

        // Actions
        startEditing,
        handleSaveClick,
        handleChange,
        handleAddressSelect,
        closeModal,
        closeToast,
        confirmSave,
    };
}
