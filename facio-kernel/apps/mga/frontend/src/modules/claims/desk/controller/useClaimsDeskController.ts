import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useClaimsDeskVM } from '@/src/modules/claims/desk/hooks/useClaimsDeskVM';
import { applyDevelopment as applyDevelopmentCommand } from '@/src/modules/claims/commands/applyDevelopment';
import { confirmFnol as confirmFnolCommand } from '@/src/modules/claims/commands/confirmFnol';
import { linkPolicyToCase as linkPolicyToCaseCommand } from '@/src/modules/claims/commands/linkPolicyToCase';
import {
  requestFnolClarification as requestFnolClarificationCommand,
  resendFnolLink as resendFnolLinkCommand,
  saveIntakeDetails as saveIntakeDetailsCommand,
} from '@/src/modules/claims/commands/fnolIntake';
import { requestCaseInfo as requestCaseInfoCommand } from '@/src/modules/claims/commands/requestCaseInfo';
import { createCase as createCaseCommand } from '@/src/modules/claims/commands/createCase';
import { TAB_HASH_MAP } from '@/src/modules/claims/model/selectors';
import { getCreateDraftErrors, normalizePhone } from '@/src/modules/claims/desk/model/validators';
import {
  findClaimPaymentClassification,
  getClaimPaymentClassifications,
  getEligibleClaimPaymentPayees,
  sanitizeClaimPaymentSelection,
} from '@/src/modules/claims/desk/model/paymentOptions';
import { buildClaimsDeskViewModel } from '@/src/modules/claims/queries/getClaimsDeskVM';
import type { DevelopmentType, DevFormState } from '@/src/modules/claims/case/model/worksheetTypes';
import type { CreateCaseDraft, TabKey } from '@/src/modules/claims/model/types';
import { asRecord } from '@/src/shared/lib/record';
import { documentsApiClient } from '@/src/modules/policies/api/documentsApiClient';

const LAST_USED_ACTION_KEY = 'claimsDesk.lastUsedAction';

const KNOWN_DEVELOPMENT_TYPES = [
  'SET_RESERVE',
  'ADJUST_RESERVE',
  'ADD_PAYMENT',
  'SET_RECOVERY_EXPECTED',
  'ADD_RECOVERY_RECEIVED',
  'CREATE_APPOINTMENT',
  'DENY_CLAIM',
  'CLOSE',
  'REOPEN',
  'ADD_CLAIM_NOTE',
  'ADD_CLAIM_EVIDENCE',
] as const;

function isDevelopmentType(value: string): value is DevelopmentType {
  return (KNOWN_DEVELOPMENT_TYPES as readonly string[]).includes(value);
}

function readLastUsedAction(): DevelopmentType {
  if (typeof window === 'undefined') return 'SET_RESERVE';
  const stored = String(window.sessionStorage.getItem(LAST_USED_ACTION_KEY) || '').trim().toUpperCase();
  return isDevelopmentType(stored) ? stored : 'SET_RESERVE';
}

function saveLastUsedAction(next: DevelopmentType): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(LAST_USED_ACTION_KEY, next);
}

function loadingLabelFor(commandType: DevelopmentType): string {
  const labels: Record<DevelopmentType, string> = {
    SET_RESERVE: 'Applying reserve update…',
    ADJUST_RESERVE: 'Applying reserve adjustment…',
    ADD_PAYMENT: 'Applying payment…',
    SET_RECOVERY_EXPECTED: 'Applying recovery expectation…',
    ADD_RECOVERY_RECEIVED: 'Applying recovery receipt…',
    CREATE_APPOINTMENT: 'Applying appointment…',
    DENY_CLAIM: 'Applying denial…',
    CLOSE: 'Applying closure…',
    REOPEN: 'Applying reopen…',
    ADD_CLAIM_NOTE: 'Adding note…',
    ADD_CLAIM_EVIDENCE: 'Uploading evidence…',
  };
  return labels[commandType];
}

function successLabelFor(commandType: DevelopmentType): string {
  const labels: Record<DevelopmentType, string> = {
    SET_RESERVE: 'Reserve updated',
    ADJUST_RESERVE: 'Reserve adjusted',
    ADD_PAYMENT: 'Payment applied',
    SET_RECOVERY_EXPECTED: 'Recovery expectation recorded',
    ADD_RECOVERY_RECEIVED: 'Recovery receipt recorded',
    CREATE_APPOINTMENT: 'Appointment applied',
    DENY_CLAIM: 'Claim denied',
    CLOSE: 'Claim closed',
    REOPEN: 'Claim reopened',
    ADD_CLAIM_NOTE: 'Note added',
    ADD_CLAIM_EVIDENCE: 'Evidence uploaded',
  };
  return labels[commandType];
}

function toMoneyNumber(v: string): number {
  const raw = String(v || '').trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export const initialDevForm = (): DevFormState => ({
  bucket: 'INDEMNITY',
  costCategory: 'indemnity',
  costSubType: 'other',
  amount: '',
  effectiveDate: new Date().toISOString().slice(0, 10),
  reasonCode: '',
  reason: '',
  paymentType: 'INTERIM',
  payeeType: 'CLAIMANT',
  payeeCounterpartyId: '',
  showPaymentAdvanced: false,
  reference: '',
  invoiceReference: '',
  overrideOutstanding: '',
  recoveryType: 'THIRD_PARTY_INSURER',
  denialReason: 'NO_POLICY_COVER',
  closureReason: 'SETTLED',
  reopenReason: 'NEW_INFORMATION_RECEIVED',
  documentType: 'PHOTO',
  appointeeType: 'ADJUSTER',
  appointee: '',
  instruction: '',
  summary: '',
  deniedAt: new Date().toISOString().slice(0, 10),
  closeDate: new Date().toISOString().slice(0, 10),
  reopenDate: new Date().toISOString().slice(0, 10),
  withdrawnAt: new Date().toISOString().slice(0, 10),
});

interface UseClaimsDeskControllerArgs {
  routeClaimId: string;
}

export function useClaimsDeskController({ routeClaimId }: UseClaimsDeskControllerArgs) {
  const navigate = useNavigate();
  const location = useLocation();

  const isDetailView = Boolean(routeClaimId);
  const vmState = useClaimsDeskVM({ routeClaimId, isDetailView });
  const { worksheet, loading, policies, detailPolicy } = vmState.state;
  const {
    caseMode,
    hasMeaningfulIntakeData,
    awaitingFnolResponse,
    availableDevelopmentTypes,
    visibleTabs,
    intakeStatusPill,
    auditIndicator,
  } = vmState.derived;
  const { reloadWorksheet } = vmState.actions;

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [commandType, setCommandType] = useState<DevelopmentType>(() => readLastUsedAction());
  const [devForm, setDevForm] = useState<DevFormState>(initialDevForm);
  const [showDevelopmentComposer, setShowDevelopmentComposer] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyLoadingLabel, setApplyLoadingLabel] = useState('');
  const [applySuccessMessage, setApplySuccessMessage] = useState('');
  const [lastApplyTick, setLastApplyTick] = useState(0);
  const [error, setError] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLinkPolicyModal, setShowLinkPolicyModal] = useState(false);
  const [showCaseRequestInfoModal, setShowCaseRequestInfoModal] = useState(false);
  const [showIntakePathModal, setShowIntakePathModal] = useState(false);
  const [pendingIntakePathClaimId, setPendingIntakePathClaimId] = useState('');

  // Intake/FNOL Modals
  //
  // ABY-260 — Explicit user intent for the post-load action.
  //   - `CHOOSE_INTAKE_PATH`: the user just linked a policy (or created
  //     a known-policy case) and we should ask them whether to send
  //     the customer a FNOL link or open the intake drawer manually.
  //   - `OPEN_INTAKE_DRAWER`: the user already chose "Enter intake now"
  //     and we must open the amend drawer directly — without re-prompting
  //     the IntakePathModal, which produced the page-freeze loop Effie
  //     reported (the modal kept re-opening itself the moment the
  //     worksheet finished loading because the old effect used
  //     `!hasMeaningfulIntakeData` as both "ask the question" AND
  //     "respect the answer").
  type PendingPostLoadAction = 'CHOOSE_INTAKE_PATH' | 'OPEN_INTAKE_DRAWER';
  const [pendingPostLoadAction, setPendingPostLoadAction] = useState<PendingPostLoadAction | null>(null);
  const [showFnolReviewDrawer, setShowFnolReviewDrawer] = useState(false);
  const [showFnolAmendDrawer, setShowFnolAmendDrawer] = useState(false);
  const [showFnolClarificationDrawer, setShowFnolClarificationDrawer] = useState(false);
  const [forceGuidedManualResponse, setForceGuidedManualResponse] = useState(false);

  // Forms
  const [caseInfoMessage, setCaseInfoMessage] = useState('');
  const [newCaseStep, setNewCaseStep] = useState<1 | 2>(1);
  const [newCaseMode, setNewCaseMode] = useState<'KNOWN' | 'UNKNOWN'>('KNOWN');
  const [createDraft, setCreateDraft] = useState<CreateCaseDraft>({
    policyId: '',
    reporterType: 'LAWYER',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    shortDescription: '',
    dateOfLoss: new Date().toISOString().slice(0, 10),
    location: '',
    locationDetails: null,
    insuredName: '',
  });

  const createPolicyOptions = useMemo(
    () =>
      policies.map((policyItem) => {
        const policy = asRecord(policyItem);
        const id = String(policy.id || '');
        return {
          value: id,
          label: [policy.policyNumber, policy.insuredName].filter(Boolean).join(' • ') || id,
        };
      }),
    [policies],
  );

  const paymentRemainingReserve = useMemo(() => {
    const bucket = String(
      commandType === 'ADD_PAYMENT'
        ? (findClaimPaymentClassification(worksheet, devForm.costCategory, devForm.costSubType)?.operationalBucket || devForm.bucket)
        : devForm.bucket,
    ).trim().toUpperCase();
    const bucketState = (worksheet?.summary?.financials?.buckets || {})[bucket];
    const raw = Number((bucketState as { outstanding?: unknown } | undefined)?.outstanding || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }, [worksheet, commandType, devForm.bucket, devForm.costCategory, devForm.costSubType]);

  const selectedPaymentClassification = useMemo(
    () => findClaimPaymentClassification(worksheet, devForm.costCategory, devForm.costSubType),
    [worksheet, devForm.costCategory, devForm.costSubType],
  );

  const eligiblePaymentPayees = useMemo(
    () => getEligibleClaimPaymentPayees(worksheet, devForm.costCategory, devForm.costSubType),
    [worksheet, devForm.costCategory, devForm.costSubType],
  );

  const paymentClassifications = useMemo(
    () => getClaimPaymentClassifications(worksheet),
    [worksheet],
  );

  const paymentRemainingReserveLabel = useMemo(() => {
    const currency = String(worksheet?.summary?.cr0109_original_currency || 'EUR').toUpperCase();
    const amountText = paymentRemainingReserve.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return `${currency === 'EUR' ? '€' : `${currency} `}${amountText}`;
  }, [worksheet, paymentRemainingReserve]);

  const paymentInlineError = useMemo(() => {
    if (commandType !== 'ADD_PAYMENT') return '';
    const amount = toMoneyNumber(devForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return amount > paymentRemainingReserve ? 'Payment exceeds available reserve for the selected bucket.' : '';
  }, [commandType, devForm.amount, paymentRemainingReserve]);

  const setCommandTypeTracked = (next: DevelopmentType) => {
    setCommandType(next);
    saveLastUsedAction(next);
  };

  const focusClaimField = (fieldId: string) => {
    if (typeof document === 'undefined') return;
    const element = document.querySelector<HTMLElement>(`[data-claim-field="${fieldId}"]`);
    element?.focus();
  };

  useEffect(() => {
    if (!availableDevelopmentTypes.some((item) => String(asRecord(item).value || '') === commandType)) {
      const first = String(asRecord(availableDevelopmentTypes[0]).value || 'SET_RESERVE');
      const fallback = first as DevelopmentType;
      setCommandType(fallback);
      saveLastUsedAction(fallback);
    }
  }, [availableDevelopmentTypes, commandType]);

  useEffect(() => {
    if (!applySuccessMessage) return;
    const timer = window.setTimeout(() => {
      setApplySuccessMessage('');
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [applySuccessMessage]);

  useEffect(() => {
    const hashTab = location.hash.replace('#', '');
    const nextTab = (visibleTabs.some((tab) => String(asRecord(tab).id || '') === hashTab)
      ? (hashTab as TabKey)
      : TAB_HASH_MAP[hashTab] || '') as TabKey | '';
    if (nextTab) {
      if (hashTab !== nextTab) {
        navigate(`${location.pathname}#${nextTab}`, { replace: true });
      }
      setActiveTab(nextTab);
      return;
    }
    if (isDetailView) setActiveTab('overview');
  }, [location.hash, location.pathname, isDetailView, navigate, visibleTabs]);

  useEffect(() => {
    if (!worksheet || !pendingPostLoadAction) return;
    // Linked + confirmed worksheets never auto-open intake. Clear the
    // pending intent so we don't re-run on subsequent worksheet
    // reloads triggered by other commands.
    if (worksheet.case?.isUnlinked || worksheet.intake?.status === 'FNOL_CONFIRMED') {
      setPendingPostLoadAction(null);
      return;
    }
    if (pendingPostLoadAction === 'OPEN_INTAKE_DRAWER') {
      // ABY-260 — the user explicitly chose "Enter intake now" from
      // the IntakePathModal. Open the amend drawer directly. We MUST
      // NOT re-show the IntakePathModal here, even if intake data is
      // empty — that path was the page-freeze loop.
      setForceGuidedManualResponse(true);
      setShowFnolAmendDrawer(true);
    } else if (pendingPostLoadAction === 'CHOOSE_INTAKE_PATH') {
      // Post-link / post-create entry point: ask the operator how
      // they want to ingest the FNOL (send link vs enter manually).
      // If meaningful intake data already exists (re-entry into an
      // in-progress case), skip the question and open the amend
      // drawer in guided-manual mode.
      if (!hasMeaningfulIntakeData) {
        setPendingIntakePathClaimId(worksheet.claimId);
        setShowIntakePathModal(true);
      } else {
        setForceGuidedManualResponse(true);
        setShowFnolAmendDrawer(true);
      }
    }
    setPendingPostLoadAction(null);
  }, [worksheet, pendingPostLoadAction, hasMeaningfulIntakeData]);

  useEffect(() => {
    if (commandType !== 'ADD_PAYMENT') return;
    setDevForm((current) => {
      const next = sanitizeClaimPaymentSelection(worksheet, current);
      if (
        next.bucket === current.bucket
        && next.payeeCounterpartyId === current.payeeCounterpartyId
      ) {
        return current;
      }
      return next;
    });
  }, [worksheet, commandType, devForm.costCategory, devForm.costSubType, devForm.payeeCounterpartyId]);

  const applyDevelopment = async () => {
    if (!routeClaimId) return;
    if (commandType === 'ADD_PAYMENT') {
      const amount = toMoneyNumber(devForm.amount);
      if (!selectedPaymentClassification) {
        setError('Payment classification is required.');
        focusClaimField('costSubType');
        return;
      }
      if (!String(devForm.payeeCounterpartyId || '').trim()) {
        setError('Payee is required.');
        focusClaimField('payeeCounterpartyId');
        return;
      }
      if (
        selectedPaymentClassification.requiresInvoiceReference
        && !String(devForm.invoiceReference || devForm.reference || '').trim()
      ) {
        setError('Invoice reference is required for the selected payment type.');
        focusClaimField('invoiceReference');
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Payment amount must be greater than zero.');
        focusClaimField('amount');
        return;
      }
      if (paymentInlineError) {
        focusClaimField('amount');
        return;
      }
    }
    if (commandType === 'SET_RECOVERY_EXPECTED') {
      const amount = toMoneyNumber(devForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Expected recovery amount must be greater than zero.');
        focusClaimField('amount');
        return;
      }
      if (!String(devForm.bucket || '').trim()) {
        setError('Recovery bucket is required.');
        focusClaimField('bucket');
        return;
      }
      if (!String(devForm.recoveryType || '').trim()) {
        setError('Recovery source is required.');
        focusClaimField('recoveryType');
        return;
      }
    }
    if (commandType === 'ADD_RECOVERY_RECEIVED') {
      const amount = toMoneyNumber(devForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Recovery amount must be greater than zero.');
        focusClaimField('amount');
        return;
      }
      if (!String(devForm.bucket || '').trim()) {
        setError('Recovery bucket is required.');
        focusClaimField('bucket');
        return;
      }
      if (!String(devForm.recoveryType || '').trim()) {
        setError('Recovery source is required.');
        focusClaimField('recoveryType');
        return;
      }
    }
    if (commandType === 'CREATE_APPOINTMENT') {
      if (!String(devForm.appointeeType || '').trim()) {
        setError('Appointee type is required.');
        focusClaimField('appointeeType');
        return;
      }
      if (!String(devForm.appointee || '').trim()) {
        setError('Appointee is required.');
        focusClaimField('appointee');
        return;
      }
    }
    if (commandType === 'DENY_CLAIM') {
      if (!String(devForm.denialReason || '').trim()) {
        setError('Denial reason is required.');
        focusClaimField('denialReason');
        return;
      }
      if (!String(devForm.summary || '').trim()) {
        setError('Decision summary is required.');
        focusClaimField('summary');
        return;
      }
    }
    if (commandType === 'CLOSE') {
      if (!String(devForm.closureReason || '').trim()) {
        setError('Closure reason is required.');
        focusClaimField('closureReason');
        return;
      }
      if (!String(devForm.summary || '').trim()) {
        setError('Closure summary is required.');
        focusClaimField('summary');
        return;
      }
    }
    if (commandType === 'REOPEN') {
      if (!String(devForm.reopenReason || '').trim()) {
        setError('Reopen reason is required.');
        focusClaimField('reopenReason');
        return;
      }
      if (!String(devForm.summary || '').trim()) {
        setError('Reopen summary is required.');
        focusClaimField('summary');
        return;
      }
    }
    if (commandType === 'ADD_CLAIM_NOTE') {
      if (String(devForm.reason || '').trim().length < 4) {
        setError('Note must be at least 4 characters.');
        focusClaimField('reason');
        return;
      }
    }
    if (commandType === 'ADD_CLAIM_EVIDENCE') {
      if (!String(devForm.documentType || '').trim()) {
        setError('Document type is required.');
        focusClaimField('documentType');
        return;
      }
      if (!evidenceFile) {
        setError('A file is required.');
        focusClaimField('evidenceFile');
        return;
      }
    }
    setBusy(true);
    setApplyLoadingLabel(loadingLabelFor(commandType));
    setError('');
    try {
      if (commandType === 'ADD_CLAIM_EVIDENCE' && evidenceFile) {
        const uploadRes = await documentsApiClient.uploadDocument(evidenceFile);
        if (!uploadRes.success || !uploadRes.data) {
          throw new Error(uploadRes.error?.message || 'Evidence upload failed');
        }
        const upload = asRecord(uploadRes.data);
        const evidenceForm: DevFormState = {
          ...devForm,
          reference: String(upload.id || upload.documentId || ''),
          appointee: String(upload.filename || upload.name || evidenceFile.name || ''),
          instruction: String(upload.url || ''),
        };
        const res = await applyDevelopmentCommand(routeClaimId, commandType, evidenceForm);
        if (!res.success) throw new Error(res.error?.message || 'Failed to apply development');
      } else {
        const res = await applyDevelopmentCommand(routeClaimId, commandType, devForm);
        if (!res.success) throw new Error(res.error?.message || 'Failed to apply development');
      }
      setDevForm(initialDevForm());
      setEvidenceFile(null);
      setShowDevelopmentComposer(false);
      await reloadWorksheet();
      setApplySuccessMessage(successLabelFor(commandType));
      setLastApplyTick((value) => value + 1);
    } catch (e) {
      setError((e as Error).message || 'Failed to apply development');
    } finally {
      setApplyLoadingLabel('');
      setBusy(false);
    }
  };

  const confirmFnol = async () => {
    if (!routeClaimId) return;
    setBusy(true);
    setError('');
    try {
      const res = await confirmFnolCommand(routeClaimId);
      if (!res.success) throw new Error(res.error?.message || 'Failed to confirm intake');
      await reloadWorksheet();
    } catch (e) {
      setError((e as Error).message || 'Failed to confirm intake');
    } finally {
      setBusy(false);
    }
  };

  const requestFnolClarification = async (fieldsRequested: string[], message: string) => {
    if (!routeClaimId) return;
    setBusy(true);
    setError('');
    try {
      const res = await requestFnolClarificationCommand(routeClaimId, { fieldsRequested, message });
      if (!res.success) throw new Error(res.error?.message || 'Failed to request clarification');
      setShowFnolClarificationDrawer(false);
      await reloadWorksheet();
    } catch (e) {
      setError((e as Error).message || 'Failed to request clarification');
    } finally {
      setBusy(false);
    }
  };

  const linkPolicyToCase = async (policyId: string) => {
    if (!routeClaimId || !policyId) return;
    setBusy(true);
    setError('');
    try {
      const res = await linkPolicyToCaseCommand(routeClaimId, policyId);
      if (!res.success) throw new Error(res.error?.message || 'Failed to link policy');
      setShowLinkPolicyModal(false);
      // ABY-260 — after a successful link, ask the operator how to
      // ingest the FNOL (send link or enter manually). The post-load
      // effect handles the actual prompt once the worksheet reloads.
      setPendingPostLoadAction('CHOOSE_INTAKE_PATH');
      await reloadWorksheet();
    } catch (e) {
      setError((e as Error).message || 'Failed to link policy');
    } finally {
      setBusy(false);
    }
  };

  const requestCaseInfo = async () => {
    if (!routeClaimId || !caseInfoMessage.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await requestCaseInfoCommand(routeClaimId, { message: caseInfoMessage.trim() });
      if (!res.success) throw new Error(res.error?.message || 'Failed to request more information');
      setShowCaseRequestInfoModal(false);
      setCaseInfoMessage('');
      await reloadWorksheet();
    } catch (e) {
      setError((e as Error).message || 'Failed to request more information');
    } finally {
      setBusy(false);
    }
  };

  const chooseIntakePath = async (mode: 'REQUEST_FROM_CUSTOMER' | 'HANDLER_ENTERS_NOW') => {
    const claimId = pendingIntakePathClaimId;
    if (!claimId) return;
    if (mode === 'HANDLER_ENTERS_NOW') {
      setShowIntakePathModal(false);
      setPendingIntakePathClaimId('');
      // ABY-260 — the operator explicitly chose to enter intake now.
      // Record the intent BEFORE navigating so the post-load effect
      // opens the amend drawer directly (the previous shape re-asked
      // the IntakePathModal because the effect used `hasMeaningfulIntakeData`
      // as both the trigger and the answer; if intake was empty it
      // re-opened the modal — the page-freeze loop Effie reported).
      setPendingPostLoadAction('OPEN_INTAKE_DRAWER');
      navigate(`/claims/${claimId}#overview`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await resendFnolLinkCommand(claimId);
      if (!res.success) throw new Error(res.error?.message || 'Failed to send FNOL link');
      setShowIntakePathModal(false);
      setPendingIntakePathClaimId('');
      navigate(`/claims/${claimId}#overview`);
    } catch (e) {
      setError((e as Error).message || 'Failed to send FNOL link');
    } finally {
      setBusy(false);
    }
  };

  const resendFnolLink = async () => {
    if (!routeClaimId) return;
    setBusy(true);
    setError('');
    try {
      const res = await resendFnolLinkCommand(routeClaimId);
      if (!res.success) throw new Error(res.error?.message || 'Failed to resend FNOL link');
      await reloadWorksheet();
    } catch (e) {
      setError((e as Error).message || 'Failed to resend FNOL link');
    } finally {
      setBusy(false);
    }
  };

  const saveIntakeDetails = async (fnol: Record<string, unknown>, changes: Array<{ path: string; from: unknown; to: unknown }>) => {
    if (!routeClaimId) return;
    setBusy(true);
    setError('');
    try {
      const res = await saveIntakeDetailsCommand(routeClaimId, {
        hasExistingIntake: Boolean(worksheet?.intake?.currentVersion),
        fnol,
        changes,
      });
      if (!res.success) throw new Error(res.error?.message || 'Failed to save intake details');
      setShowFnolAmendDrawer(false);
      setShowFnolReviewDrawer(false);
      await reloadWorksheet();
    } catch (e) {
      setError((e as Error).message || 'Failed to save intake details');
    } finally {
      setBusy(false);
    }
  };

  const createDraftErrors = useMemo(
    () => getCreateDraftErrors(createDraft),
    [createDraft],
  );

  const disableCreateCasePrimary = busy
    || (newCaseStep === 2 && newCaseMode === 'KNOWN' ? !createDraft.policyId : false)
    || (
      newCaseStep === 2
      && newCaseMode === 'UNKNOWN'
      && (!createDraft.shortDescription.trim() || Object.values(createDraftErrors).some(Boolean))
    );

  const createCase = async () => {
    if (newCaseMode === 'KNOWN' && !createDraft.policyId) {
      setError('Please select a policy');
      return;
    }
    if (newCaseMode === 'UNKNOWN' && Object.values(createDraftErrors).some(Boolean)) {
      setError('Please fix case contact/date fields and try again.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await createCaseCommand({
        policyId: newCaseMode === 'KNOWN' ? createDraft.policyId : null,
        description: createDraft.shortDescription || undefined,
        caseIntakeDraft: newCaseMode === 'UNKNOWN' ? {
          reporterType: createDraft.reporterType,
          contactName: createDraft.contactName,
          contactPhone: normalizePhone(createDraft.contactPhone),
          contactEmail: createDraft.contactEmail,
          contactDetails: [normalizePhone(createDraft.contactPhone), createDraft.contactEmail].filter(Boolean).join(' • '),
          shortDescription: createDraft.shortDescription,
          dateOfLoss: createDraft.dateOfLoss,
          location: createDraft.location,
          locationDetails: createDraft.locationDetails || undefined,
          insuredName: createDraft.insuredName,
        } : undefined,
      });
      if (!res.success || !res.data) throw new Error(res.error?.message || 'Failed to create case');
      const createdId = String((res.data as { id?: string }).id || '');
      setShowCreateModal(false);
      setNewCaseStep(1);
      setNewCaseMode('KNOWN');
      setCreateDraft({
        policyId: '',
        reporterType: 'LAWYER',
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        shortDescription: '',
        dateOfLoss: new Date().toISOString().slice(0, 10),
        location: '',
        locationDetails: null,
        insuredName: '',
      });
      if (createdId) {
        if (newCaseMode === 'KNOWN') {
          setPendingIntakePathClaimId(createdId);
          setShowIntakePathModal(true);
        } else {
          navigate(`/claims/${createdId}#overview`);
        }
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to create case');
    } finally {
      setBusy(false);
    }
  };

  const openActivityFromOverview = (template?: DevelopmentType) => {
    if (template && availableDevelopmentTypes.some((item) => String(asRecord(item).value || '') === template)) {
      setCommandTypeTracked(template);
    }
    setShowDevelopmentComposer(true);
    navigate(`${location.pathname}#activity`);
  };

  const openPolicyFromOverview = () => {
    if (!detailPolicy?.id) return;
    navigate(`/policies/${encodeURIComponent(String(detailPolicy.id))}`);
  };

  const dismissApplySuccess = () => {
    setApplySuccessMessage('');
  };

  const dismissError = () => {
    setError('');
  };

  const vm = useMemo(
    () =>
      buildClaimsDeskViewModel({
        routeClaimId,
        activeTab,
        worksheet,
        caseMode,
      }),
    [activeTab, caseMode, routeClaimId, worksheet],
  );

  return {
    vm,
    state: {
      routeClaimId,
      isDetailView,
      worksheet,
      loading,
      policies,
      detailPolicy,
    },
    derived: {
      caseMode,
      hasMeaningfulIntakeData,
      awaitingFnolResponse,
      availableDevelopmentTypes,
      visibleTabs,
      intakeStatusPill,
      auditIndicator,
      createDraftErrors,
      disableCreateCasePrimary,
      createPolicyOptions,
    },
    local: {
      activeTab,
      commandType,
      devForm,
      showDevelopmentComposer,
      evidenceFile,
      busy,
      applyLoadingLabel,
      applySuccessMessage,
      lastApplyTick,
      paymentRemainingReserve,
      paymentRemainingReserveLabel,
      paymentInlineError,
      paymentClassifications,
      selectedPaymentClassification,
      eligiblePaymentPayees,
      error,
      showCreateModal,
      showLinkPolicyModal,
      showCaseRequestInfoModal,
      showIntakePathModal,
      newCaseStep,
      newCaseMode,
      caseInfoMessage,
      createDraft,
      showFnolReviewDrawer,
      showFnolAmendDrawer,
      showFnolClarificationDrawer,
      forceGuidedManualResponse,
    },
    mutators: {
      setCommandType: setCommandTypeTracked,
      setDevForm,
      setShowDevelopmentComposer,
      setEvidenceFile,
      setShowCreateModal,
      setShowLinkPolicyModal,
      setShowCaseRequestInfoModal,
      setShowIntakePathModal,
      setNewCaseStep,
      setNewCaseMode,
      setCaseInfoMessage,
      setCreateDraft,
      setShowFnolReviewDrawer,
      setShowFnolAmendDrawer,
      setShowFnolClarificationDrawer,
      setForceGuidedManualResponse,
    },
    actions: {
      applyDevelopment,
      confirmFnol,
      requestFnolClarification,
      linkPolicyToCase,
      requestCaseInfo,
      chooseIntakePath,
      resendFnolLink,
      saveIntakeDetails,
      createCase,
      openActivityFromOverview,
      openPolicyFromOverview,
      dismissApplySuccess,
      dismissError,
      reloadWorksheet,
    }
  };
}
