/**
 * ClaimMemoryCopilotCard — Claim Workspace right-panel co-pilot card (ADR-0041).
 *
 * Reads the cached `ClaimMemoryProjection` via
 * `GET /api/claims/:id/memory` and offers a manual refresh button that
 * enqueues a `CLAIM_MEMORY.REFRESH` BullMQ job.  Never queries Neo4j
 * directly — the card is Postgres-only.
 *
 * UI behaviour by `refreshStatus`:
 *   - absent / pending → "Computing claim memory…" CTA + Refresh button.
 *   - refreshing → existing content + small refreshing badge.
 *   - fresh → normal render.
 *   - stale → render existing + "last refreshed N ago — graph refresh unavailable".
 *   - failed → render existing + warning with `refreshError` short code.
 *
 * Week 1 surfaces: summary (optional, blank until Week 2), timeline,
 * missing-info, authority flags, recommended actions.  Similar-claims
 * card lands in Week 2 once Neo4j is in.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/src/shared/ui';
import { claimsApiClient } from '@/src/modules/claims/api/claimsApiClient';

interface MemoryEvent {
  type: string;
  date: string;
  amount?: number;
  currency?: string;
  documentType?: string;
  position?: string;
  reasonCode?: string;
  summary?: string;
  citation?: { threadId: string; messageId: string; quote: string };
  derivedFrom?: 'canonical' | 'regex' | 'llm';
}

interface MemoryMissingInfo {
  documentType: string;
  requestedAt: string | null;
  received: boolean;
  receivedAt?: string;
  requestCitation?: { threadId: string; messageId: string; quote: string };
}

interface MemoryAuthorityFlag {
  code: string;
  amount?: number;
  threshold?: number;
  summary?: string;
  citation?: { threadId: string; messageId: string; quote: string };
}

interface MemoryRecommendedAction {
  code: string;
  summary: string;
  basedOnCitations: Array<{ threadId: string; messageId: string; quote: string }>;
}

interface MemoryCitation {
  threadId?: string;
  messageId?: string;
  documentId?: string;
  quote: string;
}

interface EndorsementCheck {
  endorsementRef: string;
  status: string;
  summary?: string;
  governingSourceId?: string | null;
  citation?: MemoryCitation;
}

interface GateDecision {
  code: string;
  status: 'PASS' | 'REFER' | 'BLOCK' | 'INSUFFICIENT_EVIDENCE';
  summary: string;
}

interface InsufficientEvidenceFlag {
  topic: string;
  reason: string;
}

interface MemoryObject {
  summary?: string | null;
  timeline?: MemoryEvent[];
  missingInformation?: MemoryMissingInfo[];
  authorityFlags?: MemoryAuthorityFlag[];
  recommendedActions?: MemoryRecommendedAction[];
  endorsementChecks?: EndorsementCheck[];
  gateDecisions?: GateDecision[];
  citations?: MemoryCitation[];
  insufficientEvidenceFlags?: InsufficientEvidenceFlag[];
  draftReply?: string | null;
  confidence?: 'high' | 'medium' | 'low';
}

interface AskAnswer {
  answer: string;
  citations: MemoryCitation[];
  mode: 'llm' | 'extractive' | 'no_evidence';
  channelsUsed: string[];
  passageCount: number;
}

interface SimilarClaim {
  claimId: string;
  score: number;
  reasons: Array<{ code: string; detail?: string }>;
  generatedAt: string;
}

interface MemoryProjection {
  summary: string | null;
  memoryObject: MemoryObject;
  similarClaims: SimilarClaim[];
  refreshStatus: 'pending' | 'refreshing' | 'fresh' | 'stale' | 'failed';
  refreshError: string | null;
  lastRefreshedAt: string | null;
  updatedAt: string;
}

interface MemoryReadResponse {
  claimId: string;
  status: 'absent' | 'present';
  stalenessWarning: boolean;
  projection: MemoryProjection | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function eventLabel(event: MemoryEvent): string {
  switch (event.type) {
    case 'fnol':
      return 'FNOL';
    case 'estimate_received':
      return `Estimate received${event.amount ? ` (${event.currency ?? ''} ${event.amount.toLocaleString()})` : ''}`;
    case 'doc_request':
      return `Doc requested: ${event.documentType?.replace(/_/g, ' ') ?? 'unknown'}`;
    case 'doc_received':
      return `Doc received: ${event.documentType?.replace(/_/g, ' ') ?? 'unknown'}`;
    case 'liability_position':
      return `Liability ${event.position ?? 'updated'}`;
    case 'reserve_change':
      return `Reserve change${event.amount ? ` (${event.currency ?? ''} ${event.amount.toLocaleString()})` : ''}`;
    case 'payment_made':
      return `Payment made${event.amount ? ` (${event.currency ?? ''} ${event.amount.toLocaleString()})` : ''}`;
    case 'recovery_received':
      return `Recovery received${event.amount ? ` (${event.currency ?? ''} ${event.amount.toLocaleString()})` : ''}`;
    case 'escalation':
      return `Escalation: ${event.reasonCode?.replace(/_/g, ' ') ?? 'review'}`;
    default:
      return event.type.replace(/_/g, ' ');
  }
}

function StatusBadge({ status }: { status: MemoryProjection['refreshStatus'] }) {
  const map: Record<MemoryProjection['refreshStatus'], { label: string; cls: string }> = {
    pending: { label: 'Not yet computed', cls: 'bg-slate-100 text-slate-600' },
    refreshing: { label: 'Refreshing…', cls: 'bg-blue-100 text-blue-700' },
    fresh: { label: 'Fresh', cls: 'bg-emerald-100 text-emerald-700' },
    stale: { label: 'Stale', cls: 'bg-amber-100 text-amber-700' },
    failed: { label: 'Failed', cls: 'bg-rose-100 text-rose-700' },
  };
  const entry = map[status];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${entry.cls}`}>{entry.label}</span>;
}

function ConfidenceChip({ confidence }: { confidence?: 'high' | 'medium' | 'low' }) {
  if (!confidence) return null;
  const cls =
    confidence === 'high'
      ? 'bg-emerald-100 text-emerald-700'
      : confidence === 'medium'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {confidence} confidence
    </span>
  );
}

function GateChip({ status }: { status: GateDecision['status'] }) {
  const map: Record<GateDecision['status'], string> = {
    PASS: 'bg-emerald-100 text-emerald-700',
    REFER: 'bg-amber-100 text-amber-700',
    BLOCK: 'bg-rose-100 text-rose-700',
    INSUFFICIENT_EVIDENCE: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${map[status]}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function ClaimMemoryCopilotCard({ claimId }: { claimId: string }) {
  const [data, setData] = useState<MemoryReadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);

  const load = useCallback(async () => {
    if (!claimId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await claimsApiClient.getClaimMemory(claimId);
      if (res.success && res.data) {
        setData(res.data as MemoryReadResponse);
      } else {
        setError(res.error?.message ?? 'Failed to load claim memory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load claim memory');
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reply = data?.projection?.memoryObject?.draftReply;
    if (typeof reply === 'string') setDraft(reply);
  }, [data]);

  const onAsk = useCallback(async () => {
    const q = question.trim();
    if (!claimId || asking || q.length < 2) return;
    setAsking(true);
    setError(null);
    try {
      const res = await claimsApiClient.askClaimMemory(claimId, q);
      if (res.success && res.data) {
        setAnswer(res.data as AskAnswer);
      } else {
        setError(res.error?.message ?? 'Ask failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ask failed');
    } finally {
      setAsking(false);
    }
  }, [claimId, question, asking]);

  const onRefresh = useCallback(async () => {
    if (!claimId || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      await claimsApiClient.refreshClaimMemory(claimId);
      // Poll once after a short delay so the user sees the new row land.
      setTimeout(() => {
        void load();
        setRefreshing(false);
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
      setRefreshing(false);
    }
  }, [claimId, load, refreshing]);

  if (loading && !data) {
    return (
      <section className="space-y-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Claim memory · AI co-pilot</div>
        <div className="text-xs text-slate-500">Loading memory…</div>
      </section>
    );
  }

  const isAbsent = !data || data.status === 'absent' || !data.projection;
  const projection = data?.projection;
  const memory = projection?.memoryObject ?? {};
  const status = projection?.refreshStatus ?? 'pending';

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Claim memory · Org2Vec</div>
        <div className="flex items-center gap-1.5">
          <ConfidenceChip confidence={memory.confidence} />
          <StatusBadge status={status} />
        </div>
      </div>

      {(data?.stalenessWarning && projection) || status === 'stale' || status === 'failed' ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Memory last refreshed {timeAgo(projection?.lastRefreshedAt ?? null)}
          {projection?.refreshError ? ` — ${projection.refreshError}` : ' — graph enrichment may be stale.'}
        </div>
      ) : null}

      {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div> : null}

      {isAbsent ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          <p>Claim memory has not been computed for this claim yet.</p>
          <p className="mt-1 text-[11px] text-slate-500">Refresh to extract timeline, missing-doc patterns, and authority flags from the email thread.</p>
        </div>
      ) : (
        <>
          {memory.summary ? (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-slate-700">
              {memory.summary}
            </div>
          ) : null}

          {memory.gateDecisions && memory.gateDecisions.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Decision gates</div>
              {memory.gateDecisions.map((gate, idx) => (
                <div key={`${gate.code}-${idx}`} className="flex items-start justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                  <span>
                    <span className="font-semibold">{gate.code.replace(/_/g, ' ')}.</span> {gate.summary}
                  </span>
                  <GateChip status={gate.status} />
                </div>
              ))}
            </div>
          ) : null}

          {memory.authorityFlags && memory.authorityFlags.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-rose-700">Authority flags</div>
              {memory.authorityFlags.map((flag, idx) => (
                <div key={`${flag.code}-${idx}`} className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
                  <div className="font-semibold">{flag.code.replace(/_/g, ' ')}</div>
                  {flag.summary ? <div className="text-rose-700">{flag.summary}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          {memory.missingInformation && memory.missingInformation.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Missing information</div>
              {memory.missingInformation.map((row) => (
                <div key={row.documentType} className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  <span>{row.documentType.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] font-semibold">{row.received ? 'received' : 'outstanding'}</span>
                </div>
              ))}
            </div>
          ) : null}

          {memory.recommendedActions && memory.recommendedActions.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Recommended actions</div>
              {memory.recommendedActions.map((action, idx) => (
                <div key={`${action.code}-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                  <span className="font-semibold">{action.code.replace(/_/g, ' ')}.</span> {action.summary}
                </div>
              ))}
            </div>
          ) : null}

          {projection && projection.similarClaims && projection.similarClaims.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-violet-700">Similar claims (graph)</div>
              {projection.similarClaims.slice(0, 3).map((row) => (
                <div key={row.claimId} className="rounded border border-violet-200 bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{row.claimId}</span>
                    <span className="text-[10px] tabular-nums text-violet-600">score {row.score}</span>
                  </div>
                  <div className="text-[10px] text-violet-700">
                    {row.reasons
                      .slice(0, 3)
                      .map((reason) => reason.code.replace(/_/g, ' ').toLowerCase() + (reason.detail ? ` (${reason.detail})` : ''))
                      .join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {memory.timeline && memory.timeline.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Timeline</div>
              <ul className="space-y-0.5 text-[11px] text-slate-700">
                {memory.timeline.slice(-6).map((event, idx) => (
                  <li key={`${event.type}-${idx}`} className="flex items-start gap-1.5">
                    <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden />
                    <span>
                      <span className="text-slate-500">{event.date.slice(0, 10)}</span> · {eventLabel(event)}
                      {event.citation ? (
                        <span
                          className="ml-1 inline-flex h-3.5 items-center rounded-sm border border-slate-300 px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500"
                          title={event.citation.quote}
                          aria-label={`Cited from message ${event.citation.messageId}: ${event.citation.quote}`}
                        >
                          cite
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {memory.endorsementChecks && memory.endorsementChecks.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-700">Endorsement checks</div>
              {memory.endorsementChecks.map((check, idx) => (
                <div key={`${check.endorsementRef}-${idx}`} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{check.endorsementRef}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wide">{check.status.replace(/_/g, ' ')}</span>
                  </div>
                  {check.summary ? <div className="text-indigo-700">{check.summary}</div> : null}
                  {check.governingSourceId ? (
                    <div className="mt-0.5 text-[9px] text-indigo-500">governing source: {check.governingSourceId}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {memory.insufficientEvidenceFlags && memory.insufficientEvidenceFlags.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Insufficient evidence</div>
              {memory.insufficientEvidenceFlags.map((flag, idx) => (
                <div key={`${flag.topic}-${idx}`} className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  <span className="font-semibold">{flag.topic}:</span> {flag.reason}
                </div>
              ))}
            </div>
          ) : null}

          {memory.citations && memory.citations.length > 0 ? (
            <details className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-slate-600">
                Citations ({memory.citations.length})
              </summary>
              <ul className="mt-1 space-y-1">
                {memory.citations.slice(0, 8).map((cite, idx) => (
                  <li key={`${cite.messageId ?? cite.documentId ?? idx}`} className="border-l-2 border-slate-300 pl-2 text-[10px] italic text-slate-600">
                    “{cite.quote}”
                    {cite.messageId ? <span className="ml-1 not-italic text-slate-400">— msg {cite.messageId.slice(0, 8)}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* Draft reply — editable, never auto-sent (deck Stage 05). */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Draft reply (not sent)</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="No draft suggested — refresh memory to generate one."
              className="h-24 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
            />
            <p className="text-[9px] text-slate-400">Review and send manually from the email composer — Org2Vec never sends.</p>
          </div>

          {/* Read-only ask box — retrieval-grounded, always cited. */}
          <div className="space-y-1 border-t border-slate-100 pt-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Ask the claim memory</div>
            <div className="flex items-center gap-1.5">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onAsk();
                }}
                placeholder="e.g. Has the engineer's report been received?"
                className="flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
              />
              <Button type="button" variant="secondary" size="sm" onClick={onAsk} disabled={asking || question.trim().length < 2}>
                {asking ? '…' : 'Ask'}
              </Button>
            </div>
            {answer ? (
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700">
                <p>{answer.answer}</p>
                {answer.citations.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {answer.citations.slice(0, 4).map((cite, idx) => (
                      <li key={idx} className="border-l-2 border-slate-300 pl-2 text-[10px] italic text-slate-500">
                        “{cite.quote}”
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-400">
                  {answer.mode} · {answer.passageCount} passages · {answer.channelsUsed.join(', ') || 'no channels'}
                </p>
              </div>
            ) : null}
          </div>
        </>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-slate-500">{projection ? `Updated ${timeAgo(projection.lastRefreshedAt)}` : null}</span>
        <Button type="button" variant="link" size="none" className="text-xs font-semibold text-slate-700 underline underline-offset-2" onClick={onRefresh}>
          {refreshing ? 'Refreshing…' : 'Refresh memory'}
        </Button>
      </div>
    </section>
  );
}
