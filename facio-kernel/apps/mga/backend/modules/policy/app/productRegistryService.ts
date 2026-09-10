import { assertConfiguredJourneyCapability } from '../../insuranceConfiguration/domain/runtimeConfiguration.js';
import { assertConfiguredQuestions } from '../../insuranceConfiguration/domain/questionnaireEvaluation.js';
import { ProductRegistry } from '../domain/ProductRegistry.js';
import type { Prisma } from '@prisma/client';
import { buildCoverageOptionsView } from './coverageOptionsView.js';
import {
  parsePublishedProgramMbeProductConfig,
  resolveCoverageV1,
  type ResolvedCoverageSet,
} from '../../mbe/domain/programProduct.js';
import type { BuildQuoteResponseContext, BuildVersionRowsArgs, ProductIpidAsset, ProductIpidSelectionContext } from '../domain/productContracts.js';
import { validateDraftQuote } from '../../quotes/app/validatorImpl.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { resolveMappedProgramDefinition } from '../../programs/app/activeProgramDefinition.js';
import type { ResolvedProgramDefinition } from '../../programs/domain/programDefinition.js';
import { parsePublishedProductKit } from '../../programs/domain/productKit/productKit.js';
import { parsePublishedProgrammeDocumentSelection } from '../../programs/app/programRuntimeDefinitions.js';

type UnknownRecord = Record<string, unknown>;

function requireProductAdapter(productType: string) {
  const normalized = String(productType || '').trim().toUpperCase();
  const adapter = ProductRegistry.getInstance().getAdapter(normalized);
  if (!adapter) throw new Error(`No product adapter for '${normalized || productType}'`);
  return adapter;
}

export function productAdapterExists(productType: string): boolean {
  return Boolean(ProductRegistry.getInstance().getAdapter(String(productType || '').trim().toUpperCase()));
}

export function getProductSegmentLabel(productType: string): string {
  return requireProductAdapter(productType).getManifest().theme.segmentLabel;
}

export function getProductDisplaySection(productType: string): string {
  return requireProductAdapter(productType).displayName.split(' ')[0] || '—';
}

/**
 * Product-owned post-approval customer fields. Shared referral handling must
 * never name a product field itself; the adapter remains the authority.
 */
export function getManualUwApprovalCustomerCompletionPaths(productType: string): string[] {
  return requireProductAdapter(productType).getManualUwApprovalCustomerCompletionPaths();
}

export function buildProductVersionMeta(productType: string, quoteData: unknown) {
  return requireProductAdapter(productType).buildVersionMeta(quoteData);
}

export function buildProductVersionRows(productType: string, args: BuildVersionRowsArgs) {
  return requireProductAdapter(productType).buildVersionRows(args);
}

export type ExternalIssuanceRequirements =
  | { found: false }
  | { found: true; canComplete: boolean; requiresUpload: boolean; documentTypes: string[] };

export type ProgrammeExternalIssuanceWorkflow = {
  mode: 'manager_upload_after_payment';
  documentTypes: string[];
};

/**
 * Resolves external-issuance behaviour from the published programme selected
 * for a policy's exact binder-product authority. Product adapters may expose
 * generic capability, but they cannot decide a carrier/programme workflow.
 */
export async function resolveProgrammeExternalIssuanceWorkflow(args: {
  programId: string;
  binderId: string;
  productType: string;
}): Promise<ProgrammeExternalIssuanceWorkflow | null> {
  const programId = String(args.programId || '').trim();
  const binderId = String(args.binderId || '').trim();
  const productType = String(args.productType || '').trim().toUpperCase();
  if (!programId || !binderId || !productType) {
    throw new Error('External issuance requires a policy programme, binder, and product type.');
  }
  const authority = await tenantScopedPrisma.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId, productCode: productType } },
    select: { id: true },
  });
  if (!authority) {
    throw new Error('External issuance requires an active binder-product authority for the policy product.');
  }
  const definition = await resolveMappedProgramDefinition({
    programId,
    binderProductAuthorityId: authority.id,
  });
  const externalIssuance = definition.workflow.externalIssuance;
  if (
    !externalIssuance
    || typeof externalIssuance !== 'object'
    || Array.isArray(externalIssuance)
    || externalIssuance.mode === 'NONE'
  ) {
    return null;
  }
  if (externalIssuance.mode !== 'manager_upload_after_payment') {
    throw new Error('Published external issuance workflow has an unsupported mode.');
  }
  if (!Array.isArray(externalIssuance.documentTypes)) {
    throw new Error('Published external issuance workflow has no document types.');
  }
  const documentTypes = externalIssuance.documentTypes
    .filter((type): type is string => typeof type === 'string' && type.trim().length > 0)
    .map((type) => type.trim());
  if (documentTypes.length === 0) {
    throw new Error('Published external issuance workflow has no document types.');
  }
  return { mode: 'manager_upload_after_payment', documentTypes };
}

/**
 * Canonical manager-completion projection for adapter-declared external
 * issuance. HTTP renders this state but does not inspect product authority.
 */
export async function getExternalIssuanceRequirements(policyId: string): Promise<ExternalIssuanceRequirements> {
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: { productType: true, status: true, programId: true, binderId: true },
  });
  if (!policy) return { found: false };

  const externalIssuance = await resolveProgrammeExternalIssuanceWorkflow({
    programId: String(policy.programId || ''),
    binderId: String(policy.binderId || ''),
    productType: String(policy.productType || ''),
  });
  if (!externalIssuance) {
    return { found: true, canComplete: false, requiresUpload: false, documentTypes: [] };
  }
  const documentTypes = externalIssuance.documentTypes;
  const persistedDocuments = await tenantScopedPrisma.document.findMany({
    where: {
      policyId,
      docPack: 'ISSUED_POLICY_PACK',
      status: 'GENERATED',
      type: { in: documentTypes },
    },
    select: { type: true },
  });
  const persistedTypes = new Set(persistedDocuments.map((document) => String(document.type || '').trim()));
  const requiresUpload = !(persistedTypes.size === documentTypes.length && documentTypes.every((type) => persistedTypes.has(type)));
  const status = String(policy.status || '').trim().toUpperCase();

  return {
    found: true,
    canComplete: status === 'AWAITING_EXTERNAL_ISSUANCE' || status === 'BOUND',
    requiresUpload,
    documentTypes,
  };
}

/**
 * Resolve a product's IPID static asset for the given territory, for
 * pre-purchase display at quote stage (Peter, 2026-07-21). Returns null when
 * the product does not exist or has no IPID (e.g. Motor). May throw for a
 * product whose IPID is territory-configured and the territory is unknown
 * (Home) — the caller (public IPID route) turns that into a 404.
 */
export function resolveProductIpidAsset(productType: string, countryCode: string, selection?: ProductIpidSelectionContext): ProductIpidAsset | null {
  const adapter = ProductRegistry.getInstance().getAdapter(String(productType || '').trim().toUpperCase());
  if (!adapter || typeof adapter.resolveIpidAsset !== 'function') return null;
  return adapter.resolveIpidAsset(countryCode, selection);
}

/**
 * Resolves the immutable programme definition authorised for one binder
 * product authority and, for automated programmes, its coverage selection.
 * Quote entry points call this before invoking a product engine so they cannot
 * reconstruct product behaviour from mutable Program.metadata.
 */
export async function resolvePublishedProgramQuoteContext(args: {
  productType: string;
  programId: string;
  binderProductAuthorityId: string;
  quoteData: unknown;
  selectedOptions?: Record<string, boolean>;
  paramsByCode?: Prisma.JsonObject;
}) {
  const programDefinition = await resolveMappedProgramDefinition({
    programId: args.programId,
    binderProductAuthorityId: args.binderProductAuthorityId,
  });
  if (programDefinition.pricingMode === 'MANUAL') {
    return { programDefinition, coverage: undefined, resolvedCoverageSet: undefined };
  }

  const coverage = parsePublishedProgramMbeProductConfig(programDefinition.coverage, {
    productType: args.productType,
  });
  return {
    programDefinition,
    coverage,
    resolvedCoverageSet: resolveCoverageV1({
      productType: args.productType,
      quoteData: args.quoteData,
      cfg: coverage,
      selectedOptions: args.selectedOptions,
      paramsByCode: args.paramsByCode,
    }),
  };
}

/**
 * Resolves the document-facing components from the one immutable definition
 * mapped to the policy's binder authority. HTTP callers consume this
 * application projection and never parse programme components themselves.
 */
export async function resolvePublishedProgramDocumentConfiguration(args: {
  productType: string;
  programId: string;
  binderProductAuthorityId: string;
}) {
  const programDefinition = await resolveMappedProgramDefinition({
    programId: args.programId,
    binderProductAuthorityId: args.binderProductAuthorityId,
  });
  if (programDefinition.pricingMode !== 'AUTOMATED') {
    throw new Error('Document preview coverage requires an automated programme definition.');
  }
  const kit = parsePublishedProductKit(programDefinition.documents.productKit);
  return {
    brand: kit.brand,
    requiredIssuedDocTypes: parsePublishedProgrammeDocumentSelection(
      args.productType,
      programDefinition.documents,
    ).requiredIssuedDocTypes,
    normalizedMbeCfg: parsePublishedProgramMbeProductConfig(programDefinition.coverage, {
      productType: args.productType,
    }),
  };
}

/**
 * Canonical policy-level document configuration resolver. A policy carries a
 * binder id while a published programme is mapped to a binder-product
 * authority, so callers must resolve that authority before selecting any
 * programme-owned issued-pack requirements.
 */
export async function resolvePolicyProgramDocumentConfiguration(args: {
  productType: string;
  programId: string;
  binderId: string;
}) {
  const productType = String(args.productType || '').trim().toUpperCase();
  const programId = String(args.programId || '').trim();
  const binderId = String(args.binderId || '').trim();
  if (!productType || !programId || !binderId) {
    throw new Error('Policy document configuration requires a product, programme, and binder.');
  }
  const authority = await tenantScopedPrisma.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId, productCode: productType } },
    select: { id: true },
  });
  if (!authority) {
    throw new Error('Policy document configuration requires a binder-product authority.');
  }
  return resolvePublishedProgramDocumentConfiguration({
    productType,
    programId,
    binderProductAuthorityId: authority.id,
  });
}

export type ImmutablePolicyDocumentConfiguration = {
  definitionId: string;
  definitionVersion: number;
  programId: string;
  binderProductAuthorityId: string;
  documents: Prisma.JsonObject;
  requiredIssuedDocTypes: string[];
  documentSources: Array<{ documentType: string; sourceId: string; sourceVersion: string }>;
};

/** Exact selected definition retained with every canonical rating result. */
export function retainProgramDefinition(definition: ResolvedProgramDefinition): Prisma.JsonObject {
  const { id, programId, version, pricingMode, binderProductAuthorityId, underwriting, coverage, questionnaire, workflow, channels, documents } = definition;
  return { id, programId, version, pricingMode, binderProductAuthorityId, underwriting, coverage, questionnaire, workflow, channels, documents };
}

function snapshotRecord(value: unknown, label: string): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Policy decision snapshot requires ${label}.`);
  }
  return value as Prisma.JsonObject;
}

function requiredSnapshotString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Policy decision snapshot requires ${label}.`);
  }
  return value.trim();
}

/**
 * Parses the programme document component that was persisted with a policy
 * decision. This deliberately has no database lookup for a current definition:
 * a later programme publication must never alter an existing quote or policy
 * pack (ADR-0101).
 */
export function parseImmutablePolicyDocumentConfiguration(args: {
  productType: string;
  policyProgramId: string;
  snapshot: unknown;
}): ImmutablePolicyDocumentConfiguration {
  const snapshot = snapshotRecord(args.snapshot, 'a programme definition');
  const definition = snapshotRecord(snapshot.programDefinition, 'programDefinition');
  const programId = requiredSnapshotString(definition.programId, 'programDefinition.programId');
  if (programId !== requiredSnapshotString(args.policyProgramId, 'policy.programId')) {
    throw new Error('Policy decision snapshot programme does not match the policy programme.');
  }
  const version = definition.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('Policy decision snapshot requires a positive programDefinition.version.');
  }
  const documents = snapshotRecord(
    definition.documents,
    'programDefinition.documents',
  ) as Prisma.JsonObject;
  const documentSelection = parsePublishedProgrammeDocumentSelection(args.productType, documents);
  return {
    definitionId: requiredSnapshotString(definition.id, 'programDefinition.id'),
    definitionVersion: version,
    programId,
    binderProductAuthorityId: requiredSnapshotString(
      definition.binderProductAuthorityId,
      'programDefinition.binderProductAuthorityId',
    ),
    documents,
    requiredIssuedDocTypes: documentSelection.requiredIssuedDocTypes,
    documentSources: documentSelection.sources,
  };
}

/**
 * The only policy document-authority resolver. It loads the immutable state
 * captured by quote/bind, validates its product/programme identity, and never
 * consults active mappings, Program.metadata, or runtime document assets.
 */
export async function resolveImmutablePolicyDocumentConfiguration(args: {
  policyId: string;
  riskTransactionId?: string | null;
}): Promise<ImmutablePolicyDocumentConfiguration> {
  const policyId = typeof args.policyId === 'string' ? args.policyId.trim() : '';
  if (!policyId) throw new Error('Policy document configuration requires a policy id.');
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: { id: true, productType: true, programId: true },
  });
  if (!policy) throw new Error('Policy document configuration requires an existing policy.');
  const productType = requiredSnapshotString(policy.productType, 'policy.productType').toUpperCase();
  const policyProgramId = requiredSnapshotString(policy.programId, 'policy.programId');
  let snapshot: unknown;
  const riskTransactionId = args.riskTransactionId == null ? null : String(args.riskTransactionId).trim();
  if (riskTransactionId) {
    const riskTransaction = await tenantScopedPrisma.riskTransaction.findUnique({
      where: { id: riskTransactionId },
      select: { policyId: true, snapshotFinal: true },
    });
    if (!riskTransaction || riskTransaction.policyId !== policy.id) {
      throw new Error('Policy document configuration risk transaction does not belong to the policy.');
    }
    snapshot = riskTransaction.snapshotFinal;
  } else {
    const state = await tenantScopedPrisma.policyStateCurrent.findUnique({
      where: { policyId: policy.id },
      select: { snapshot: true },
    });
    if (!state) throw new Error('Policy document configuration requires a current policy decision snapshot.');
    snapshot = state.snapshot;
  }
  return parseImmutablePolicyDocumentConfiguration({ productType, policyProgramId, snapshot });
}

export async function buildQuoteResponseForProduct(args: {
  productType: string;
  quoteData: unknown;
  programId?: string | null;
  binderProductAuthorityId?: string | null;
  programDefinition?: ResolvedProgramDefinition;
  resolvedCoverageSet?: unknown;
  overrideExcess?: number | string | null;
}) {
  const adapter = requireProductAdapter(args.productType);
  const runtime = adapter.getRuntimeDefinition();
  const programDefinition = runtime?.rating.source === 'program_model'
    ? args.programDefinition || await resolveMappedProgramDefinition({
      programId: String(args.programId || '').trim(),
      binderProductAuthorityId: String(args.binderProductAuthorityId || '').trim(),
    })
    : undefined;
  if (programDefinition) {
    assertConfiguredJourneyCapability(programDefinition.workflow, 'operator', 'quote');
    assertConfiguredQuestions(programDefinition.workflow, args.quoteData, programDefinition);
  }
  const context: BuildQuoteResponseContext = {
    ...(programDefinition ? {
      programDefinition: {
        id: programDefinition.id,
        programId: programDefinition.programId,
        version: programDefinition.version,
        pricingMode: programDefinition.pricingMode,
        binderProductAuthorityId: programDefinition.binderProductAuthorityId,
        underwriting: programDefinition.underwriting,
        coverage: programDefinition.coverage,
        questionnaire: programDefinition.questionnaire,
        workflow: programDefinition.workflow,
        channels: programDefinition.channels,
        documents: programDefinition.documents,
      },
      ...(programDefinition.ratingModel ? {
        ratingModel: {
          ...programDefinition.ratingModel,
          binderProductAuthorityId: programDefinition.binderProductAuthorityId,
        },
      } : {}),
    } : {}),
    ...(args.resolvedCoverageSet ? { resolvedCoverageSet: args.resolvedCoverageSet as ResolvedCoverageSet } : {}),
    ...(args.overrideExcess !== undefined ? { overrideExcess: args.overrideExcess } : {}),
  };
  return adapter.buildQuoteResponse(args.quoteData, context);
}

/**
 * Canonical rating-time validation funnel for the public quote-session
 * `/rate` endpoint shared by Home, Travel, and any future product
 * (`backend/modules/quotes/http/genericPublicQuoteRouter.ts`). The motor
 * service equivalent lives in `backend/products/motor/quotes/service.ts`
 * — both routes converge on the same `validateDraftQuote({ mode:
 * 'quote' })` spine, which dispatches to `validateForContext({ stage:
 * 'quote', actor: 'server' })` against the registered product profile
 * (`docs/architecture/contracts/validation.md` "single source of
 * truth"). The wizard's pre-rate gate
 * (`useQuoteWizardController.rateQuote` etc.) calls the same canonical
 * runner from the browser with `actor: 'customer'`, so a wizard that
 * says "ready" CAN'T be rejected here unless the contract drifts —
 * pinned by `packages/products/src/motor/__tests__/quote-readiness.
 * contract.test.ts`.
 *
 * Returns `{ ok: false, error }` for any structured validation failure
 * so the router stays as a thin HTTP boundary (the
 * `check-product-engine-contract` guard forbids the router file from
 * calling `validateDraftQuote` directly — keep that contract intact).
 */
export type ProductRateValidationResult =
  | { ok: true; normalizedQuoteData: unknown }
  | {
      ok: false;
      error: {
        code: 'INVALID_QUOTE_DATA';
        message: string;
        details: {
          missingSlugs: string[];
          blockingErrors: Array<{ slug: string; status: 'FAIL'; message: string }>;
        };
      };
    };

export function validateProductQuoteForRating(args: {
  productType: string;
  quoteData: Record<string, unknown>;
}): ProductRateValidationResult {
  const verdict = validateDraftQuote({
    quoteData: args.quoteData,
    mode: 'quote',
    productType: args.productType,
  });
  if (verdict.valid) {
    // Type the public surface as `unknown` — the validator's
    // `normalizedQuoteData` is the motor-shape `QuoteData` legacy seam
    // (this funnel pre-dates Home/Travel) and callers narrow when they
    // need a specific shape. `unknown` keeps the canonical-spine
    // surface honest and avoids the no-new-any ratchet.
    return { ok: true, normalizedQuoteData: verdict.normalizedQuoteData };
  }
  return {
    ok: false,
    error: {
      code: 'INVALID_QUOTE_DATA',
      message: 'Quote data failed validation for rating',
      details: {
        missingSlugs: verdict.missingSlugs,
        blockingErrors: verdict.blockingErrors,
      },
    },
  };
}

export async function validateProductQuoteForIssuance(productType: string, quoteData: unknown) {
  return requireProductAdapter(productType).validateForIssuance(quoteData);
}

export function normalizeUwDataForProduct(productType: string, quoteData: unknown) {
  return requireProductAdapter(productType).normalizeUwData(quoteData);
}

function parsePolicyPeriodDate(value: unknown): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function resolvePolicyPeriodForProduct(productType: string, quoteData: unknown): {
  inceptionDate: Date;
  expiryDate: Date;
} | null {
  const adapter = requireProductAdapter(productType);
  const selectedPeriod = adapter.resolvePolicyPeriod?.(quoteData);
  if (selectedPeriod) return selectedPeriod;
  const manifest = adapter.getManifest();
  const coverage = manifest.listColumns.coverage;
  const start = parsePolicyPeriodDate(coverage.buildStartDate?.(quoteData as UnknownRecord));
  const end = parsePolicyPeriodDate(coverage.buildEndDate?.(quoteData as UnknownRecord));
  if (!start || !end || end.getTime() < start.getTime()) return null;
  return { inceptionDate: start, expiryDate: end };
}

export function buildCoverageOptionsViewForProduct(args: {
  productType: string;
  programCode: string;
  contract: Parameters<typeof buildCoverageOptionsView>[0]['contract'];
  activeInstances: Parameters<typeof buildCoverageOptionsView>[0]['activeInstances'];
  quoteData: unknown;
}) {
  const adapter = requireProductAdapter(args.productType);
  const templates = adapter
    .getEndorsementCatalog()
    .filter((template) => String(template.program_code || '').trim() === String(args.programCode || '').trim());
  return buildCoverageOptionsView({
    manifest: adapter.getManifest(),
    groups: adapter.getEndorsementGroups(),
    templates,
    contract: args.contract,
    activeInstances: args.activeInstances,
    quoteData: args.quoteData,
  });
}

export function buildProductDocumentViewModel(args: {
  productType: string;
  policyRecord: UnknownRecord;
  snapshotRecord: UnknownRecord;
  binder: unknown;
  activeEndorsements: unknown[];
  brand: unknown;
  normalizedMbeCfg: unknown;
  mbeSections: unknown;
}) {
  return requireProductAdapter(args.productType).buildDocViewModel({
    policyRecord: args.policyRecord,
    snapshotRecord: args.snapshotRecord,
    binder: args.binder,
    activeEndorsements: args.activeEndorsements,
    brand: args.brand,
    normalizedMbeCfg: args.normalizedMbeCfg,
    mbeSections: args.mbeSections,
  });
}
