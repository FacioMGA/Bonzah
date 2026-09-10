/**
 * memoryObject — shared base shapes for Org2Vec memory objects (ADR-0044).
 *
 * `ClaimMemoryObject` (claims module) and `SubmissionMemoryObject`
 * (underwriting) both extend this base so the cited / confidence /
 * insufficient-evidence semantics are identical across surfaces.
 *
 * Pure domain module — no IO.
 */

/** A pointer back to the evidence behind a fact. NEVER carries raw PII. */
export interface MemoryCitation {
  threadId?: string;
  messageId?: string;
  documentId?: string;
  quote: string;
  charOffsetStart?: number;
  charOffsetEnd?: number;
}

export type MemoryConfidence = 'high' | 'medium' | 'low';

/** Records a topic the system could NOT confidently evidence. */
export interface InsufficientEvidenceFlag {
  topic: string;
  reason: string;
}

/** Result of the precedence resolver / endorsement gate, surfaced in UI. */
export interface EndorsementCheck {
  endorsementRef: string;
  description: string;
  status: 'satisfied' | 'not_satisfied' | 'unknown' | 'governing' | 'overridden';
  /** Which source governs this check (precedence winner id). */
  governingSourceId?: string;
  rationale?: string;
  citation?: MemoryCitation;
}

/**
 * Fields every Org2Vec memory object carries.  Readers must tolerate
 * additional fields — these shapes are stored as JSONB.
 */
export interface MemoryObjectBase {
  summary: string | null;
  citations: MemoryCitation[];
  confidence: MemoryConfidence;
  insufficientEvidenceFlags: InsufficientEvidenceFlag[];
  lastRefreshedAt: string;
}

/**
 * Derive an overall confidence band from trusted-fact density and the
 * presence of insufficient-evidence flags. Deterministic.
 */
export function deriveConfidence(args: {
  trustedFactCount: number;
  totalFactCount: number;
  insufficientEvidenceFlags: number;
}): MemoryConfidence {
  if (args.totalFactCount === 0) return 'low';
  const ratio = args.trustedFactCount / args.totalFactCount;
  if (args.insufficientEvidenceFlags > 0 && ratio < 0.6) return 'low';
  if (ratio >= 0.75 && args.insufficientEvidenceFlags === 0) return 'high';
  if (ratio >= 0.5) return 'medium';
  return 'low';
}
