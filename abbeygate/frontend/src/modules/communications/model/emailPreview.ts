/**
 * Email Preview & Testing Centre — view models (CHAMPS).
 *
 * Wire shapes for the BO-only `/api/email-preview` surface (ADR-0068). Kept in
 * the communications module so the BO page stays a thin composition shell and
 * the orchestration lives in `useEmailPreviewController`.
 */

export type EmailTemplateGovernance = {
  version: number | null;
  approvalStatus: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lastEditor: string | null;
  lastDeployedSha: string | null;
  hasDbOverride: boolean;
};

export type EmailInventoryItem = {
  trigger: string;
  templateKey: string;
  templateName: string;
  systemOnly: boolean;
  tags: string[];
  requiredVariables: string[];
  governance: EmailTemplateGovernance;
};

/** A system email that bypasses the trigger registry (not previewable here). */
export type DirectEmailProducer = {
  id: string;
  source: string;
  reason: string;
};

export type EmailPreviewInventory = {
  triggerTemplates: EmailInventoryItem[];
  directProducers: DirectEmailProducer[];
};

export type EmailLintFinding = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  detail?: string;
};

export type EmailPreviewResult = {
  trigger: string | null;
  templateKey: string;
  templateName: string;
  jurisdiction: string;
  systemOnly: boolean;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  missingVariables: string[];
  lint: EmailLintFinding[];
  governance: EmailTemplateGovernance;
  availableJurisdictions: string[];
};

export type EmailCoverageRow = {
  trigger: string;
  templateKey: string;
  hasFixture: boolean;
  rendersClean: boolean;
  lintErrors: number;
  approvalStatus: string;
  snapshotStatus: string;
};

export type EmailCoverage = {
  generatedShaAtRuntime: string;
  rows: EmailCoverageRow[];
  summary: { total: number; clean: number; withErrors: number; directProducers: number };
};

export const EMAIL_PREVIEW_JURISDICTIONS = ['CY', 'GR', 'PT', 'ES'] as const;
export type EmailPreviewJurisdiction = (typeof EMAIL_PREVIEW_JURISDICTIONS)[number];
