/**
 * SubmissionMemoryPanel — Org2Vec underwriting insight panel (ADR-0044).
 *
 * The underwriting counterpart of `ClaimMemoryCopilotCard`. Reads the
 * cached `SubmissionMemoryProjection` via
 * `GET /api/policies/:id/submission-memory`, offers a manual refresh, an
 * editable (never auto-sent) broker draft, a citations list, and a
 * read-only retrieval-grounded ask box. Postgres-only on read — never
 * queries Neo4j directly.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/src/shared/ui';
import { policiesClient } from '../../api/policiesClient';

interface Citation {
  threadId?: string;
  messageId?: string;
  documentId?: string;
  quote: string;
}

interface TimelineEvent {
  type: string;
  date: string;
  summary: string;
  citation?: Citation;
}

interface MissingInfoRow {
  item: string;
  received: boolean;
}

interface UnderwritingFlag {
  code: string;
  summary: string;
  severity: 'info' | 'warn' | 'block';
}

interface ReferralTrigger {
  code: string;
  summary: string;
}

interface EndorsementCheck {
  endorsementRef: string;
  status: string;
  summary?: string;
  governingSourceId?: string | null;
}

interface RecommendedAction {
  code: string;
  summary: string;
}

interface SimilarSubmission {
  submissionId: string;
  score: number;
  reasons?: string[];
}

interface SubmissionMemoryObject {
  summary?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  timeline?: TimelineEvent[];
  missingInformation?: MissingInfoRow[];
  underwritingFlags?: UnderwritingFlag[];
  referralTriggers?: ReferralTrigger[];
  endorsementChecks?: EndorsementCheck[];
  recommendedActions?: RecommendedAction[];
  similarSubmissions?: SimilarSubmission[];
  insufficientEvidenceFlags?: Array<{ topic: string; reason: string }>;
  citations?: Citation[];
  draftBrokerRequest?: string | null;
}

interface Projection {
  summary: string | null;
  memoryObject: SubmissionMemoryObject;
  similarSubmissions: SimilarSubmission[];
  refreshStatus: 'pending' | 'refreshing' | 'fresh' | 'stale' | 'failed';
  refreshError: string | null;
  lastRefreshedAt: string | null;
  updatedAt: string;
}

interface ReadResponse {
  submissionId: string;
  status: 'absent' | 'present';
  stalenessWarning: boolean;
  projection: Projection | null;
}

interface AskAnswer {
  answer: string;
  citations: Citation[];
  mode: 'llm' | 'extractive' | 'no_evidence';
  channelsUsed: string[];
  passageCount: number;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusBadge({ status }: { status: Projection['refreshStatus'] }) {
  const map: Record<Projection['refreshStatus'], { label: string; cls: string }> = {
    pending: { label: 'Not yet computed', cls: 'bg-slate-100 text-slate-600' },
    refreshing: { label: 'Refreshing…', cls: 'bg-blue-100 text-blue-700' },
    fresh: { label: 'Fresh', cls: 'bg-emerald-100 text-emerald-700' },
    stale: { label: 'Stale', cls: 'bg-amber-100 text-amber-700' },
    failed: { label: 'Failed', cls: 'bg-rose-100 text-rose-700' },
  };
  const e = map[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${e.cls}`}>{e.label}</span>;
}

function ConfidenceChip({ confidence }: { confidence?: 'high' | 'medium' | 'low' }) {
  if (!confidence) return null;
  const cls =
    confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{confidence} confidence</span>;
}

function flagCls(severity: UnderwritingFlag['severity']): string {
  if (severity === 'block') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'warn') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function SubmissionMemoryPanel({ submissionId }: { submissionId: string }) {
  const [data, setData] = useState<ReadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);

  const load = useCallback(async () => {
    if (!submissionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await policiesClient.getSubmissionMemory(submissionId);
      if (res.success && res.data) {
        setData(res.data as ReadResponse);
      } else {
        setError(res.error?.message ?? 'Failed to load submission memory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load submission memory');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reply = data?.projection?.memoryObject?.draftBrokerRequest;
    if (typeof reply === 'string') setDraft(reply);
  }, [data]);

  const onRefresh = useCallback(async () => {
    if (!submissionId || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      await policiesClient.refreshSubmissionMemory(submissionId);
      setTimeout(() => {
        void load();
        setRefreshing(false);
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
      setRefreshing(false);
    }
  }, [submissionId, load, refreshing]);

  const onAsk = useCallback(async () => {
    const q = question.trim();
    if (!submissionId || asking || q.length < 2) return;
    setAsking(true);
    setError(null);
    try {
      const res = await policiesClient.askSubmissionMemory(submissionId, q);
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
  }, [submissionId, question, asking]);

  const isAbsent = !data || data.status === 'absent' || !data.projection;
  const projection = data?.projection;
  const memory = projection?.memoryObject ?? {};
  const status = projection?.refreshStatus ?? 'pending';
  const similar = projection?.similarSubmissions ?? memory.similarSubmissions ?? [];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Submission memory · Org2Vec</div>
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

      {loading && !data ? (
        <div className="text-xs text-slate-500">Loading memory…</div>
      ) : isAbsent ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          <p>No submission memory has been computed yet.</p>
          <p className="mt-1 text-[11px] text-slate-500">Refresh to reconstruct the broker thread into timeline, missing info, underwriting flags and referral triggers.</p>
        </div>
      ) : (
        <>
          {memory.summary ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-700">{memory.summary}</div>
          ) : null}

          {memory.underwritingFlags && memory.underwritingFlags.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-rose-700">Underwriting flags</div>
              {memory.underwritingFlags.map((flag, idx) => (
                <div key={`${flag.code}-${idx}`} className={`rounded border px-2 py-1.5 text-[11px] ${flagCls(flag.severity)}`}>
                  <span className="font-semibold">{flag.code.replace(/_/g, ' ')}.</span> {flag.summary}
                </div>
              ))}
            </div>
          ) : null}

          {memory.referralTriggers && memory.referralTriggers.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Referral triggers</div>
              {memory.referralTriggers.map((t, idx) => (
                <div key={`${t.code}-${idx}`} className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  <span className="font-semibold">{t.code.replace(/_/g, ' ')}.</span> {t.summary}
                </div>
              ))}
            </div>
          ) : null}

          {memory.missingInformation && memory.missingInformation.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Missing information</div>
              {memory.missingInformation.map((row, idx) => (
                <div key={`${row.item}-${idx}`} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                  <span>{row.item}</span>
                  <span className="text-[10px] font-semibold">{row.received ? 'received' : 'outstanding'}</span>
                </div>
              ))}
            </div>
          ) : null}

          {memory.endorsementChecks && memory.endorsementChecks.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-700">Endorsement checks</div>
              {memory.endorsementChecks.map((c, idx) => (
                <div key={`${c.endorsementRef}-${idx}`} className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{c.endorsementRef}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wide">{c.status.replace(/_/g, ' ')}</span>
                  </div>
                  {c.summary ? <div className="text-indigo-700">{c.summary}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          {similar.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-violet-700">Similar submissions (graph)</div>
              {similar.slice(0, 3).map((row) => (
                <div key={row.submissionId} className="rounded border border-violet-200 bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{row.submissionId.slice(0, 12)}</span>
                    <span className="text-[10px] tabular-nums text-violet-600">score {row.score}</span>
                  </div>
                  {row.reasons && row.reasons.length > 0 ? (
                    <div className="text-[10px] text-violet-700">{row.reasons.slice(0, 3).join(' · ')}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {memory.recommendedActions && memory.recommendedActions.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Recommended actions</div>
              {memory.recommendedActions.map((a, idx) => (
                <div key={`${a.code}-${idx}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700">
                  <span className="font-semibold">{a.code.replace(/_/g, ' ')}.</span> {a.summary}
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
                      <span className="text-slate-500">{event.date.slice(0, 10)}</span> · {event.summary}
                      {event.citation ? (
                        <span className="ml-1 inline-flex h-3.5 items-center rounded-sm border border-slate-300 px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500" title={event.citation.quote}>
                          cite
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
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
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-slate-600">Citations ({memory.citations.length})</summary>
              <ul className="mt-1 space-y-1">
                {memory.citations.slice(0, 8).map((cite, idx) => (
                  <li key={cite.messageId ?? cite.documentId ?? idx} className="border-l-2 border-slate-300 pl-2 text-[10px] italic text-slate-600">
                    “{cite.quote}”
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Draft broker request (not sent)</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="No draft suggested — refresh memory to generate one."
              className="h-24 w-full resize-y rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
            />
            <p className="text-[9px] text-slate-400">Review and send manually — Org2Vec never sends.</p>
          </div>

          <div className="space-y-1 border-t border-slate-100 pt-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Ask the submission memory</div>
            <div className="flex items-center gap-1.5">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onAsk();
                }}
                placeholder="e.g. What is the requested sum insured?"
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
                      <li key={idx} className="border-l-2 border-slate-300 pl-2 text-[10px] italic text-slate-500">“{cite.quote}”</li>
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
