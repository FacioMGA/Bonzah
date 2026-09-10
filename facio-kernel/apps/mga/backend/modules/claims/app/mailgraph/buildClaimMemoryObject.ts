/**
 * buildClaimMemoryObject — pipeline step 7 (ADR-0041).
 *
 * Aggregates ThreadAnalysis rows + canonical claim/policy/reserve data
 * into the structured `ClaimMemoryObject` rendered by the Claim Workspace
 * co-pilot.
 *
 * Deterministic.  Aggregation rules (per ADR-0041 §2 step 7):
 *
 *   - Document requested AND no later `doc_received` event with the same
 *     `documentType` → `missing_information` row.
 *   - Estimate amount > authority threshold (currently a static cap of
 *     EUR 25,000; will become a per-tenant lookup in Week 2 when binders
 *     thread their authority limits into the pipeline) → `authority_flag`.
 *   - Any `escalation` event with `reasonCode='BODILY_INJURY_PRESENT'` →
 *     `authority_flag: BODILY_INJURY_PRESENT`.
 *   - Liability positions: keep the latest one per occurredAt; if
 *     "reserved" appears AFTER "accepted", the later position wins.
 *   - Recommended actions: derived from missing-info, authority flags,
 *     and the open status of the claim.
 */

import type { Claim, ClaimReserveTransaction } from '@prisma/client';
import type {
  ClaimMemoryAuthorityFlag,
  ClaimMemoryEntityRef,
  ClaimMemoryEvent,
  ClaimMemoryLiabilityPosition,
  ClaimMemoryMissingInfoRow,
  ClaimMemoryObject,
  ClaimMemoryRecommendedAction,
  EndorsementCheck,
  MemoryCitation,
} from '../../domain/mailgraph/claimMemoryObject.js';
import type { ThreadAnalysis } from '../../domain/mailgraph/threadAnalysis.js';
import {
  runReflexGates,
  gatesToInsufficientEvidenceFlags,
  resolvePrecedence,
  deriveConfidence,
  type GateDecision,
  type ReflexGateInput,
  type PrecedenceCandidate,
} from '../../../org2vec/index.js';

interface BuildInput {
  claim: Claim;
  reserves: ClaimReserveTransaction[];
  threadAnalyses: ThreadAnalysis[];
  /**
   * Authority threshold above which estimates raise an
   * `ESTIMATE_EXCEEDS_AUTHORITY` flag.  V1 default is EUR 25,000 — Week 2
   * will source this per-tenant from the binder authority limits in the
   * `binder_product_authorities` table.
   */
  authorityThresholdEur?: number;
}

const DEFAULT_AUTHORITY_THRESHOLD_EUR = 25_000;

function fnolEvent(claim: Claim): ClaimMemoryEvent {
  return {
    type: 'fnol',
    date: claim.firstNotifiedAt.toISOString(),
    summary: `Claim ${claim.claimNumber} first notified`,
    derivedFrom: 'canonical',
  };
}

function reserveEvents(reserves: ClaimReserveTransaction[]): ClaimMemoryEvent[] {
  return reserves.map<ClaimMemoryEvent>((reserve) => ({
    type: reserve.type === 'PAID' ? 'payment_made' : reserve.type === 'RECOVERY' ? 'recovery_received' : 'reserve_change',
    date: reserve.occurredAt.toISOString(),
    amount: Number(reserve.amount),
    currency: reserve.currency,
    summary: reserve.notes ?? `${reserve.type} ${reserve.currency} ${reserve.amount}`,
    derivedFrom: 'canonical',
  }));
}

function dedupeMissingInfo(events: ClaimMemoryEvent[]): ClaimMemoryMissingInfoRow[] {
  const requests = events.filter((event) => event.type === 'doc_request' && event.documentType);
  const receipts = events.filter((event) => event.type === 'doc_received' && event.documentType);

  const rows = new Map<string, ClaimMemoryMissingInfoRow>();
  for (const request of requests) {
    const documentType = String(request.documentType);
    const requestDate = request.date;
    const laterReceipt = receipts.find((r) => r.documentType === documentType && r.date >= requestDate);
    const existing = rows.get(documentType);
    // Keep the EARLIEST request and the EARLIEST receipt for this document.
    if (!existing || existing.requestedAt === null || requestDate < (existing.requestedAt ?? '')) {
      rows.set(documentType, {
        documentType,
        requestedAt: requestDate,
        received: Boolean(laterReceipt),
        receivedAt: laterReceipt?.date,
        requestCitation: request.citation,
        receivedCitation: laterReceipt?.citation,
      });
    } else if (laterReceipt && !existing.received) {
      rows.set(documentType, { ...existing, received: true, receivedAt: laterReceipt.date, receivedCitation: laterReceipt.citation });
    }
  }
  return Array.from(rows.values()).sort((a, b) => (a.requestedAt ?? '').localeCompare(b.requestedAt ?? ''));
}

function deriveAuthorityFlags(events: ClaimMemoryEvent[], authorityThresholdEur: number): ClaimMemoryAuthorityFlag[] {
  const flags: ClaimMemoryAuthorityFlag[] = [];

  for (const event of events) {
    if (event.type === 'estimate_received' && typeof event.amount === 'number' && event.amount > authorityThresholdEur) {
      flags.push({
        code: 'ESTIMATE_EXCEEDS_AUTHORITY',
        amount: event.amount,
        threshold: authorityThresholdEur,
        summary: event.summary,
        citation: event.citation,
      });
    }
    if (event.type === 'escalation' && event.reasonCode === 'BODILY_INJURY_PRESENT') {
      flags.push({
        code: 'BODILY_INJURY_PRESENT',
        summary: event.summary,
        citation: event.citation,
      });
    }
    if (event.type === 'escalation' && event.reasonCode === 'LITIGATION') {
      flags.push({
        code: 'LITIGATION_INDICATED',
        summary: event.summary,
        citation: event.citation,
      });
    }
  }

  return flags;
}

function deriveLiabilityPositions(events: ClaimMemoryEvent[]): ClaimMemoryLiabilityPosition[] {
  return events
    .filter((event) => event.type === 'liability_position' && event.position)
    .map<ClaimMemoryLiabilityPosition>((event) => ({
      position: event.position as ClaimMemoryLiabilityPosition['position'],
      date: event.date,
      citation: event.citation,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function deriveRecommendedActions(args: {
  claim: Claim;
  missingInfo: ClaimMemoryMissingInfoRow[];
  authorityFlags: ClaimMemoryAuthorityFlag[];
  liabilityPositions: ClaimMemoryLiabilityPosition[];
}): ClaimMemoryRecommendedAction[] {
  const actions: ClaimMemoryRecommendedAction[] = [];

  for (const row of args.missingInfo) {
    if (!row.received) {
      actions.push({
        code: 'REQUEST_MISSING_DOCUMENT',
        summary: `Chase ${row.documentType.replace(/_/g, ' ')} (requested ${row.requestedAt ?? 'previously'} — no receipt seen)`,
        basedOnCitations: row.requestCitation ? [row.requestCitation] : [],
      });
    }
  }

  for (const flag of args.authorityFlags) {
    if (flag.code === 'ESTIMATE_EXCEEDS_AUTHORITY' || flag.code === 'BODILY_INJURY_PRESENT' || flag.code === 'LITIGATION_INDICATED') {
      actions.push({
        code: 'ESCALATE_TO_AUTHORITY',
        summary:
          flag.code === 'ESTIMATE_EXCEEDS_AUTHORITY'
            ? `Estimate ${flag.amount} exceeds authority threshold ${flag.threshold}; escalation required`
            : flag.code === 'BODILY_INJURY_PRESENT'
              ? 'Bodily injury indicated; escalate per delegated authority rules'
              : 'Litigation indicated; refer to underwriter / carrier',
        basedOnCitations: flag.citation ? [flag.citation] : [],
      });
    }
  }

  const lastPosition = args.liabilityPositions[args.liabilityPositions.length - 1];
  if (args.claim.status === 'OPEN' && (!lastPosition || lastPosition.position === 'reserved')) {
    actions.push({
      code: 'CONFIRM_LIABILITY_POSITION',
      summary: 'Liability still reserved or undetermined; confirm position before next reserve change',
      basedOnCitations: lastPosition?.citation ? [lastPosition.citation] : [],
    });
  }

  return actions;
}

function mergeEntities(threadAnalyses: ThreadAnalysis[]): ClaimMemoryEntityRef[] {
  const merged = new Map<string, ClaimMemoryEntityRef>();
  for (const analysis of threadAnalyses) {
    for (const entity of analysis.entities) {
      const key = `${entity.type}:${entity.normalizedName ?? entity.vehicleRegHash ?? ''}`.toLowerCase();
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...entity, citations: [...entity.citations] });
      } else {
        existing.citations.push(...entity.citations);
      }
    }
  }
  return Array.from(merged.values());
}

const ENDORSEMENT_RE = /endorsement\s*(?:no\.?|number|#)?\s*([A-Z0-9][A-Z0-9-]{0,15})/i;

/**
 * Detect endorsement references in correspondence and run the
 * deterministic precedence resolver to decide which source GOVERNS
 * (the Endorsement-141 demo). An operational endorsement raised in email
 * outranks the static policy wording when it is in-scope + effective.
 */
function detectEndorsementChecks(
  timeline: ClaimMemoryEvent[],
  ctx: { product?: string | null; jurisdiction?: string | null },
): EndorsementCheck[] {
  const seen = new Set<string>();
  const checks: EndorsementCheck[] = [];
  for (const event of timeline) {
    const haystack = `${event.summary ?? ''} ${event.citation?.quote ?? ''}`;
    const match = haystack.match(ENDORSEMENT_RE);
    if (!match) continue;
    const ref = match[1].toUpperCase();
    if (seen.has(ref)) continue;
    seen.add(ref);

    const candidates: PrecedenceCandidate[] = [
      { id: 'policy-wording', sourceClass: 'FORMAL_POLICY', label: 'Policy wording' },
      {
        id: `endorsement-${ref}`,
        sourceClass: 'ENDORSEMENT',
        effectiveDate: event.date,
        product: ctx.product ?? undefined,
        jurisdiction: ctx.jurisdiction ?? undefined,
        label: `Endorsement ${ref}`,
      },
    ];
    const resolved = resolvePrecedence(candidates, {
      product: ctx.product ?? undefined,
      jurisdiction: ctx.jurisdiction ?? undefined,
    });
    const endorsementWins = resolved.winner?.id === `endorsement-${ref}`;
    checks.push({
      endorsementRef: ref,
      description: `Endorsement ${ref} referenced in correspondence`,
      status: endorsementWins ? 'governing' : 'overridden',
      governingSourceId: resolved.winner?.id,
      rationale: resolved.rationale,
      citation: event.citation
        ? { threadId: event.citation.threadId, messageId: event.citation.messageId, quote: event.citation.quote }
        : undefined,
    });
  }
  return checks;
}

function collectCitations(timeline: ClaimMemoryEvent[]): MemoryCitation[] {
  const out: MemoryCitation[] = [];
  const seen = new Set<string>();
  for (const event of timeline) {
    const c = event.citation;
    if (!c) continue;
    const key = `${c.threadId}:${c.messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ threadId: c.threadId, messageId: c.messageId, quote: c.quote });
  }
  return out;
}

function largestEstimate(timeline: ClaimMemoryEvent[]): number | null {
  let max: number | null = null;
  for (const event of timeline) {
    if (event.type === 'estimate_received' && typeof event.amount === 'number') {
      max = max === null ? event.amount : Math.max(max, event.amount);
    }
  }
  return max;
}

function buildDraftReply(claim: Claim, missingInfo: ClaimMemoryMissingInfoRow[]): string | null {
  const outstanding = missingInfo.filter((row) => !row.received);
  if (outstanding.length === 0) return null;
  const lines = outstanding.map((row, i) => `  ${i + 1}. ${row.documentType.replace(/_/g, ' ')}`);
  return `Dear handler,\n\nRe: claim ${claim.claimNumber}. To proceed we still require the following:\n${lines.join('\n')}\n\nPlease provide these at your earliest convenience.\n\nKind regards,\nClaims`;
}

export function buildClaimMemoryObject(input: BuildInput): ClaimMemoryObject {
  const threshold = input.authorityThresholdEur ?? DEFAULT_AUTHORITY_THRESHOLD_EUR;

  const timeline: ClaimMemoryEvent[] = [
    fnolEvent(input.claim),
    ...reserveEvents(input.reserves),
    ...input.threadAnalyses.flatMap((analysis) => analysis.events),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const missingInformation = dedupeMissingInfo(timeline);
  const authorityFlags = deriveAuthorityFlags(timeline, threshold);
  const liabilityPositions = deriveLiabilityPositions(timeline);
  const recommendedActions = deriveRecommendedActions({
    claim: input.claim,
    missingInfo: missingInformation,
    authorityFlags,
    liabilityPositions,
  });

  // ── Org2Vec engine: deterministic reflex gates + precedence + confidence ──
  const product = input.claim.claimType ?? null;
  const jurisdiction = input.claim.lossCountry ?? null;
  const endorsementChecks = detectEndorsementChecks(timeline, { product, jurisdiction });
  const citations = collectCitations(timeline);
  const trustedFactCount = timeline.filter(
    (e) => e.citation && (e.derivedFrom === 'canonical' || e.derivedFrom === 'regex'),
  ).length;

  const gateInput: ReflexGateInput = {
    largestExposureAmount: largestEstimate(timeline),
    authorityLimit: threshold,
    exposureTrusted: true,
    currency: 'EUR',
    requiredEvidence: missingInformation.map((row) => ({ documentType: row.documentType, satisfied: row.received })),
    endorsementConditions: endorsementChecks.map((check) => ({
      endorsementRef: check.endorsementRef,
      condition: check.description,
      satisfied: check.status === 'governing' ? true : null,
      trusted: Boolean(check.governingSourceId),
    })),
    trustedFactCount,
    minTrustedFacts: 1,
  };
  const gateDecisions: GateDecision[] = runReflexGates(gateInput);
  const insufficientEvidenceFlags = gatesToInsufficientEvidenceFlags(gateDecisions);
  const confidence = deriveConfidence({
    trustedFactCount,
    totalFactCount: timeline.length,
    insufficientEvidenceFlags: insufficientEvidenceFlags.length,
  });

  const outstandingCount = missingInformation.filter((r) => !r.received).length;
  const summary = [
    `Claim ${input.claim.claimNumber} (${input.claim.status}) — ${timeline.length} timeline event(s).`,
    outstandingCount ? `${outstandingCount} document(s) outstanding.` : 'No outstanding documents.',
    authorityFlags.length ? `${authorityFlags.length} authority flag(s).` : '',
    endorsementChecks.length ? `${endorsementChecks.length} endorsement check(s).` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    claimId: input.claim.id,
    operatingTenantId: input.claim.operatingTenantId,
    generatedAt: new Date().toISOString(),
    timeline,
    missingInformation,
    authorityFlags,
    liabilityPositions,
    recommendedActions,
    entities: mergeEntities(input.threadAnalyses),
    summary,
    endorsementChecks,
    draftReply: buildDraftReply(input.claim, missingInformation),
    citations,
    confidence,
    insufficientEvidenceFlags,
    gateDecisions,
  };
}
