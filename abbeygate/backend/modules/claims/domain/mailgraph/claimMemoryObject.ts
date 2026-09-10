/**
 * Claim Memory domain types (ADR-0041).
 *
 * Owned by `backend/modules/claims/domain/mailgraph/`.  These shapes are
 * stored verbatim in `claim_memory_projections.memoryObject` (JSONB) and
 * consumed by the Claim Workspace co-pilot card + the four operator MCP
 * tools (`operator.get_claim_memory`, `find_similar_claims`,
 * `analyze_claim_memory`, `refresh_claim_memory`).
 *
 * Citations always point back to canonical `CommunicationMessage` rows.
 * The structured timeline / missing-info / flag shapes are deterministic
 * outputs of `buildClaimMemoryObject` (step 7 of the refresh pipeline).
 */

import type {
  EndorsementCheck,
  MemoryCitation,
  MemoryConfidence,
  InsufficientEvidenceFlag,
} from '../../../org2vec/domain/memoryObject.js';
import type { GateDecision } from '../../../org2vec/domain/reflexGates.js';

export type { EndorsementCheck, MemoryCitation, MemoryConfidence, InsufficientEvidenceFlag, GateDecision };

/** Refresh lifecycle — mirrors `claim_memory_projections.refreshStatus`. */
export type ClaimMemoryRefreshStatus =
  | 'pending'
  | 'refreshing'
  | 'fresh'
  | 'stale'
  | 'failed';

/** A pointer back to the source of a fact. NEVER carries raw PII. */
export interface ClaimMemoryCitation {
  threadId: string;
  messageId: string;
  quote: string;
  charOffsetStart?: number;
  charOffsetEnd?: number;
}

/** Canonical claim-memory event categories. Open enum — UI must tolerate unknown values. */
export type ClaimMemoryEventType =
  | 'fnol'
  | 'estimate_received'
  | 'estimate_revised'
  | 'doc_request'
  | 'doc_received'
  | 'liability_position'
  | 'reserve_change'
  | 'payment_made'
  | 'recovery_received'
  | 'escalation'
  | 'closure'
  | 'reopen'
  | 'note'
  | 'communication';

export interface ClaimMemoryEvent {
  type: ClaimMemoryEventType;
  date: string;
  amount?: number;
  currency?: string;
  documentType?: string;
  position?: 'accepted' | 'denied' | 'reserved' | 'partial';
  reasonCode?: string;
  summary?: string;
  citation?: ClaimMemoryCitation;
  derivedFrom?: 'canonical' | 'regex' | 'llm';
}

/** A repairer / broker / vehicle reference extracted from extraction step 5. */
export interface ClaimMemoryEntityRef {
  type: 'repairer' | 'broker' | 'vehicle' | 'third_party' | 'witness' | 'lawyer' | 'adjuster';
  normalizedName?: string;
  vehicleRegHash?: string;
  citations: ClaimMemoryCitation[];
  derivedFrom: 'canonical' | 'regex' | 'llm';
}

export interface ClaimMemoryMissingInfoRow {
  documentType: string;
  requestedAt: string | null;
  received: boolean;
  receivedAt?: string;
  requestCitation?: ClaimMemoryCitation;
  receivedCitation?: ClaimMemoryCitation;
}

export interface ClaimMemoryAuthorityFlag {
  code:
    | 'ESTIMATE_EXCEEDS_AUTHORITY'
    | 'BODILY_INJURY_PRESENT'
    | 'LITIGATION_INDICATED'
    | 'RESERVE_INCREASED_BEYOND_THRESHOLD'
    | 'AUTHORITY_REVIEW_NOTED';
  amount?: number;
  threshold?: number;
  summary?: string;
  citation?: ClaimMemoryCitation;
}

export interface ClaimMemoryLiabilityPosition {
  position: 'accepted' | 'denied' | 'reserved' | 'partial';
  date: string;
  citation?: ClaimMemoryCitation;
}

export interface ClaimMemoryRecommendedAction {
  code:
    | 'REQUEST_MISSING_DOCUMENT'
    | 'ESCALATE_TO_AUTHORITY'
    | 'CONFIRM_LIABILITY_POSITION'
    | 'CHASE_REPAIRER_ESTIMATE'
    | 'UPDATE_RESERVE'
    | 'SCHEDULE_FOLLOWUP';
  summary: string;
  basedOnCitations: ClaimMemoryCitation[];
}

/**
 * The structured memory object stored at
 * `claim_memory_projections.memoryObject`.  All shapes here are open by
 * design — readers must tolerate new fields.  Aggregation rules live in
 * `app/mailgraph/buildClaimMemoryObject.ts`.
 */
export interface ClaimMemoryObject {
  claimId: string;
  operatingTenantId: string;
  generatedAt: string;
  timeline: ClaimMemoryEvent[];
  missingInformation: ClaimMemoryMissingInfoRow[];
  authorityFlags: ClaimMemoryAuthorityFlag[];
  liabilityPositions: ClaimMemoryLiabilityPosition[];
  recommendedActions: ClaimMemoryRecommendedAction[];
  entities: ClaimMemoryEntityRef[];
  partialExtraction?: {
    llmFailed: boolean;
    failureCode?: string;
  };

  // ── Org2Vec enrichment (ADR-0044). All optional + back-compatible. ──
  /** One-line deterministic synthesis of the claim's operational state. */
  summary?: string | null;
  /** Endorsement / precedence checks (e.g. Endorsement 141 governs). */
  endorsementChecks?: EndorsementCheck[];
  /** Editable suggested reply — NEVER auto-sent. */
  draftReply?: string | null;
  /** Flat citation list backing the summary + key facts. */
  citations?: MemoryCitation[];
  /** Overall confidence band derived from trusted-fact density. */
  confidence?: MemoryConfidence;
  /** Topics the engine could not confidently evidence. */
  insufficientEvidenceFlags?: InsufficientEvidenceFlag[];
  /** Deterministic reflex-gate decisions (transparency for the UI). */
  gateDecisions?: GateDecision[];
}
