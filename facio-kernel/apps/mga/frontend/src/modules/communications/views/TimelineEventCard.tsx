import { Button } from '@/src/shared/ui';
import {
  openSecureDocument,
  openSecureDocumentPopup,
} from '@/src/modules/policies/documents/openSecureDocument';
import type { CommunicationTimelineItem, CommunicationUser } from '../model/types';

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function resolveActorName(actorId: string | undefined, users: CommunicationUser[]): string {
  if (!actorId) return 'System';
  const user = users.find((candidate) => candidate.id === actorId);
  return user?.name || actorId;
}

function attachmentHref(attachment: { url?: string; storageUri?: string }): string {
  const candidate = String(attachment.url || attachment.storageUri || '').trim();
  if (!candidate) return '';
  const apiMatch = candidate.match(/^\/api\/documents\/([^/?#]+)$/);
  if (apiMatch?.[1]) return `/api/documents/${apiMatch[1]}`;
  const filename = candidate.split(/[\\/]/).filter(Boolean).pop() || candidate;
  if (!filename || filename.includes('..')) return '';
  return `/api/documents/${encodeURIComponent(filename)}`;
}

function initials(name: string): string {
  const parts = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return 'SY';
  return parts.map((part) => part[0]?.toUpperCase() || '').join('');
}

function SystemProfileAvatar(props: { name: string }) {
  const { name } = props;
  const initial = initials(name).slice(0, 1) || 'U';
  return (
    <div className="h-10 w-10 rounded-full border-2 border-white bg-slate-100 shadow-sm flex items-center justify-center overflow-hidden">
      <div className="h-full w-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-[17px] leading-none">
        {initial}
      </div>
    </div>
  );
}

function channelIcon(channel: string | undefined) {
  switch (channel) {
    case 'EMAIL':
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="3.5" y="5.5" width="17" height="13" rx="3" strokeWidth="1.8" />
          <path d="M5.5 8l6.5 5 6.5-5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'NOTE':
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M8 4.5h8l3 3v12a2 2 0 0 1-2 2H8a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Z" strokeWidth="1.8" />
          <path d="M9 10h6M9 14h6M9 18h4" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'SMS':
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M6 6.5h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H11l-4.5 3v-3H6a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case 'WHATSAPP':
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 20a8 8 0 1 0-4.68-1.51L5 20l1.63-2.13A7.96 7.96 0 0 0 12 20Z" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9.7 10.2c.3-.6.6-.7.9-.7h.5c.1 0 .4.1.5.5.2.4.6 1.4.7 1.5.1.1.1.3 0 .4l-.3.4c-.1.1-.2.2-.1.4.1.2.4.7.9 1.1.6.6 1.2.8 1.4.9.2.1.3.1.4 0l.5-.6c.1-.1.2-.1.4-.1.1 0 1 .5 1.5.7.4.2.5.4.5.5v.5c0 .3-.2.6-.7.9-.5.2-1.2.3-2 .1-.8-.2-1.8-.8-2.9-1.8-1-.9-1.7-1.9-1.9-2.8-.2-.8-.1-1.5.2-1.9Z" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="8" strokeWidth="1.8" />
        </svg>
      );
  }
}

function label(kind: CommunicationTimelineItem['kind']): string {
  switch (kind) {
    case 'MESSAGE_OUTBOUND':
      return 'Outbound';
    case 'MESSAGE_INBOUND':
      return 'Inbound';
    case 'NOTE':
      return 'Internal note';
    case 'DELIVERY_FAILURE':
      return 'Failure';
    case 'RETRY':
      return 'Retry';
    case 'APPROVAL_REQUESTED':
      return 'Approval requested';
    case 'APPROVAL_APPROVED':
      return 'Approved';
    case 'APPROVAL_REJECTED':
      return 'Rejected';
    case 'TEMPLATE_RENDERED':
      return 'Template';
    default:
      return 'System';
  }
}

function deliveryState(status: string | undefined) {
  const key = String(status || '').trim().toUpperCase();
  switch (key) {
    case 'QUEUED':
    case 'SENDING':
      return {
        label: key === 'QUEUED' ? 'Queued' : 'Sending',
        className: 'text-slate-400',
        icon: (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="12" cy="12" r="8" strokeWidth="1.8" />
            <path d="M12 8.5v4l2.5 1.5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      };
    case 'SENT':
      return {
        label: 'Sent',
        className: 'text-sky-500',
        icon: (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M7 12.5l3.2 3.2L17 9" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      };
    case 'DELIVERED':
      return {
        label: 'Delivered',
        className: 'text-emerald-500',
        icon: (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M3.5 12.5l3 3L11 10.5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 12.5l3 3 7-7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      };
    case 'FAILED':
    case 'BOUNCED':
      return {
        label: key === 'BOUNCED' ? 'Bounced' : 'Failed',
        className: 'text-rose-500',
        icon: (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="12" cy="12" r="8" strokeWidth="1.8" />
            <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ),
      };
    default:
      return null;
  }
}

export function TimelineEventCard(props: {
  item: CommunicationTimelineItem;
  users: CommunicationUser[];
  showConnector?: boolean;
  onRetry?: (messageId: string) => void;
  onApprove?: (messageId: string) => void;
  onReject?: (messageId: string) => void;
}) {
  const { item, users, showConnector = false, onRetry, onApprove, onReject } = props;
  const actorName = resolveActorName(item.fromActor, users);
  const isMessage = item.kind === 'MESSAGE_OUTBOUND' || item.kind === 'MESSAGE_INBOUND' || item.kind === 'NOTE';
  const recipientText = item.toRecipients?.length ? item.toRecipients.join(', ') : '';
  const isEmailLike = item.channel === 'EMAIL' || item.kind === 'TEMPLATE_RENDERED';
  const bubbleTone = item.kind === 'DELIVERY_FAILURE'
    ? 'bg-white border-rose-100 text-slate-700 shadow-[0_10px_30px_rgba(244,63,94,0.08)]'
    : item.kind === 'NOTE'
      ? 'bg-amber-50 border-amber-100 text-slate-700'
      : 'bg-white border-slate-100 text-slate-700';
  const bubbleWidth = item.kind === 'NOTE'
    ? 'max-w-[220px]'
    : item.kind === 'DELIVERY_FAILURE'
      ? 'max-w-[470px]'
      : isEmailLike
        ? 'max-w-[430px]'
        : 'max-w-[340px]';
  const senderTone = item.kind === 'DELIVERY_FAILURE'
    ? 'text-slate-700'
    : 'text-brand-primary';
  const recipientTone = item.kind === 'NOTE'
    ? 'text-emerald-700'
    : 'text-emerald-600';
  const state = deliveryState(item.status);

  return (
    <div className="px-1 py-1">
      <div className="grid grid-cols-[96px_24px_40px_minmax(0,1fr)] items-center gap-x-5">
        <div className="text-right text-[11px] font-semibold text-slate-300">
          {formatTimestamp(item.occurredAt)}
        </div>

        <div className="relative flex h-full min-h-[72px] items-center justify-center self-stretch">
          <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-300/70 bg-slate-200" />
          {showConnector && (
            <div className="absolute left-1/2 top-1/2 bottom-[-36px] w-px -translate-x-1/2 bg-slate-200/60" />
          )}
        </div>

        <div className="relative flex h-10 w-10 items-center justify-center self-center">
          <SystemProfileAvatar name={actorName} />
          <div className="absolute -right-1 -top-1 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-white bg-white text-emerald-500 shadow-sm">
            {channelIcon(item.channel)}
          </div>
        </div>

        <div className="min-w-0 self-center">
          <div className="flex min-h-[72px] flex-col justify-center">
            <div className="flex flex-wrap items-center gap-3 text-[12px] font-semibold leading-none">
              <span className={senderTone}>{actorName}</span>
            {item.sourceLabel && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {item.sourceLabel}
              </span>
            )}
            {isMessage && recipientText && (
              <>
                <span className="text-slate-300">→</span>
                <span className={recipientTone}>{recipientText}</span>
              </>
            )}
            {!isMessage && (
              <span className="text-slate-400">{label(item.kind)}</span>
            )}
            {state && (
              <span
                className={`inline-flex items-center ${state.className}`}
                title={state.label}
                aria-label={state.label}
              >
                {state.icon}
              </span>
            )}
            </div>

            <div className={`mt-2 inline-block ${bubbleWidth} rounded-[28px] border px-5 py-4 shadow-sm ${bubbleTone}`}>
              {isEmailLike && item.title && (
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">Subject</div>
                  <div className="mt-2 text-sm font-bold text-slate-900">{item.title}</div>
                </div>
              )}

              {item.body && (
                <div className="whitespace-pre-wrap text-[13px] leading-6">
                  {item.body}
                </div>
              )}

              {!isEmailLike && item.title && (
                <div className="mt-2 text-[12px] font-semibold text-slate-500">
                  {item.title}
                </div>
              )}

              {!!item.attachments?.length && (
                <div className="mt-4" data-testid="documents-sent">
                  <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                    Documents sent
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.attachments.map((attachment) => {
                      const href = attachmentHref(attachment);
                      if (!href) {
                        return (
                          <span
                            key={`${item.id}:${attachment.filename}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600"
                          >
                            {attachment.filename}
                          </span>
                        );
                      }
                      return (
                        <a
                          key={`${item.id}:${attachment.filename}`}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            event.preventDefault();
                            const popup = openSecureDocumentPopup();
                            void openSecureDocument(href, { inline: true, popup });
                          }}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-brand-primary/40 hover:text-brand-primary"
                        >
                          {attachment.filename}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {item.errorCode && (
                <div className="mt-4 text-[11px] font-semibold text-rose-600">
                  {item.errorCode}{item.errorDetail ? ` - ${item.errorDetail}` : ''}
                </div>
              )}
            </div>

            {(item.kind === 'DELIVERY_FAILURE' || item.kind === 'APPROVAL_REQUESTED') && item.messageId && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.kind === 'DELIVERY_FAILURE' && onRetry && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => onRetry(item.messageId!)}>
                    Retry message
                  </Button>
                )}
                {item.kind === 'APPROVAL_REQUESTED' && onApprove && (
                  <Button type="button" size="sm" variant="primary" onClick={() => onApprove(item.messageId!)}>
                    Approve
                  </Button>
                )}
                {item.kind === 'APPROVAL_REQUESTED' && onReject && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => onReject(item.messageId!)}>
                    Reject
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
