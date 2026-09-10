export type SanctionProvider = 'creditsafe';
export type SanctionSubjectType = 'individual' | 'business';
export type SanctionOutcome =
  | 'clear'
  | 'non_blocking_hit'
  | 'possible_match'
  | 'match'
  | 'provider_unavailable'
  | 'error';

export type ComplianceDecisionType = 'allow_bind' | 'block_bind' | 'manual_review_required';
export type ComplianceReasonCode =
  | 'NO_HITS'
  | 'NON_BLOCKING_HITS'
  | 'HITS_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'SCREENING_ERROR';

export type ScreeningActionType =
  // Retired as an active gate (ADR-0067): nothing screens at quote time any
  // more — a price preview never calls Creditsafe. The value is kept so the
  // concept can be re-introduced later as a NON-blocking audit screen without
  // another enum change; re-adding a blocking quote gate needs a new ADR.
  | 'QUOTE_RATE'
  // Pre-payment chokepoint (public CardCorp checkout). We hold the customer's
  // real, saved identity by the time they reach payment, so we screen here and
  // refuse to open the payment page on a block or provider outage (ADR-0067).
  | 'PAYMENT_CHECKOUT'
  | 'POLICY_BIND'
  | 'POLICY_BIND_COVERAGE'
  | 'POLICY_ISSUE'
  | 'PUBLIC_API_BIND_ISSUE'
  | 'PAYMENT_ISSUE';

/**
 * Compact projection of the top hit returned by the provider — the row we
 * surface in BO underwriting + premium tabs (per the Creditsafe AML hit row
 * UI). Mirrors the columns in the BO screenshot: Match %, Name, Country,
 * DOB, Gender, PEP Tier, Reason Listed, Hit ID.
 *
 * `hitIdsAll` is the full list of hit ids returned for the search; we keep
 * it so the PDF download endpoint can request a report covering every hit
 * (Creditsafe's `/searches/individuals/{searchId}/download` takes a hit-id
 * array).
 */
export type SanctionFirstHit = {
  matchScore: number | null;
  name: string;
  country: string;
  dateOfBirth: string;
  gender: string;
  pepTier: string;
  reasonsListed: string;
  hitId: string;
  hitIdsAll: string[];
};

export type SanctionSearchResult = {
  provider: SanctionProvider;
  providerSearchId?: string;
  outcome: SanctionOutcome;
  blocking: boolean;
  hitCount: number;
  providerStatus?: string;
  providerRiskRating?: string;
  firstHit?: SanctionFirstHit;
  raw: unknown;
};

export type SanctionScreeningRunRecord = {
  id: string;
  tenantId: string;
  policyId?: string | null;
  quoteSessionId?: string | null;
  customerId?: string | null;
  provider: SanctionProvider;
  providerSearchId?: string;
  subjectType: SanctionSubjectType;
  subjectName: string;
  countryCodes: string[];
  threshold: number;
  datasets: string[];
  actionType: ScreeningActionType;
  outcome: SanctionOutcome;
  blocking: boolean;
  hitCount: number;
  providerStatus?: string;
  providerRiskRating?: string;
  firstHit?: SanctionFirstHit | null;
  /**
   * `Document.id` of the PDF report fetched from the provider (Creditsafe
   * KYC Protect AML PDF). Only populated for blocking hits; null otherwise
   * because Creditsafe charges credits per PDF and non-blocking hits are
   * already preserved in `responseJson`.
   */
  reportDocumentId?: string | null;
  /** Stored filename for direct linking from BO UI via `/api/documents/{filename}`. */
  reportFilename?: string | null;
  requestJson: unknown;
  responseJson: unknown;
  executedAt: Date;
  correlationId: string;
  idempotencyKey?: string;
};

export type ComplianceDecisionRecord = {
  id: string;
  screeningRunId: string;
  decision: ComplianceDecisionType;
  reasonCode: ComplianceReasonCode;
  decidedAt: Date;
  decidedBy: 'system' | 'user';
  note?: string;
};

export type ScreeningDecision = {
  run: SanctionScreeningRunRecord;
  decision: ComplianceDecisionRecord;
  canBind: boolean;
  requiresManualReview: boolean;
};
