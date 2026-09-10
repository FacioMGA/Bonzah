/**
 * Workflow object that stages a Config MCP product configuration before
 * sandbox publish. Per ADR-0037, NOT a canonical configuration source —
 * the only runtime authority is canonical Program / Binder /
 * BinderProductAuthority / BinderFinancials / Tenant rows.
 *
 * Single owner: `backend/modules/configuration/`. Enforced by
 * `tools/quality/check-product-launch-draft-isolation.mjs`.
 */

import type { DraftDelta } from './draftDelta.js';

export type ConfigDraftStatus =
    | 'draft'
    | 'validation_failed'
    | 'validated'
    | 'simulated'
    | 'sandbox_published'
    | 'archived';

export const TERMINAL_DRAFT_STATUSES: readonly ConfigDraftStatus[] = [
    'sandbox_published',
    'archived',
] as const;

export interface ProductLaunchDraft {
    id: string;
    operatingTenantId: string;
    name: string;
    baseTemplateId: string;
    productCode: string;
    status: ConfigDraftStatus;
    delta: DraftDelta;
    publishedProgramId: string | null;
    publishedBinderId: string | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
}

export function isTerminal(status: ConfigDraftStatus): boolean {
    return TERMINAL_DRAFT_STATUSES.includes(status);
}

/** Returns true if the draft can still be edited via Config MCP write tools. */
export function isEditable(status: ConfigDraftStatus): boolean {
    return status === 'draft' || status === 'validation_failed' || status === 'validated' || status === 'simulated';
}

/** Returns true if the draft is eligible for sandbox publish. */
export function isPublishable(status: ConfigDraftStatus): boolean {
    return status === 'simulated';
}
