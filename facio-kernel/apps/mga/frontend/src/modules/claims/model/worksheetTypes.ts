export type Worksheet = {
  claimId: string;
  claimReference: string;
  policyId: string | null;
  case?: {
    isUnlinked: boolean;
    firstNotifiedAt: string;
    policyLinkedAt?: string | null;
    intakeDraft?: {
      reporterType?: string;
      contactName?: string;
      contactPhone?: string;
      contactEmail?: string;
      contactDetails?: string;
      shortDescription?: string;
      dateOfLoss?: string;
      location?: string;
      locationDetails?: {
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
      } | null;
      insuredName?: string;
    } | null;
    infoRequests?: Array<{
      id: string;
      status: string;
      message: string;
      requestedAt: string;
      requestedByUserId?: string;
      responseMessage?: string;
      respondedAt?: string;
      resolvedAt?: string;
      resolvedByUserId?: string;
    }>;
  };
  policyNumber: string;
  topBar: {
    status: string;
    phase: string;
    referredToUw: 'Y' | 'N';
    denied: 'Y' | 'N';
    lastUpdatedAt?: string;
    lastActorName?: string;
  };
  summary: {
    claimType?: string;
    description?: string;
    cr0029_certificate_reference?: string;
    cr0119_date_of_loss_from?: string;
    cr0120_date_of_loss_to?: string;
    cr0116_loss_country?: string;
    cr0117_cause_of_loss_code?: string;
    cr0118_loss_description?: string;
    cr0109_original_currency?: string;
    fnolFinalSubmittedAt?: string;
    financials: {
      totalPaid: number;
      totalOutstanding: number;
      totalIncurred: number;
      grossIncurred?: number;
      totalRecovered: number;
      netIncurred: number;
      recoveriesExpected: number;
      salvageRealized?: number;
      salvageExpected?: number;
      buckets: Record<string, {
        paid: number;
        outstanding: number;
        recovered: number;
        recoveryExpected: number;
        salvageRealized?: number;
        salvageExpected?: number;
      }>;
    };
  };
  intake?: {
    status: 'NONE' | 'FNOL_SUBMITTED' | 'AWAITING_CLARIFICATION' | 'FNOL_CONFIRMED';
    currentVersion?: number;
    confirmedVersion?: number;
    fnol?: Record<string, unknown>;
    submittedAt?: string;
    submittedBy?: { actorType?: string; actorId?: string; actorName?: string };
    confirmedAt?: string;
    confirmedBy?: { actorType?: string; actorId?: string; actorName?: string };
    clarificationOpen: boolean;
    clarificationHistory?: Array<{
      requestId: string;
      sentAt: string;
      sentBy?: { actorType?: string; actorId?: string; actorName?: string };
      fieldsRequested: string[];
      message?: string;
      receivedAt?: string;
      receivedBy?: { actorType?: string; actorId?: string; actorName?: string };
      responseMessage?: string;
    }>;
    amendments: Array<{
      fromVersion: number;
      toVersion: number;
      amendedAt: string;
      amendedBy?: { actorType?: string; actorId?: string; actorName?: string };
      changes?: Array<{ path: string; from: unknown; to: unknown }>;
    }>;
    changedFields?: Array<{
      path: string;
      changedAt: string;
      changedBy?: { actorType?: string; actorId?: string; actorName?: string };
    }>;
    gates: Array<{ key: string; label: string; status: 'PASS' | 'FAIL'; reason?: string }>;
    requiredActions: Array<{
      id: string;
      title: string;
      severity: 'BLOCKING' | 'IMPORTANT' | 'INFO';
      cta?: { label: string; commandType: string };
      reason?: string;
    }>;
  };
  timeline: Array<{
    id: string;
    eventType: string;
    occurredAt: string;
    actorName?: string;
    payload?: Record<string, unknown>;
  }>;
  documents: Array<Record<string, unknown>>;
  paymentModel?: {
    classifications: Array<{
      costCategory: 'indemnity' | 'fees';
      costSubType: 'other' | 'expense' | 'attorney_coverage_fee' | 'adjuster_fee' | 'defence_fee' | 'tpa_fee';
      allowedPayeeRoles: Array<'insured' | 'claimant' | 'third_party' | 'repairer' | 'legal_provider' | 'adjuster' | 'expert' | 'tpa' | 'medical_provider' | 'vendor' | 'other'>;
      reportingTreatment: 'indemnity' | 'fees';
      operationalBucket: 'INDEMNITY' | 'DEFENCE_COSTS' | 'ADJUSTER_FEES' | 'LEGAL_FEES' | 'OTHER';
      requiresInvoiceReference: boolean;
      requiresNote: boolean;
      uiLabel: string;
      guidance?: string | null;
    }>;
    payees: Array<{
      id: string;
      claimId: string;
      name: string;
      entityType: 'person' | 'organisation';
      roles: Array<'insured' | 'claimant' | 'third_party' | 'repairer' | 'legal_provider' | 'adjuster' | 'expert' | 'tpa' | 'medical_provider' | 'vendor' | 'other'>;
      status: string;
      providerType?: string;
      sourceType?: string;
    }>;
  };
  comms: {
    entityType: string;
    entityId: string;
    policyholder?: { name: string; email: string; phone: string };
    /**
     * Actual worker delivery state for the most-recent FNOL intake link
     * email, as recorded on the `communication_messages` row by the
     * `COMMUNICATION_OUTBOUND` worker (ABY-268). `null` means the
     * backend did not return the field (older clients / no FNOL link
     * has been queued yet).
     */
    fnolLinkDelivery?: {
      status: 'QUEUED' | 'SENT' | 'FAILED' | 'UNKNOWN';
      recipient: string | null;
      queuedAt: string | null;
      sentAt: string | null;
      deliveredAt: string | null;
      errorCode: string | null;
      errorDetail: string | null;
      attemptCount: number;
      messageId: string | null;
    };
  };
  complianceGaps: string[];
};

export const DEVELOPMENT_TYPES = [
  { value: 'SET_RESERVE', label: 'Set reserve' },
  { value: 'ADJUST_RESERVE', label: 'Adjust reserve' },
  { value: 'ADD_PAYMENT', label: 'Record payment' },
  { value: 'SET_RECOVERY_EXPECTED', label: 'Record recovery expected' },
  { value: 'ADD_RECOVERY_RECEIVED', label: 'Record recovery received' },
  { value: 'CREATE_APPOINTMENT', label: 'Appoint party' },
  { value: 'DENY_CLAIM', label: 'Deny claim' },
  { value: 'CLOSE', label: 'Close claim' },
  { value: 'REOPEN', label: 'Reopen claim' },
  { value: 'ADD_CLAIM_NOTE', label: 'Add note' },
  { value: 'ADD_CLAIM_EVIDENCE', label: 'Upload evidence' },
] as const;

export type DevelopmentType = (typeof DEVELOPMENT_TYPES)[number]['value'];

export type DevFormState = {
  bucket: string;
  costCategory: 'indemnity' | 'fees';
  costSubType: 'other' | 'expense' | 'attorney_coverage_fee' | 'adjuster_fee' | 'defence_fee' | 'tpa_fee';
  amount: string;
  effectiveDate: string;
  reasonCode: string;
  reason: string;
  paymentType: string;
  payeeType: string;
  payeeCounterpartyId: string;
  showPaymentAdvanced: boolean;
  reference: string;
  invoiceReference: string;
  overrideOutstanding: string;
  recoveryType: string;
  denialReason: string;
  closureReason: string;
  reopenReason: string;
  documentType: string;
  appointeeType: string;
  appointee: string;
  instruction: string;
  summary: string;
  deniedAt: string;
  closeDate: string;
  reopenDate: string;
  withdrawnAt: string;
};
