/**
 * buildSubmissionMemoryObject — aggregate canonical submission data +
 * broker email threads into a `SubmissionMemoryObject` (ADR-0044).
 *
 * Deterministic. The underwriting counterpart of buildClaimMemoryObject,
 * intentionally thinner: it surfaces what the broker has sent, what is
 * still outstanding, and which deterministic referral/endorsement gates
 * fire — never an LLM decision.
 */

import { runReflexGates, gatesToInsufficientEvidenceFlags } from '../../../org2vec/index.js';
import type { ReflexGateInput, EndorsementConditionItem } from '../../../org2vec/index.js';
import { deriveConfidence } from '../../../org2vec/index.js';
import type {
  SubmissionMemoryObject,
  SubmissionTimelineEvent,
  SubmissionMissingInfoRow,
  SubmissionUnderwritingFlag,
  SubmissionReferralTrigger,
  SubmissionRecommendedAction,
  MemoryCitation,
} from '../../domain/submissionMemory/submissionMemoryObject.js';

export interface SubmissionMessageInput {
  messageId: string;
  threadId: string;
  fromActor: string;
  subject: string | null;
  body: string;
  direction: string;
  sentAt: string;
}

export interface BuildSubmissionMemoryInput {
  submissionId: string;
  operatingTenantId: string;
  policyNumber: string;
  status: string;
  product?: string | null;
  /** Sum insured / premium exposure if known (drives the authority gate). */
  exposureAmount?: number | null;
  authorityLimit?: number | null;
  currency?: string;
  messages: SubmissionMessageInput[];
  /** Endorsement conditions resolved deterministically (optional). */
  endorsementConditions?: EndorsementConditionItem[];
}

const MISSING_RE = /\b(outstanding|still (?:need|require)|please (?:provide|send)|awaiting|missing|require[ds]?)\b/i;
const REFERRAL_RE = /\b(refer(?:ral)?|exceeds? authority|beyond authority|escalat)/i;
const RISK_RE = /\b(flood|subsidence|prior (?:loss|claim)|criminal|undisclosed|high[- ]value|aggregation)\b/i;

function citationOf(m: SubmissionMessageInput): MemoryCitation {
  const quote = m.body.replace(/\s+/g, ' ').trim().slice(0, 180);
  return { threadId: m.threadId, messageId: m.messageId, quote };
}

export function buildSubmissionMemoryObject(input: BuildSubmissionMemoryInput): SubmissionMemoryObject {
  const messages = [...input.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  const timeline: SubmissionTimelineEvent[] = messages.map((m) => ({
    type: m.direction === 'INBOUND' ? 'broker_email' : 'underwriter_email',
    date: m.sentAt,
    summary: m.subject || m.body.slice(0, 80),
    derivedFrom: 'email',
    citation: citationOf(m),
  }));

  const missingInformation: SubmissionMissingInfoRow[] = [];
  const underwritingFlags: SubmissionUnderwritingFlag[] = [];
  const referralTriggers: SubmissionReferralTrigger[] = [];

  for (const m of messages) {
    const text = `${m.subject ?? ''} ${m.body}`;
    if (MISSING_RE.test(text)) {
      missingInformation.push({
        item: (m.subject || 'Outstanding information requested').slice(0, 120),
        requestedAt: m.sentAt,
        received: false,
        citation: citationOf(m),
      });
    }
    if (RISK_RE.test(text)) {
      underwritingFlags.push({
        code: 'RISK_INDICATOR',
        summary: `Risk indicator referenced: ${(text.match(RISK_RE)?.[0] ?? '').toLowerCase()}`,
        severity: 'warn',
        citation: citationOf(m),
      });
    }
    if (REFERRAL_RE.test(text)) {
      referralTriggers.push({
        code: 'POSSIBLE_REFERRAL',
        summary: m.subject || 'Possible referral mentioned in correspondence',
        citation: citationOf(m),
      });
    }
  }

  // Deterministic reflex gates (authority + endorsement + sufficiency).
  const gateInput: ReflexGateInput = {
    largestExposureAmount: input.exposureAmount ?? null,
    authorityLimit: input.authorityLimit ?? null,
    exposureTrusted: input.exposureAmount != null,
    currency: input.currency,
    requiredEvidence: missingInformation.map((row) => ({ documentType: row.item, satisfied: row.received })),
    endorsementConditions: input.endorsementConditions,
    trustedFactCount: timeline.length,
    minTrustedFacts: 1,
  };
  const gates = runReflexGates(gateInput);
  for (const gate of gates) {
    if (gate.code === 'AUTHORITY_THRESHOLD' && gate.status === 'REFER') {
      referralTriggers.push({ code: 'AUTHORITY_EXCEEDED', summary: gate.summary });
    }
  }
  const insufficientEvidenceFlags = gatesToInsufficientEvidenceFlags(gates);

  const recommendedActions: SubmissionRecommendedAction[] = [];
  for (const row of missingInformation) {
    recommendedActions.push({
      code: 'REQUEST_INFORMATION',
      summary: `Chase broker for: ${row.item}`,
      basedOnCitations: row.citation ? [row.citation] : [],
    });
  }
  if (referralTriggers.length > 0) {
    recommendedActions.push({
      code: 'CONSIDER_REFERRAL',
      summary: 'Correspondence indicates a possible referral — review against delegated authority.',
      basedOnCitations: referralTriggers.flatMap((t) => (t.citation ? [t.citation] : [])),
    });
  }

  const draftBrokerRequest = missingInformation.length
    ? `Dear broker,\n\nThank you for the submission on ${input.policyNumber}. To progress underwriting we still require:\n${missingInformation
        .map((r, i) => `  ${i + 1}. ${r.item}`)
        .join('\n')}\n\nKind regards,\nUnderwriting`
    : null;

  const citations: MemoryCitation[] = messages.map(citationOf);
  const confidence = deriveConfidence({
    trustedFactCount: timeline.length,
    totalFactCount: timeline.length + missingInformation.length,
    insufficientEvidenceFlags: insufficientEvidenceFlags.length,
  });

  const generatedAt = new Date().toISOString();
  const summary = `${messages.length} message(s) on submission ${input.policyNumber} (${input.status}). ${
    missingInformation.length ? `${missingInformation.length} outstanding item(s). ` : 'No outstanding items detected. '
  }${referralTriggers.length ? `${referralTriggers.length} possible referral trigger(s).` : ''}`.trim();

  return {
    submissionId: input.submissionId,
    operatingTenantId: input.operatingTenantId,
    generatedAt,
    summary,
    citations,
    confidence,
    insufficientEvidenceFlags,
    lastRefreshedAt: generatedAt,
    timeline,
    missingInformation,
    underwritingFlags,
    endorsementChecks: [],
    referralTriggers,
    recommendedActions,
    similarSubmissions: [],
    draftBrokerRequest,
  };
}
