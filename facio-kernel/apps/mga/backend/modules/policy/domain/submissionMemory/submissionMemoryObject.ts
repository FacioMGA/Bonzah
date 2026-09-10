/**
 * submissionMemoryObject — Org2Vec memory object for underwriting
 * submissions (ADR-0044). The underwriting counterpart of
 * `ClaimMemoryObject`; both extend the shared `MemoryObjectBase`.
 *
 * Pure domain — no IO. Stored as JSONB in `submission_memory_projections`.
 */

import type {
  MemoryCitation,
  MemoryConfidence,
  MemoryObjectBase,
  InsufficientEvidenceFlag,
  EndorsementCheck,
} from '../../../org2vec/domain/memoryObject.js';

export type SubmissionMemoryRefreshStatus = 'pending' | 'refreshing' | 'fresh' | 'stale' | 'failed';

export interface SubmissionTimelineEvent {
  type: string;
  date: string;
  summary: string;
  derivedFrom: 'canonical' | 'email' | 'document';
  citation?: MemoryCitation;
}

export interface SubmissionMissingInfoRow {
  item: string;
  requestedAt?: string;
  received: boolean;
  citation?: MemoryCitation;
}

export interface SubmissionUnderwritingFlag {
  code: string;
  summary: string;
  severity: 'info' | 'warn' | 'block';
  citation?: MemoryCitation;
}

export interface SubmissionReferralTrigger {
  code: string;
  summary: string;
  citation?: MemoryCitation;
}

export interface SubmissionRecommendedAction {
  code: string;
  summary: string;
  basedOnCitations: MemoryCitation[];
}

export interface SimilarSubmission {
  submissionId: string;
  score: number;
  reasons: string[];
}

export interface SubmissionMemoryObject extends MemoryObjectBase {
  submissionId: string;
  operatingTenantId: string;
  generatedAt: string;
  timeline: SubmissionTimelineEvent[];
  missingInformation: SubmissionMissingInfoRow[];
  underwritingFlags: SubmissionUnderwritingFlag[];
  endorsementChecks: EndorsementCheck[];
  referralTriggers: SubmissionReferralTrigger[];
  recommendedActions: SubmissionRecommendedAction[];
  similarSubmissions: SimilarSubmission[];
  /** Editable, never auto-sent. */
  draftBrokerRequest: string | null;
}

export type {
  MemoryCitation,
  MemoryConfidence,
  InsufficientEvidenceFlag,
  EndorsementCheck,
};
