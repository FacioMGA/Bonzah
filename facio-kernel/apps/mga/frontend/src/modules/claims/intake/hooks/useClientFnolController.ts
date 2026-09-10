/**
 * useClientFnolController — CHAMPS Controller Hook
 *
 * Owns: page state, effects, wizard navigation, API orchestration.
 * Does NOT own: payload building (clientFnol.submit), validation (clientFnol.validation),
 *               model extraction (clientFnol.model), incident config (clientFnol.submit).
 *
 * API ownership: portalApi (policy fetches) + claimsApiClient (FNOL) + documentsApiClient (uploads).
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PhoneInput from 'react-phone-number-input';
import flags from 'react-phone-number-input/flags';
import { clientPortalApiClient as portalApi } from '@/src/shared/api/clientPortalApiClient';
import { claimsApiClient } from '@/src/modules/claims/api/claimsApiClient';
import { documentsApiClient } from '@/src/modules/policies/api/documentsApiClient';
import { clampE164Phone, fnolPhoneInputClass, isoDate, toPhoneDefaultCountry, toRecord } from '../views/clientFnol.helpers';
import { computeFnolEligibility } from '../validation/clientFnol.validation';
import { resolveFnolGuidedRules } from '../validation/clientFnol.rules';
import { buildClientPolicyLabel, extractNamedDriversForPolicy } from '../model/clientFnol.model';
import { buildFnolSubmitPayload, FALLBACK_INCIDENT_CARDS } from '../actions/clientFnol.submit';
import { REGION_CONFIG } from '@/src/shared/config/region';
import type { FnolForm, PolicySummary, ClaimsContractDto, NamedDriver, FnolFieldErrors } from '../model/clientFnol.types';
import { ANOTHER_DRIVER_ID } from '../model/clientFnol.types';
import type { FnolUploadBuckets } from '../views/clientFnol.sections';
import { useFnolGuidedFlowCore } from './useFnolGuidedFlowCore';

// ─── Hook ───────────────────────────────────────────────────

export function useClientFnolController() {
    const navigate = useNavigate();
    const { policyId: policyIdFromRoute = '', token: publicFnolToken = '' } = useParams();
    const isPublicFnolFlow = Boolean(String(publicFnolToken || '').trim());

    // ── Core state ──

    const [loading, setLoading] = useState(true);
    const [policies, setPolicies] = useState<PolicySummary[]>([]);
    const [policyId, setPolicyId] = useState('');
    const [publicClaimId, setPublicClaimId] = useState('');
    const [publicClaimNumber, setPublicClaimNumber] = useState('');
    const [publicSubmitted, setPublicSubmitted] = useState(false);
    const [copiedReference, setCopiedReference] = useState(false);
    const [saving, setSaving] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [claimsContract, setClaimsContract] = useState<ClaimsContractDto | null>(null);
    const [uploads, setUploads] = useState<FnolUploadBuckets>({
        accidentLocation: [],
        vehicleDamage: [],
        policeReport: [],
        drivingLicence: [],
        vehicleRegistrationCertificate: [],
    });

    const defaultPhoneCountry: React.ComponentProps<typeof PhoneInput>['defaultCountry'] =
        toPhoneDefaultCountry(REGION_CONFIG.defaultRegionCode);
    const phoneInputFlags: NonNullable<React.ComponentProps<typeof PhoneInput>['flags']> = flags;

    const [form, setFormState] = useState<FnolForm>({
        driverId: '',
        driverContactPhone: '',
        driverContactEmail: '',
        unauthorizedDriverFirstName: '',
        unauthorizedDriverLastName: '',
        unauthorizedDriverDateOfBirth: '',
        unauthorizedDriverPhone: '',
        unauthorizedDriverEmail: '',
        incidentDate: isoDate(new Date()),
        incidentTime: '',
        location: '',
        city: '',
        country: 'Cyprus',
        incidentType: 'collision',
        description: '',
        thirdPartyInvolved: '',
        thirdPartyCounts: { another_car: 0, pedestrian: 0, property: 0 },
        thirdPartyAnotherCars: [],
        thirdPartyPedestrians: [],
        thirdPartyProperties: [],
        policeInvolved: '',
        policeReportNumber: '',
        policeStation: '',
        driverHasPermission: '',
        driverLicenseYearsHeld: '',
        driverLicenseIssuedCountry: '',
        carDrivable: '',
        injuriesReported: '',
        declarationAccepted: false,
    });
    // ── Derived state ──

    const selectedPolicy = useMemo(
        () => policies.find((p) => String(p.id || p.policyId) === String(policyId)) || null,
        [policies, policyId]
    );

    const namedDrivers = useMemo<NamedDriver[]>(
        () => extractNamedDriversForPolicy(selectedPolicy),
        [selectedPolicy]
    );

    const selectedDriver = useMemo(
        () => (form.driverId === ANOTHER_DRIVER_ID ? null : namedDrivers.find((d) => d.id === form.driverId) || null),
        [namedDrivers, form.driverId]
    );

    const eligibility = useMemo(
        () => computeFnolEligibility({ policyId, namedDrivers, form, contract: claimsContract }),
        [policyId, namedDrivers, form, claimsContract]
    );

    const {
        descriptionTrimmed,
        canContinueStep1,
        canContinueStep2,
        canContinueStep3,
        canContinueStep4,
        canContinueStep5,
        canSubmit,
        fieldErrors: computedFieldErrors,
    } = eligibility;
    const {
        step,
        setStep,
        nextStep,
        prevStep,
        setShowValidationErrors,
        setFormTracked,
        visibleFieldErrors,
    } = useFnolGuidedFlowCore({
        totalSteps: 6,
        canContinueByStep: {
            1: canContinueStep1,
            2: canContinueStep2,
            3: canContinueStep3,
            4: canContinueStep4,
            5: canContinueStep5,
        },
        computedFieldErrors,
        groupedFieldSources: {
            thirdPartyKinds: ['thirdPartyCounts'],
            thirdPartyAnotherCarDetails: ['thirdPartyAnotherCars', 'thirdPartyCounts'],
            thirdPartyPedestrianDetails: ['thirdPartyPedestrians', 'thirdPartyCounts'],
            thirdPartyPropertyDetails: ['thirdPartyProperties', 'thirdPartyCounts'],
        },
        formState: form,
        setFormState,
    });
    const fieldErrors = visibleFieldErrors as FnolFieldErrors;

    const driverStepTitle = form.incidentType === 'theft'
        ? 'Who was the last person who drove the car?'
        : form.incidentType === 'damage_parked'
            ? 'Who parked the car?'
            : 'Who was driving?';

    const incidentCards = useMemo(() => {
        const configured = claimsContract?.fnol?.incidentTypes || [];
        if (!configured.length) return FALLBACK_INCIDENT_CARDS;
        const fallbackById = new Map(FALLBACK_INCIDENT_CARDS.map((c) => [c.id, c]));
        return configured
            .map((cfg) => {
                const fallback = fallbackById.get(cfg.id as FnolForm['incidentType']);
                if (!fallback) return null;
                return { ...fallback, label: cfg.label || fallback.label };
            })
            .filter(Boolean) as typeof FALLBACK_INCIDENT_CARDS;
    }, [claimsContract]);

    const guidedRules = useMemo(
        () => resolveFnolGuidedRules({ contract: claimsContract, incidentType: form.incidentType }),
        [claimsContract, form.incidentType],
    );
    const showThirdPartyStep = guidedRules.requiresThirdParty;
    const requiresPoliceRef = guidedRules.requiresPoliceRef;
    const selectedThirdPartyKinds = Object.entries(form.thirdPartyCounts || {})
        .filter(([, n]) => Number(n) > 0)
        .map(([k]) => k);

    const totalSteps = 6;
    const descriptionEvidenceStep = 5;
    const reviewStep = 6;
    const hasRestoredDraftRef = useRef(false);
    const saveLaterNavigateTimeoutRef = useRef<number | null>(null);
    const localDraftKey = useMemo(() => {
        if (isPublicFnolFlow) {
            const token = String(publicFnolToken || '').trim();
            return token ? `facio.fnol.public.v1:${token}` : '';
        }
        const pid = String(policyId || policyIdFromRoute || '').trim();
        return pid ? `facio.fnol.client.v1:${pid}` : '';
    }, [isPublicFnolFlow, policyId, policyIdFromRoute, publicFnolToken]);

    // ── Effects ──

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);
                if (isPublicFnolFlow) {
                    const ctx = await portalApi.getPublicFnolContext(String(publicFnolToken));
                    if (!ctx.success || !ctx.data) {
                        setPolicies([]);
                        setPolicyId('');
                        setClaimsContract(null);
                        setPublicClaimId('');
                        setSubmitError(ctx.error?.message || 'Invalid or expired FNOL link');
                        return;
                    }
                    const full: PolicySummary = {
                        id: String(ctx.data.policyId || ''),
                        policyId: String(ctx.data.policyId || ''),
                        quoteData: toRecord(ctx.data.quoteData),
                    };
                    setPolicies([full]);
                    setPolicyId(String(full.id || full.policyId || ''));
                    setClaimsContract((ctx.data.contract || null) as ClaimsContractDto | null);
                    setPublicClaimId(String(ctx.data.claimId || ''));
                    setPublicClaimNumber(String(ctx.data.claimNumber || ''));
                    return;
                }
                if (policyIdFromRoute) {
                    const one = await portalApi.getPolicy(String(policyIdFromRoute));
                    if (one.success && one.data) {
                        const full = { ...(one.data as PolicySummary), id: String((one.data as PolicySummary)?.id || policyIdFromRoute) };
                        setPolicies([full]);
                        setPolicyId(String(full.id || full.policyId || ''));
                    } else {
                        setPolicies([]);
                        setPolicyId('');
                    }
                } else {
                    const pRes = await portalApi.listPolicies({ page: 1, pageSize: 200, statusIn: ['ACTIVE', 'ISSUED'], projection: 'compact' });
                    const data = pRes.success && pRes.data ? (Array.isArray(pRes.data) ? pRes.data : []) : [];
                    const normalized = data
                        .map((x) => ({ ...(x as PolicySummary), id: String((x as PolicySummary)?.id || (x as PolicySummary)?.policyId || '') }))
                        .filter((x) => Boolean(x?.id));
                    setPolicies(normalized);
                    const firstActive = normalized[0];
                    if (firstActive) setPolicyId(String(firstActive.id));
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [isPublicFnolFlow, policyIdFromRoute, publicFnolToken]);

    useEffect(() => {
        if (!selectedPolicy) return;
        const qd = selectedPolicy?.quoteData || {};
        setFormState((prev) => ({
            ...prev,
            country: String(qd?.countryOfRegistration || prev.country || 'Cyprus'),
        }));
    }, [selectedPolicy]);

    useEffect(() => {
        if (!namedDrivers.length) {
            setFormState((prev) => ({ ...prev, driverId: '', driverContactPhone: '', driverContactEmail: '' }));
            return;
        }
        setFormState((prev) => {
            const alreadyValid = namedDrivers.some((d) => d.id === prev.driverId);
            const pick = alreadyValid ? namedDrivers.find((d) => d.id === prev.driverId)! : namedDrivers[0];
            return {
                ...prev,
                driverId: pick.id,
                driverContactPhone: prev.driverContactPhone || clampE164Phone(pick.phone || ''),
                driverContactEmail: prev.driverContactEmail || pick.email || '',
            };
        });
    }, [namedDrivers]);

    useEffect(() => {
        if (isPublicFnolFlow) return;
        if (!policyId) {
            setClaimsContract(null);
            return;
        }
        (async () => {
            const res = await claimsApiClient.getPolicyClaimsContract(String(policyId));
            if (res.success && res.data) {
                const payload = res.data as { contract?: ClaimsContractDto };
                setClaimsContract(payload.contract || null);
                return;
            }
            setClaimsContract(null);
        })().catch(() => setClaimsContract(null));
    }, [isPublicFnolFlow, policyId]);

    useEffect(() => {
        return () => {
            if (saveLaterNavigateTimeoutRef.current) {
                window.clearTimeout(saveLaterNavigateTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (hasRestoredDraftRef.current || !localDraftKey || typeof window === 'undefined') return;
        hasRestoredDraftRef.current = true;
        try {
            const raw = window.localStorage.getItem(localDraftKey);
            if (!raw) return;
            const parsed = JSON.parse(raw) as {
                form?: Partial<FnolForm>;
                step?: number;
                uploads?: Partial<FnolUploadBuckets>;
            };
            if (parsed.form && typeof parsed.form === 'object') {
                setFormState((prev) => ({ ...prev, ...parsed.form }));
            }
            if (typeof parsed.step === 'number' && Number.isFinite(parsed.step)) {
                setStep(Math.max(1, Math.min(totalSteps, Math.trunc(parsed.step))));
            }
            if (parsed.uploads && typeof parsed.uploads === 'object') {
                const draftUploads = parsed.uploads;
                setUploads((prev) => ({
                    ...prev,
                    accidentLocation: Array.isArray(draftUploads.accidentLocation) ? draftUploads.accidentLocation : prev.accidentLocation,
                    vehicleDamage: Array.isArray(draftUploads.vehicleDamage) ? draftUploads.vehicleDamage : prev.vehicleDamage,
                    policeReport: Array.isArray(draftUploads.policeReport) ? draftUploads.policeReport : prev.policeReport,
                    drivingLicence: Array.isArray(draftUploads.drivingLicence) ? draftUploads.drivingLicence : prev.drivingLicence,
                    vehicleRegistrationCertificate: Array.isArray(draftUploads.vehicleRegistrationCertificate) ? draftUploads.vehicleRegistrationCertificate : prev.vehicleRegistrationCertificate,
                }));
            }
        } catch {
            // ignore malformed local drafts
        }
    }, [localDraftKey, setStep, totalSteps]);

    // ── Handlers ──

    const upload = useCallback(async (bucket: keyof FnolUploadBuckets, file: File) => {
        setSubmitError(null);
        try {
            const res = await documentsApiClient.uploadPublicDocument(file);
            if (!res.success || !res.data) throw new Error(res.error?.message || 'Upload failed');
            const url = String((res.data as { url?: string }).url || '');
            const filename = (res.data as { filename?: string }).filename;
            setUploads((prev) => ({ ...prev, [bucket]: [...prev[bucket], { name: file.name, url, filename }] }));
        } catch (e) {
            setSubmitError((e as Error).message || `Failed to upload ${file.name}`);
        }
    }, []);

    const uploadMany = useCallback(async (bucket: keyof FnolUploadBuckets, files: File[]) => {
        for (const f of files) {
            await upload(bucket, f);
        }
    }, [upload]);

    const removeUpload = useCallback((bucket: keyof FnolUploadBuckets, idx: number) => {
        setUploads((prev) => ({ ...prev, [bucket]: prev[bucket].filter((_, i) => i !== idx) }));
    }, []);

    const submit = useCallback(async () => {
        if (!canSubmit || !policyId) {
            setShowValidationErrors(true);
            return;
        }
        setSaving(true);
        setSubmitError(null);
        try {
            const { intake } = buildFnolSubmitPayload({
                form,
                descriptionTrimmed,
                selectedDriver,
                selectedThirdPartyKinds,
                uploads,
            });

            let claimId = isPublicFnolFlow ? String(publicClaimId || '') : '';
            if (!isPublicFnolFlow) {
                const fnolRes = await claimsApiClient.submitFnol(String(policyId), { form: intake });
                const fnolData = (fnolRes.data || {}) as { claimId?: string; claimNumber?: string };
                if (!fnolRes.success || !fnolData?.claimId) {
                    throw new Error(fnolRes?.error?.message || 'FNOL submission failed');
                }
                claimId = String(fnolData.claimId);
            }
            if (!claimId) throw new Error('Claim context missing for FNOL submission');

            if (isPublicFnolFlow) {
                const publicRes = await claimsApiClient.submitPublicFnol(String(publicFnolToken), { form: intake });
                if (!publicRes.success) {
                    const diagnostics = (publicRes.error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
                    const firstFieldError = diagnostics ? Object.values(diagnostics).find(Boolean) : null;
                    throw new Error(firstFieldError || publicRes.error?.message || 'Failed to submit FNOL');
                }
                if (localDraftKey && typeof window !== 'undefined') {
                    window.localStorage.removeItem(localDraftKey);
                }
                setPublicSubmitted(true);
                return;
            }
            const finalRes = await claimsApiClient.submitFnolFinal(claimId, { form: intake });
            if (!finalRes.success) {
                const diagnostics = (finalRes.error?.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
                const firstFieldError = diagnostics ? Object.values(diagnostics).find(Boolean) : null;
                throw new Error(firstFieldError || finalRes.error?.message || 'Failed to finalize FNOL');
            }
            if (localDraftKey && typeof window !== 'undefined') {
                window.localStorage.removeItem(localDraftKey);
            }
            navigate(`/client/policy/${encodeURIComponent(String(policyId))}/claim/${encodeURIComponent(claimId)}/fnol-instructions`);
        } catch (e) {
            setSubmitError((e as Error).message || 'Submission failed');
        } finally {
            setSaving(false);
        }
    }, [canSubmit, policyId, form, descriptionTrimmed, selectedDriver, selectedThirdPartyKinds, uploads, isPublicFnolFlow, publicClaimId, publicFnolToken, navigate, localDraftKey, setShowValidationErrors]);

    const backToPolicy = useCallback(() => {
        if (isPublicFnolFlow) return;
        if (policyId) navigate(`/client?policy=${encodeURIComponent(policyId)}`);
        else navigate('/client');
    }, [isPublicFnolFlow, policyId, navigate]);

    const saveAndContinueLater = useCallback(() => {
        if (!localDraftKey || typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(localDraftKey, JSON.stringify({
                form,
                step,
                uploads,
                updatedAt: new Date().toISOString(),
                policyId,
                isPublicFnolFlow,
            }));
        } catch {
            // ignore storage write failures
        }
        setToastMessage('Draft saved. You can continue later.');
        setShowToast(true);
        if (!isPublicFnolFlow) {
            if (saveLaterNavigateTimeoutRef.current) {
                window.clearTimeout(saveLaterNavigateTimeoutRef.current);
            }
            saveLaterNavigateTimeoutRef.current = window.setTimeout(() => {
                backToPolicy();
            }, 650);
        }
    }, [localDraftKey, form, step, uploads, policyId, isPublicFnolFlow, backToPolicy]);

    // ── Page chrome values ──

    const pageContainerClass = isPublicFnolFlow ? 'ui-page max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8' : 'ui-page max-w-7xl mx-auto space-y-8';
    const pageTitle = isPublicFnolFlow && publicSubmitted ? 'Incident report received' : 'Report an incident';
    const pageSubtitle = isPublicFnolFlow
        ? (publicSubmitted ? 'Thank you. Your FNOL has been submitted successfully.' : 'Please complete your FNOL details below.')
        : 'A quick guided flow. We already know your policy details.';

    const selectedPolicyLabel = selectedPolicy ? buildClientPolicyLabel(selectedPolicy) : '—';
    const anotherDriverName = [form.unauthorizedDriverFirstName, form.unauthorizedDriverLastName].filter(Boolean).join(' ') || 'Another driver';

    // ── Return ──

    return {
        // State
        loading,
        policyId,
        publicSubmitted,
        copiedReference,
        setCopiedReference,
        step,
        saving,
        submitError,
        showToast,
        toastMessage,
        setShowToast,
        form,
        setForm: setFormTracked,
        uploads,
        claimsContract,

        // Derived
        isPublicFnolFlow,
        selectedPolicy,
        namedDrivers,
        selectedDriver,
        eligibility,
        fieldErrors,
        canContinueStep1,
        canContinueStep2,
        canContinueStep3,
        canContinueStep4,
        canContinueStep5,
        canSubmit,
        driverStepTitle,
        incidentCards,
        showThirdPartyStep,
        requiresPoliceRef,
        totalSteps,
        descriptionEvidenceStep,
        reviewStep,
        pageContainerClass,
        pageTitle,
        pageSubtitle,
        selectedPolicyLabel,
        anotherDriverName,

        // Phone config
        defaultPhoneCountry,
        phoneInputFlags,
        phoneInputClass: fnolPhoneInputClass,

        // Constants
        ANOTHER_DRIVER_ID,

        // Actions
        nextStep,
        prevStep,
        backToPolicy,
        submit,
        saveAndContinueLater,
        uploadMany,
        removeUpload,
        publicClaimNumber,
    };
}
