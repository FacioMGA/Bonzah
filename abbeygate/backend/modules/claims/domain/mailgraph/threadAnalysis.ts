/**
 * ThreadAnalysis — per-thread output of pipeline step 6 (ADR-0041).
 *
 * One ThreadAnalysis aggregates everything extracted from a single email
 * thread (`CommunicationThread.id` where `entityType='CLAIM'`).  The
 * orchestrator (`refreshClaimMemoryUseCase`) runs `buildClaimMemoryObject`
 * across the array of ThreadAnalysis rows to produce the final
 * `ClaimMemoryObject`.
 *
 * Citations on every event/entity point back to canonical
 * `CommunicationMessage` rows by `(threadId, messageId)`.  Extraction
 * provenance (`derivedFrom`) lets the UI distinguish deterministic facts
 * from LLM-suggested ones.
 */

import type {
  ClaimMemoryCitation,
  ClaimMemoryEntityRef,
  ClaimMemoryEvent,
} from './claimMemoryObject.js';

export interface ThreadAnalysis {
  threadId: string;
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  events: ClaimMemoryEvent[];
  entities: ClaimMemoryEntityRef[];
  citationsConsidered: ClaimMemoryCitation[];
  /**
   * If the LLM extraction failed (network, timeout, schema-invalid response),
   * the thread still emits a ThreadAnalysis carrying ONLY the deterministic
   * regex events.  `partial` records which layer failed so downstream UI can
   * surface a partial-extraction warning.
   */
  partial?: {
    llmFailed: boolean;
    failureCode?: string;
  };
}
