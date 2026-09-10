import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { policiesClient as api } from '../api/policiesClient';
import { programsApiClient } from '@/src/modules/programs/api/programsApiClient';
import type { PolicyRecord } from '../model/policy';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';
import type { QuestionnaireStatus } from '../underwriting/hooks/usePolicyUnderwritingTab';

// Hoisted to module scope so the reference identity is stable across renders.
// Re-creating this inside the hook makes useEffect see a fresh array every
// render and forces the deps array to ignore it via an eslint-disable, which
// then masks future legitimate missing-dep warnings.
const ACTIVE_QUESTIONNAIRE_STATUSES: readonly QuestionnaireStatus[] = [
  'Sent',
  'Follow-ups requested',
  'Submitted',
];

function toNormalizedString(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function inferUwYear(binder: UnknownRecord): number | null {
  const agreement = String(binder.agreementNumber || '').trim();
  const yearMatch = agreement.match(/(20\d{2})$/);
  if (yearMatch) return Number(yearMatch[1]);
  const twoDigitPrefix = agreement.match(/^(\d{2})[A-Z]/i);
  if (twoDigitPrefix) return 2000 + Number(twoDigitPrefix[1]);
  const startDate = String(binder.startDate || '').trim();
  if (startDate) {
    const parsed = new Date(startDate);
    if (!Number.isNaN(parsed.getTime())) return parsed.getUTCFullYear();
  }
  return null;
}

function binderSortKey(binder: UnknownRecord): number {
  return inferUwYear(binder) || 0;
}

function resolveBinderId(input: unknown, binders: UnknownRecord[]): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const byId = binders.find((b) => String(b.id || '') === raw);
  if (byId) return String(byId.id || '');

  const normalized = toNormalizedString(raw);
  const byAlias = binders.find((b) => {
    const agreement = toNormalizedString(b.agreementNumber);
    const umr = toNormalizedString(b.umr);
    const binderNumber = toNormalizedString(b.binderNumber);
    return normalized === agreement || normalized === umr || normalized === binderNumber;
  });
  return byAlias ? String(byAlias.id || '') : raw;
}

// ABY-249 — do not filter the program/binder dropdowns by the policy's
// current `productType`. The operator must see every active option so
// they can switch product. `productTypeOfProgram` is used only to
// *prefer* a matching program when auto-hydrating an existing product,
// never to hide options.

function productTypeOfProgram(program: UnknownRecord): string {
  return String(program.productType || '').trim().toUpperCase();
}

function authorityIsActiveAt(authority: UnknownRecord, effectiveAt: Date): boolean {
  if (String(authority.status || '').trim().toUpperCase() !== 'ACTIVE') return false;

  const effectiveFromValue = authority.effectiveFrom;
  if (effectiveFromValue) {
    const effectiveFrom = new Date(String(effectiveFromValue));
    if (Number.isNaN(effectiveFrom.getTime()) || effectiveAt < effectiveFrom) return false;
  }

  const effectiveToValue = authority.effectiveTo;
  if (effectiveToValue) {
    const effectiveTo = new Date(String(effectiveToValue));
    if (Number.isNaN(effectiveTo.getTime()) || effectiveAt > effectiveTo) return false;
  }

  return true;
}

/**
 * A binder selection can establish a product only when its active authority
 * is unambiguous. The server remains the canonical writer and validates the
 * selected pair; this is a BO convenience for the one-product case, never a
 * client-side preference between products or programs.
 */
function pickProgramForBinderSelection(
  programs: UnknownRecord[],
  binders: UnknownRecord[],
  binderId: string,
): UnknownRecord | undefined {
  const binder = binders.find((b) => String(b.id || '') === String(binderId));
  if (!binder) return undefined;

  const authorities = Array.isArray(binder.productAuthorities)
    ? (binder.productAuthorities as UnknownRecord[])
    : [];
  const activeProductCodes = new Set(authorities
    .filter((authority) => authorityIsActiveAt(asRecord(authority), new Date()))
    .map((authority) => String(asRecord(authority).productCode || '').trim().toUpperCase())
    .filter(Boolean));

  if (activeProductCodes.size !== 1) return undefined;

  const [productCode] = activeProductCodes;
  const matches = programs.filter((program) =>
    productTypeOfProgram(program) === productCode
    && programHasActiveBinderLink(program, binderId));
  return matches.length === 1 ? matches[0] : undefined;
}

function activeBinderLinksForProgram(program: UnknownRecord): UnknownRecord[] {
  const binderLinks = Array.isArray(program.binderLinks) ? (program.binderLinks as UnknownRecord[]) : [];
  return binderLinks.filter((link) => String(asRecord(link).status || '').toUpperCase() === 'ACTIVE');
}

function programHasActiveBinderLink(program: UnknownRecord, binderId: string): boolean {
  const selectedBinder = String(binderId || '').trim();
  if (!selectedBinder) return false;
  return activeBinderLinksForProgram(program).some((link) => {
    const linkRecord = asRecord(link);
    return String(linkRecord.binderId || '') === selectedBinder;
  });
}

function binderAuthorizesProduct(binder: UnknownRecord, productCode: string, effectiveAt = new Date()): boolean {
  const targetProduct = String(productCode || '').trim().toUpperCase();
  if (!targetProduct) return true;
  const authorities = Array.isArray(binder.productAuthorities) ? (binder.productAuthorities as UnknownRecord[]) : [];
  return authorities.some((authority) => {
    const row = asRecord(authority);
    if (String(row.productCode || '').trim().toUpperCase() !== targetProduct) return false;
    if (String(row.status || '').toUpperCase() !== 'ACTIVE') return false;
    const effectiveFrom = row.effectiveFrom ? new Date(String(row.effectiveFrom)) : null;
    if (effectiveFrom && !Number.isNaN(effectiveFrom.getTime()) && effectiveAt < effectiveFrom) return false;
    const effectiveTo = row.effectiveTo ? new Date(String(row.effectiveTo)) : null;
    if (effectiveTo && !Number.isNaN(effectiveTo.getTime()) && effectiveAt > effectiveTo) return false;
    return true;
  });
}

/** Meta passed to the confirmation callback so the modal can show informative labels. */
export type PendingProductChangeConfirmation = {
  fromProductLabel: string;
  toProductLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

type PendingProgramBinderSave = {
  policyId: string;
  programId: string;
  binderId: string;
  timer: ReturnType<typeof setTimeout> | null;
  run: () => Promise<boolean>;
};

type UsePolicyProgramsBindersArgs = {
  view: string;
  activeTab: string;
  selectedPortfolio: PolicyRecord | null;
  selectedPortfolioId?: string;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
  /** Current questionnaire send status — used to guard product/binder changes. */
  qStatus: QuestionnaireStatus;
  /** Called when a binder/program change would supersede an active questionnaire.
   *  The hook passes confirm/cancel callbacks; the caller shows a modal. */
  onConfirmationNeeded: (meta: PendingProductChangeConfirmation) => void;
  /** Human-readable product label for the currently loaded binder (used in modal copy). */
  currentProductLabel?: string;
  /** Refreshes the canonical policy identity after a program/binder assignment persists. */
  onAssignmentPersisted?: () => void;
};

export function usePolicyProgramsBinders(args: UsePolicyProgramsBindersArgs) {
  const { view, activeTab, selectedPortfolio, selectedPortfolioId, setToastMessage, setShowToast, qStatus, onConfirmationNeeded, currentProductLabel, onAssignmentPersisted } = args;
  const shouldLoadProgramBinderData = view === 'detail' && (activeTab === 'Underwriting' || activeTab === 'Premium');

  const [programs, setPrograms] = useState<UnknownRecord[]>([]);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState<string>('');

  const [activeBinders, setActiveBinders] = useState<UnknownRecord[]>([]);
  const [selectedBinderId, setSelectedBinderId] = useState<string>('');
  const [bindersLoading, setBindersLoading] = useState(false);
  const [_programBinderSaving, setProgramBinderSaving] = useState(false);
  const programBinderSaveSeqRef = useRef(0);
  const programBinderLastSavedRef = useRef<{ policyId: string; programId: string; binderId: string } | null>(null);
  const pendingProgramBinderSaveRef = useRef<PendingProgramBinderSave | null>(null);
  const userInitiatedChangeRef = useRef(false);
  const selectedPolicyProductType = String(asRecord(selectedPortfolio).productType || '').trim().toUpperCase();

  useEffect(() => {
    userInitiatedChangeRef.current = false;
  }, [selectedPortfolioId]);

  const selectBinderByOperator = (nextBinderId: string) => {
    userInitiatedChangeRef.current = true;
    setSelectedBinderId(nextBinderId);
  };
  const selectProgramByOperator = (nextProgramId: string) => {
    userInitiatedChangeRef.current = true;
    setSelectedProgramId(nextProgramId);
  };

  useEffect(() => {
    if (!shouldLoadProgramBinderData) return;
    let cancelled = false;
    (async () => {
      try {
        setBindersLoading(true);
        const resp = await programsApiClient.listBinders();
        if (!resp.success) throw new Error(resp.error?.message || 'Failed to load binders');
        const binders = Array.isArray(resp.data) ? (resp.data as UnknownRecord[]) : [];
        const actives = binders
          .filter((b) => String(b.status || '').toUpperCase() === 'ACTIVE')
          .sort((a, b) => binderSortKey(b) - binderSortKey(a));
        if (cancelled) return;
        setActiveBinders(actives);
      } catch {
        if (cancelled) return;
        setActiveBinders([]);
      } finally {
        if (!cancelled) setBindersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldLoadProgramBinderData]);

  useEffect(() => {
    if (!shouldLoadProgramBinderData) return;
    let cancelled = false;
    (async () => {
      try {
        setProgramsLoading(true);
        const resp = await programsApiClient.listPrograms();
        if (!resp.success) throw new Error(resp.error?.message || 'Failed to load programs');
        if (cancelled) return;
        const list = Array.isArray(resp.data) ? (resp.data as UnknownRecord[]) : [];
        const actives = list.filter((p) => String(p.status || '').toUpperCase() === 'ACTIVE');
        const ordered = actives.length ? actives : list;
        setPrograms(ordered);
      } catch {
        if (cancelled) return;
        setPrograms([]);
      } finally {
        if (!cancelled) setProgramsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldLoadProgramBinderData]);

  // ABY-249 — the BO operator must see EVERY active binder, regardless of
  // the policy's current product type. The whole point of the new-policy
  // flow is: pick a binder first, and the policy's product is derived
  // from that binder's authority. Filtering the dropdown by the policy's
  // already-assigned product (introduced in a9af8b91 "prevent invalid
  // binder assignment") makes it physically impossible for the operator
  // to switch a default-assigned policy onto a different binder, which
  // breaks the canonical "binder defines the product" workflow.
  //
  // The "prevent invalid assignment" intent from a9af8b91 is still
  // honoured on the SAVE side: the auto-save effect below refuses to
  // call `assignPolicyProgramBinder` when the selected binder lacks
  // authority for the policy's product (or when the selected program
  // is not actually linked to the selected binder). That guard lives
  // in the effect that calls `doSave` and is intentionally narrower
  // than what the dropdown displays.
  const availableBinders = useMemo(() => activeBinders, [activeBinders]);

  const availablePrograms = useMemo(() => {
    // No binder selected yet → show every active program. The operator
    // can pick either side of the (program, binder) pair first.
    if (!selectedBinderId) {
      return programs.filter((p) => String(p.status || '').toUpperCase() === 'ACTIVE');
    }
    const selectedBinder = String(selectedBinderId || '').trim();
    // Narrow programs to those that have an ACTIVE link to the selected
    // binder. We deliberately do NOT filter further by the policy's
    // current `productType` — that filter was what hid Motor/Home
    // programs the moment a policy happened to be defaulted to Travel
    // (ABY-249).
    return programs.filter((program) => {
      if (String(program.status || '').toUpperCase() !== 'ACTIVE') return false;
      return programHasActiveBinderLink(program, selectedBinder);
    });
  }, [programs, selectedBinderId]);

  const selectedPortfolioBinderId = asRecord(selectedPortfolio)?.binderId;
  useEffect(() => {
    if (bindersLoading || programsLoading) return;
    // Loading completion must not rehydrate the persisted binder over a
    // selection the operator has just made. The selected program effect below
    // either derives the only authoritative pair or leaves Program blank.
    if (userInitiatedChangeRef.current && selectedBinderId) return;
    if (availableBinders.length === 0) {
      if (selectedBinderId) setSelectedBinderId('');
      return;
    }
    const currentValid = availableBinders.some((b) => String(b.id || '') === String(selectedBinderId));
    if (currentValid) return;
    const policyBinderId = resolveBinderId(selectedPortfolioBinderId, availableBinders);
    if (policyBinderId && availableBinders.some((b) => String(b.id || '') === policyBinderId)) {
      setSelectedBinderId(policyBinderId);
      return;
    }
    // ABY-249 / ABY-438 — when the policy already has a `productType` but
    // no binder, default to a binder that authorises that product. Do NOT
    // fall back to `availableBinders[0]` on a product-less draft: that
    // stamped Open Market (or whichever binder sorts first) and then the
    // save-side guard froze the product so the operator could not switch.
    if (!selectedPolicyProductType) {
      if (selectedBinderId) setSelectedBinderId('');
      return;
    }
    const preferred = availableBinders.find((b) => binderAuthorizesProduct(b, selectedPolicyProductType));
    if (!preferred) {
      if (selectedBinderId) setSelectedBinderId('');
      return;
    }
    setSelectedBinderId(String(preferred.id || ''));
  }, [availableBinders, bindersLoading, programsLoading, selectedBinderId, selectedPortfolioBinderId, selectedPolicyProductType]);

  useEffect(() => {
    if (!selectedPortfolioBinderId) return;
    const resolved = resolveBinderId(selectedPortfolioBinderId, activeBinders);
    if (resolved) setSelectedBinderId(resolved);
  }, [selectedPortfolioBinderId, activeBinders]);

  const selectedPortfolioProgramId = asRecord(selectedPortfolio)?.programId;
  useEffect(() => {
    if (selectedPortfolioProgramId) setSelectedProgramId(String(selectedPortfolioProgramId));
  }, [selectedPortfolioProgramId]);

  useEffect(() => {
    // Only validate/reset the programId against the loaded program list when programs were
    // actually fetched (i.e. Underwriting tab was active). When programs are not loaded,
    // the ID is correctly sourced from selectedPortfolioProgramId and must not be cleared.
    if (!shouldLoadProgramBinderData) return;
    if (programsLoading || bindersLoading) return;
    if (availablePrograms.length === 0) {
      if (selectedProgramId) setSelectedProgramId('');
      return;
    }
    const valid = availablePrograms.some((p) => String(p.id || '') === String(selectedProgramId));
    if (valid) return;
    // ABY-436 / ABY-438 — prefer the program that owns the policy's
    // current product (Immigration/HEALTH must not snap to Home or
    // Business). A product-less draft stays unselected until the
    // operator picks — auto-picking `availablePrograms[0]` was the
    // Open Market revert.
    if (userInitiatedChangeRef.current && selectedBinderId) {
      // A binder change may establish the product only when the canonical
      // authority relation yields exactly one linked program. Do not choose
      // the first result for a multi-product binder just because the policy
      // previously had a different product.
      const paired = pickProgramForBinderSelection(availablePrograms, activeBinders, selectedBinderId);
      if (paired) {
        setSelectedProgramId(String(paired.id || ''));
        return;
      }
      setSelectedProgramId('');
      return;
    }

    const preferred = selectedPolicyProductType
      ? availablePrograms.find((program) => productTypeOfProgram(program) === selectedPolicyProductType)
      : undefined;
    if (!preferred) {
      setSelectedProgramId('');
      return;
    }
    setSelectedProgramId(String(preferred.id || ''));
  }, [shouldLoadProgramBinderData, availablePrograms, activeBinders, bindersLoading, programsLoading, selectedBinderId, selectedProgramId, selectedPolicyProductType]);

  const selectedPortfolioRecordIdForTracking = asRecord(selectedPortfolio)?.id;
  const selectedPortfolioPolicyIdForTracking = asRecord(selectedPortfolio)?.policyId;
  useEffect(() => {
    if (!selectedPortfolioId) return;
    // Always track/save against the policy DB id (UUID), not the business policy number.
    const policyId = String(selectedPortfolioRecordIdForTracking || selectedPortfolioId);
    const programId = selectedPortfolioProgramId;
    const binderId = resolveBinderId(selectedPortfolioBinderId, activeBinders);
    if (!policyId || !programId || !binderId) return;
    programBinderLastSavedRef.current = {
      policyId,
      programId: String(programId),
      binderId: String(binderId),
    };
  }, [selectedPortfolioBinderId, selectedPortfolioId, selectedPortfolioRecordIdForTracking, selectedPortfolioPolicyIdForTracking, selectedPortfolioProgramId, activeBinders]);

  const selectedPortfolioRecordId = asRecord(selectedPortfolio)?.id;
  const selectedPortfolioPolicyId = asRecord(selectedPortfolio)?.policyId;
  const selectedPortfolioIsLocked = asRecord(selectedPortfolio)?.isLocked;
  const selectedPortfolioPolicyIsLocked = asRecord(asRecord(selectedPortfolio)?.policy)?.isLocked;

  const ensureProgramBinderAssigned = useCallback(async (
    policyId: string,
    programId: string,
    binderId: string,
  ): Promise<boolean> => {
    const last = programBinderLastSavedRef.current;
    if (last?.policyId === policyId && last.programId === programId && last.binderId === binderId) {
      return true;
    }

    const pending = pendingProgramBinderSaveRef.current;
    if (pending?.policyId !== policyId || pending.programId !== programId || pending.binderId !== binderId) {
      return false;
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    return await pending.run();
  }, []);

  /** qStatus values that require a confirmation modal before a product/binder change is applied. */
  useEffect(() => {
    if (!shouldLoadProgramBinderData) return;
    if (!selectedPortfolioId) return;
    if (selectedPortfolioId === 'new') return;
    if (bindersLoading || programsLoading) return;

    const locked = Boolean(selectedPortfolioIsLocked || selectedPortfolioPolicyIsLocked);
    if (locked) return;

    const policyId = String(selectedPortfolioRecordId || selectedPortfolioId);
    if (!policyId) return;
    if (!selectedProgramId || !selectedBinderId) return;
    if (!availableBinders.some((b) => String(b.id || '') === String(selectedBinderId))) return;
    if (!availablePrograms.some((p) => String(p.id || '') === String(selectedProgramId))) return;

    // ABY-249 — auto-hydration must not persist a binder that lacks
    // authority for the policy's *current* product (that would silently
    // rewrite Travel → Motor). ABY-438 — an *operator* binder/program
    // change is the canonical way to switch product: PUT /program-binder
    // derives `productType` from the newly selected program and asserts
    // authority for that new product. Blocking the save against the
    // stale productType is what made "product cannot be selected".
    const selectedBinderRecord = activeBinders.find((b) => String(b.id || '') === String(selectedBinderId));
    const binderMatchesCurrentProduct = !selectedPolicyProductType
      || Boolean(selectedBinderRecord && binderAuthorizesProduct(selectedBinderRecord, selectedPolicyProductType));
    if (!binderMatchesCurrentProduct && !userInitiatedChangeRef.current) {
      return;
    }
    // ABY-438 — a product-less new submission must not auto-stamp the
    // first program/binder (Open Market). Wait for the operator.
    if (!selectedPolicyProductType && !userInitiatedChangeRef.current) {
      return;
    }

    const last = programBinderLastSavedRef.current;
    if (last && last.policyId === policyId && last.programId === selectedProgramId && last.binderId === selectedBinderId) return;

    // If the user has changed product/binder while a questionnaire is active, intercept
    // and ask for confirmation before persisting the change to the backend.
    const isProductChangeWithActiveQuestionnaire =
      ACTIVE_QUESTIONNAIRE_STATUSES.includes(qStatus) &&
      last !== null && // Not the initial load (we only guard user-initiated changes)
      (last.binderId !== selectedBinderId || last.programId !== selectedProgramId);

    const doSave = async (seq: number, isCancelled: () => boolean): Promise<boolean> => {
      setProgramBinderSaving(true);
      try {
        const resp = await api.assignPolicyProgramBinder(policyId, selectedProgramId, selectedBinderId);
        if (isCancelled()) return false;
        if (seq !== programBinderSaveSeqRef.current) return false;
        if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to assign program/binder');
        programBinderLastSavedRef.current = { policyId, programId: selectedProgramId, binderId: selectedBinderId };
        onAssignmentPersisted?.();
        return true;
      } catch (e: unknown) {
        if (isCancelled()) return false;
        if (seq !== programBinderSaveSeqRef.current) return false;
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setToastMessage(`Failed to save binder/program: ${msg}`);
        setShowToast(true);
        return false;
      } finally {
        if (!isCancelled() && seq === programBinderSaveSeqRef.current) {
          userInitiatedChangeRef.current = false;
          setProgramBinderSaving(false);
        }
      }
    };

    if (isProductChangeWithActiveQuestionnaire) {
      const seq = ++programBinderSaveSeqRef.current;
      let cancelled = false;
      const newBinder = availableBinders.find((b) => String(asRecord(b).id || '') === selectedBinderId);
      const toProductLabel = newBinder
        ? [
            String(asRecord(newBinder).leadCapacityProviderName || asRecord(newBinder).coverholderName || 'Unknown leader'),
            String(asRecord(newBinder).productLabel || asRecord(newBinder).authorizedClass || asRecord(newBinder).agreementNumber || ''),
          ].filter(Boolean).join(' – ')
        : 'New product';
      onConfirmationNeeded({
        fromProductLabel: currentProductLabel || 'current product',
        toProductLabel,
        onConfirm: () => { void doSave(seq, () => cancelled); },
        onCancel: () => {
          cancelled = true;
          userInitiatedChangeRef.current = false;
          // Revert optimistic selection back to last saved values.
          if (programBinderLastSavedRef.current) {
            setSelectedBinderId(programBinderLastSavedRef.current.binderId);
            setSelectedProgramId(programBinderLastSavedRef.current.programId);
          }
        },
      });
      return;
    }

    const seq = ++programBinderSaveSeqRef.current;
    let cancelled = false;
    let savePromise: Promise<boolean> | null = null;
    const pending: PendingProgramBinderSave = {
      policyId,
      programId: selectedProgramId,
      binderId: selectedBinderId,
      timer: null,
      run: () => {
        cancelled = false;
        savePromise ??= doSave(seq, () => cancelled).finally(() => {
          if (pendingProgramBinderSaveRef.current === pending) pendingProgramBinderSaveRef.current = null;
        });
        return savePromise;
      },
    };
    const t = setTimeout(() => {
      pending.timer = null;
      void pending.run();
    }, 350);
    pending.timer = t;
    pendingProgramBinderSaveRef.current = pending;
    return () => {
      if (!savePromise) {
        cancelled = true;
        clearTimeout(t);
      }
      if (pendingProgramBinderSaveRef.current === pending) {
        pendingProgramBinderSaveRef.current = null;
      }
    };
  // `onAssignmentPersisted` is a stable controller callback. Including it
  // here restarts the debounce during an operator's picker change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shouldLoadProgramBinderData,
    selectedPortfolioId,
    selectedPortfolioRecordId,
    selectedPortfolioPolicyId,
    selectedPortfolioIsLocked,
    selectedPortfolioPolicyIsLocked,
    selectedProgramId,
    selectedBinderId,
    availableBinders,
    availablePrograms,
    activeBinders,
    selectedPolicyProductType,
    bindersLoading,
    programsLoading,
    qStatus,
    onConfirmationNeeded,
    currentProductLabel,
    setShowToast,
    setToastMessage,
    ensureProgramBinderAssigned,
  ]);

  return {
    selectedBinderId,
    setSelectedBinderId: selectBinderByOperator,
    availableBinders,
    bindersLoading,
    selectedProgramId,
    setSelectedProgramId: selectProgramByOperator,
    programs: availablePrograms,
    programsLoading,
    ensureProgramBinderAssigned,
  };
}
