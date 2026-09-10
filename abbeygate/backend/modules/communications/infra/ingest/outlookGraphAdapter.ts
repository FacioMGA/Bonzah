/**
 * outlookGraphAdapter — live Microsoft Graph reader (ADR-0044).
 *
 * Feature-flagged and OFF by default. When `ORG2VEC_GRAPH_ENABLED=true`
 * and a bearer token is available (`ORG2VEC_GRAPH_TOKEN`, or one passed by
 * the caller), it pulls recent messages from a mailbox/folder through the
 * Microsoft Graph REST API and maps them to the normalized shape via the
 * domain mapper — the exact same shape the sample/upload adapters emit.
 *
 * This is the real adapter behind the demo connector: swapping the demo
 * for a live mailbox is a flag + token, not a code change. Token
 * acquisition (MSAL/app-only consent) is intentionally out of demo scope.
 */

import { logger } from '../../../../platform/utils/logger.js';
import {
  normalizeGraphMessage,
  type NormalizedOutlookMessage,
} from '../../domain/providers/outlookMessage.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface GraphFetchOptions {
  /** Bearer access token; falls back to ORG2VEC_GRAPH_TOKEN. */
  accessToken?: string;
  /** Mailbox UPN (defaults to /me). */
  mailbox?: string;
  /** Max messages to pull. */
  top?: number;
}

export function isGraphIngestionEnabled(): boolean {
  return String(process.env.ORG2VEC_GRAPH_ENABLED || '').trim().toLowerCase() === 'true';
}

interface GraphListResponse {
  value?: unknown[];
}

/** Pull recent messages from Microsoft Graph. Throws when disabled/unauthorized. */
export async function fetchGraphMessages(options: GraphFetchOptions = {}): Promise<NormalizedOutlookMessage[]> {
  if (!isGraphIngestionEnabled()) {
    throw new Error('graph_disabled: set ORG2VEC_GRAPH_ENABLED=true to use the live Microsoft Graph adapter');
  }
  const token = String(options.accessToken || process.env.ORG2VEC_GRAPH_TOKEN || '').trim();
  if (!token) {
    throw new Error('graph_no_token: provide an access token via ORG2VEC_GRAPH_TOKEN or the request body');
  }

  const top = Math.min(50, Math.max(1, options.top ?? 25));
  const base = options.mailbox ? `${GRAPH_BASE}/users/${encodeURIComponent(options.mailbox)}` : `${GRAPH_BASE}/me`;
  const url = `${base}/messages?$top=${top}&$select=id,conversationId,subject,from,sender,toRecipients,ccRecipients,sentDateTime,receivedDateTime,body,bodyPreview,hasAttachments&$orderby=receivedDateTime desc`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn({ event: 'org2vec.graph.fetch_failed', status: res.status, text: text.slice(0, 200) }, 'org2vec.graph.fetch_failed');
    throw new Error(`graph_http_${res.status}`);
  }
  const payload = (await res.json()) as GraphListResponse;
  const rows = Array.isArray(payload.value) ? payload.value : [];
  return rows.map((raw) => normalizeGraphMessage(raw as Parameters<typeof normalizeGraphMessage>[0]));
}
