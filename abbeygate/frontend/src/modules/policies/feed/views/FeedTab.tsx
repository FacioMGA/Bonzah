import React, { useEffect, useState } from 'react';
import { policyCrudApiClient } from '../../api/policyCrudApiClient';
import { Button } from '@/src/shared/ui';

import { logger } from '@/src/shared/lib/logger';

const FRIENDLY_KEYS: Record<string, string> = {
  fileName: 'File',
  summary: 'Summary',
  recipient: 'To',
  policyNumber: 'Policy #',
  effectiveDate: 'Effective',
  newPremium: 'Premium Change',
  updatedFields: 'Updated Fields',
  batchId: 'Batch Ref',
  name: 'Name',
  segment: 'Segment',
  version: 'Version',
  isSubmission: 'Submission Type',
  url: 'Link',
  certificateUrl: 'Certificate',
  docUrl: 'Document',
  storageUri: 'File Path',
};

export function Feed(props: { policyId?: string | null }) {
  const policyId = String(props.policyId || '').trim();
  type FeedEvent = {
    id?: string;
    actorType?: 'SYSTEM' | 'USER' | string;
    actorName?: string;
    actionName?: string;
    occurredAt?: string;
    diff?: Record<string, unknown>;
  };
  const [feedEvents, setFeedEvents] = useState<FeedEvent[]>([]);
  const [expandedFeedItems, setExpandedFeedItems] = useState<Set<string>>(new Set());

  const toggleFeedItem = (id: string) => {
    setExpandedFeedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!policyId) return;
    const asFeedEvent = (value: unknown): FeedEvent => {
      const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      return {
        id: typeof record.id === 'string' ? record.id : undefined,
        actorType: typeof record.actorType === 'string' ? record.actorType : undefined,
        actorName: typeof record.actorName === 'string' ? record.actorName : undefined,
        actionName: typeof record.actionName === 'string' ? record.actionName : undefined,
        occurredAt: typeof record.occurredAt === 'string' ? record.occurredAt : undefined,
        diff: record.diff && typeof record.diff === 'object' && !Array.isArray(record.diff) ? (record.diff as Record<string, unknown>) : undefined,
      };
    };
    policyCrudApiClient
      .getPolicyFeed(policyId)
      .then((res: { success?: boolean; data?: unknown[] }) => {
        if (res.success) setFeedEvents(Array.isArray(res.data) ? res.data.map(asFeedEvent) : []);
      })
      .catch((err: unknown) => logger.error('Failed to load feed', err));
  }, [policyId]);

  return (
    <div className="max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {(!feedEvents || feedEvents.length === 0) && (
        <div className="text-center py-12">
          <div className="mb-4 inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-50 text-slate-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h3 className="text-sm font-bold text-slate-900">No events yet</h3>
          <p className="text-xs text-slate-500 mt-1">Audit log is empty for this policy.</p>
        </div>
      )}

      <div className="relative border-l-2 border-slate-100 ml-4 space-y-10 pl-8 py-2">
        {feedEvents.map((event, i) => {
          let actorLabel = event.actorType === 'SYSTEM' ? 'SYSTEM' : 'USER';
          if (event.actorName) actorLabel = String(event.actorName).toUpperCase();

          let displayDiff = event.diff || {};
          if (event.actionName === 'QUESTIONNAIRE.SENT' && displayDiff.recipientName) {
            displayDiff = {
              ...displayDiff,
              recipient: `${displayDiff.recipientName} <${displayDiff.recipient}>`,
            };
            delete displayDiff.recipientName;
          }

          const eventId = event.id || String(i);
          const isExpanded = expandedFeedItems.has(eventId);

          return (
            <div key={eventId} className="relative group">
              <div className="absolute -left-10 top-1.5 w-5 h-5 rounded-full border-4 border-white bg-slate-200 group-hover:bg-brand-primary group-hover:scale-110 transition-all shadow-sm z-10"></div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">
                    {new Date(String(event.occurredAt || '')).toLocaleDateString()} • {new Date(String(event.occurredAt || '')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>

                  <span className={`text-xs font-black px-1.5 py-0.5 rounded uppercase tracking-widest ${event.actorType === 'USER' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                    {actorLabel}
                  </span>
                </div>

                <div className="flex justify-between items-start">
                  <h4 className="text-sm font-bold text-slate-800">
                    {(event.actionName || 'Unknown Action').replace('.', ' ')}
                  </h4>

                  {displayDiff && Object.keys(displayDiff).length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleFeedItem(eventId)}
                      className={`p-1 rounded transition-colors bg-transparent ${isExpanded ? 'bg-slate-200 text-slate-700' : 'text-slate-300 hover:text-brand-primary'}`}
                      title="View raw details"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                    </Button>
                  )}
                </div>

                {displayDiff && Object.keys(displayDiff).length > 0 && (
                  <div className="mt-1 bg-slate-50 border border-slate-100/50 rounded-lg px-3 py-2 text-xs text-slate-600">
                    <div className="space-y-1">
                      {Object.entries(displayDiff).map(([key, value]) => {
                        if (!FRIENDLY_KEYS[key] && !isExpanded) return null;

                        const label = FRIENDLY_KEYS[key];
                        if (!label && !isExpanded) return null;

                        if (!isExpanded) {
                          return (
                            <div key={key} className="flex gap-2">
                              <span className="text-slate-400 font-semibold w-24 shrink-0">{label}:</span>
                              <span className="font-semibold text-slate-700 truncate">
                                {['url', 'certificateUrl', 'docUrl', 'storageUri'].includes(key) && String(value).startsWith('http') ? (
                                  <a
                                    href={(() => {
                                      const token = localStorage.getItem('auth_token');
                                      const v = String(value);
                                      return token ? `${v}${v.includes('?') ? '&' : '?'}token=${token}` : v;
                                    })()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-brand-primary hover:underline"
                                  >
                                    Open Document
                                  </a>
                                ) : (
                                  typeof value === 'object' ? JSON.stringify(value).replace(/"/g, '') : String(value)
                                )}
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>

                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-slate-200">
                        <pre className="font-mono text-xs text-slate-500 whitespace-pre-wrap break-all">
                          {JSON.stringify(displayDiff, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

