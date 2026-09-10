/**
 * Email Preview & Testing Centre — API client (CHAMPS, domain-scoped).
 *
 * Thin wrapper over the BO-only `/api/email-preview` routes (ADR-0068). All
 * orchestration and state live in `useEmailPreviewController`; the surface page
 * never talks to `http` directly.
 */
import { http } from '@/src/shared/api/http';
import type {
  EmailCoverage,
  EmailPreviewInventory,
  EmailPreviewResult,
} from '../model/emailPreview';

export const emailPreviewApiClient = {
  getInventory() {
    return http.request<EmailPreviewInventory>('email-preview/inventory');
  },

  getCoverage() {
    return http.request<EmailCoverage>('email-preview/coverage');
  },

  getPreview(args: { templateKey: string; jurisdiction: string }) {
    const params = new URLSearchParams({
      templateKey: args.templateKey,
      jurisdiction: args.jurisdiction,
    });
    return http.request<EmailPreviewResult>(`email-preview/preview?${params.toString()}`);
  },

  sendTest(args: { templateKey: string; jurisdiction: string; toEmail: string }) {
    return http.request<{ messageId: string }>('email-preview/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  },
};
