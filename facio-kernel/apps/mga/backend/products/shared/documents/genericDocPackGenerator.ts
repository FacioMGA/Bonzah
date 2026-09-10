import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import { storageService } from '../../../platform/storage/service.js';
import { renderHtmlToPdf } from '../../../modules/documents/app/pdfRenderer.js';
import { logger } from '../../../platform/utils/logger.js';
import type { ProductDocumentPackContract, ProductDocumentPackEntry } from './productDocumentPackContract.js';
import { resolveDocPackVersion } from './docPackVersion.js';
import { tenantDocumentBrand } from './tenantDocumentBrand.js';

/**
 * Product-agnostic document pack generator.
 *
 * Encapsulates the version/supersede/render/upload/persist loop that every
 * product needs and that previously only Motor implemented. Each product
 * supplies:
 *   - the policy lookup adapter (so it can include product-specific relations
 *     if it chooses to — most products just take the default),
 *   - a template directory (Handlebars files on disk),
 *   - a view-model builder that turns the `Policy + RiskTransaction +
 *     PolicyStateCurrent.snapshot` into a flat record consumed by the
 *     templates,
 *   - a per-docPack list of `{ docType, filename, template }` records.
 *
 * This keeps Motor's hand-rolled implementation untouched while letting
 * Travel and Home produce real `Document` rows with real PDFs in storage —
 * the prerequisite for `DOC.GENERATE_ISSUED_POLICY_PACK` to succeed and for
 * the welcome-email orchestration to attach the right PDFs.
 */

export type DocPackKind =
  | 'QUOTE_PACK'
  | 'DRAFT_POLICY_PACK'
  | 'ISSUED_POLICY_PACK'
  | 'ENDORSEMENT_PACK';

export type DocPackSource = 'CUSTOMER' | 'BO' | 'SYSTEM';

export type GenerateProductDocPackArgs = {
  policyId: string;
  riskTransactionId?: string | null;
  docPack: DocPackKind | string;
  source: DocPackSource | string;
  generatedByUserId?: string | null;
  templateVersion?: string;
  requiredIssuedDocTypes?: string[];
  /** Immutable programme component resolved with the originating decision. */
  documentSources?: Array<{ documentType: string; sourceId: string; sourceVersion: string }>;
  db?: Prisma.TransactionClient | typeof prisma;
};

export type ProductDocSpecBase = {
  /** Canonical document type, must match the product's `requiredIssuedDocTypes`. */
  docType: string;
  /** Product-owned source capability chosen by the programme definition. */
  sourceId: string;
  sourceVersion: string;
  /** PDF filename presented to operators / customers. */
  filename: string;
  /** Version of this exact template/static asset within the product pack contract. */
  assetVersion?: string;
  /** Optional view-model overrides merged on top of the shared view-model. */
  viewModelOverrides?: Record<string, unknown>;
};

export type ProductTemplateDocSpec = ProductDocSpecBase & {
  mode?: 'template';
  /** Handlebars template filename (relative to `templatesDir`). */
  template: string;
  /** Optional per-doc PDF margins (defaults to the schedule margin). */
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  /** Optional per-doc page header HTML. */
  headerTemplate?: string;
  /** Optional per-doc page footer HTML. */
  footerTemplate?: string;
};

export type ProductStaticPdfDocSpec = ProductDocSpecBase & {
  mode: 'staticPdf';
  /** Absolute path to a versioned, product-owned static PDF asset. */
  staticPdfPath: string;
};

export type ProductDocSpec = ProductTemplateDocSpec | ProductStaticPdfDocSpec;

export type DocPackContext = {
  policy: PolicyForDocPack;
  riskTransactionId: string | null;
  snapshot: Record<string, unknown>;
  quoteData: Record<string, unknown>;
  documentSources: Array<{ documentType: string; sourceId: string; sourceVersion: string }>;
};

export type ProductDocPackConfig = {
  /** Upper-case product type (e.g. 'TRAVEL', 'HOME'). */
  productType: string;
  /** Absolute path to the directory containing `*.html` Handlebars templates. */
  templatesDir: string;
  /** Build the shared view-model passed to every template. */
  buildViewModel: (ctx: DocPackContext) => Record<string, unknown>;
  /** Choose which PDFs to render for a given pack. */
  selectDocs: (ctx: DocPackContext, args: { docPack: string; nextVersion: number }) => ProductDocSpec[];
};

/**
 * Issuance recovery replays the canonical issued-pack event after a failed or
 * partial attempt. The replay must continue the active version; a new version
 * is only appropriate for pack kinds that explicitly support regeneration.
 */
export type PolicyForDocPack = {
  id: string;
  policyNumber: string | null;
  certificateNumber: string | null;
  productType: string | null;
  inceptionDate: Date | null;
  expiryDate: Date | null;
  umr: string | null;
  binderId: string | null;
  /**
   * UMR of the bound binder (canonical owner of the Unique Market Reference).
   * Populated from the loaded binder so documents can render the correct UMR
   * even for pre-issuance packs, and never fall back to the policy number.
   */
  binderUmr?: string | null;
  policyHolder: { id: string; name: string | null; address: string | null; contact: string | null } | null;
};

const DEFAULT_TEMPLATE_VERSION = 'facio:tenant-documents:v1';

const DEFAULT_HEADER = `
  <div style="font-family: Inter, Arial, sans-serif; font-size: 10px; color: #64748B; width: 100%; padding: 0 6mm; display: flex; justify-content: flex-end; align-items: center; height: 100%;"></div>`;

function defaultFooter(productLabel: string, umr: string): string {
  return `
    <div style="font-family: Inter, Arial, sans-serif; font-size: 10px; color: #64748B; width: 100%; padding: 0 6mm; display: flex; justify-content: space-between; border-top: 1px solid #E2E8F0; padding-top: 8px;">
        <span style="font-weight: 600;">${escapeHtml(productLabel)}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span> | UMR: ${escapeHtml(umr)}</span>
    </div>`;
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const TEMPLATE_CACHE = new Map<string, string>();
const STATIC_PDF_CACHE = new Map<string, Buffer>();

function loadTemplate(templatesDir: string, name: string): string {
  const key = path.join(templatesDir, name);
  const cached = TEMPLATE_CACHE.get(key);
  if (cached) return cached;
  const txt = fs.readFileSync(key, 'utf-8');
  TEMPLATE_CACHE.set(key, txt);
  return txt;
}

function compile(templatesDir: string, name: string, data: Record<string, unknown>): string {
  const html = loadTemplate(templatesDir, name);
  const tpl = Handlebars.compile(html);
  return tpl(data);
}

function loadStaticPdf(filePath: string): Buffer {
  const cached = STATIC_PDF_CACHE.get(filePath);
  if (cached) return cached;
  if (!path.isAbsolute(filePath)) throw new Error(`Static PDF path must be absolute: ${filePath}`);
  if (!filePath.endsWith('.pdf')) throw new Error(`Static document asset must be a PDF: ${filePath}`);
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) throw new Error(`Static PDF asset is empty: ${filePath}`);
  STATIC_PDF_CACHE.set(filePath, buf);
  return buf;
}

function safeFilenameSegment(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 64) || 'policy';
}

function filenameForEntry(entry: ProductDocumentPackEntry, ctx: DocPackContext, args: { docPack: string; nextVersion: number }): string {
  const policyNumber = safeFilenameSegment(ctx.policy.policyNumber || ctx.policy.id);
  const draftPrefix = args.docPack === 'DRAFT_POLICY_PACK' ? 'DRAFT_' : args.docPack === 'QUOTE_PACK' ? 'QUOTE_' : '';
  const base = entry.filename.replace('{policyNumber}', policyNumber);
  const withDraft = entry.mode === 'template' && entry.draftPrefix ? `${draftPrefix}${base}` : base;
  if (args.docPack === 'ENDORSEMENT_PACK' && entry.mode === 'template' && entry.endorsementVersionedFilename) {
    return withDraft.replace(/\.pdf$/i, `_v${args.nextVersion}.pdf`);
  }
  return withDraft;
}

export function selectProductDocsFromContract(
  contract: ProductDocumentPackContract,
  ctx: DocPackContext,
  args: { docPack: string; nextVersion: number },
): ProductDocSpec[] {
  const docPack = args.docPack as DocPackKind;
  return contract.entries
    .filter((entry) => entry.scope.docPacks.includes(docPack))
    .filter((entry) => ctx.documentSources.some((source) => source.documentType === entry.docType))
    .map((entry): ProductDocSpec => {
      const base = {
        docType: entry.docType,
        sourceId: entry.sourceId,
        sourceVersion: entry.sourceVersion,
        filename: filenameForEntry(entry, ctx, args),
        assetVersion: entry.assetVersion,
      };
      if (entry.mode === 'staticPdf') {
        return { ...base, mode: 'staticPdf', staticPdfPath: entry.staticPdfPath };
      }
      return {
        ...base,
        mode: 'template',
        template: entry.template,
        viewModelOverrides: entry.viewModelOverrides,
        margin: entry.margin,
        headerTemplate: entry.headerTemplate,
        footerTemplate: entry.footerTemplate,
      };
    });
}

/**
 * Render the configured doc pack and persist `Document` rows.
 *
 * Issued-policy packs are idempotent at the
 * (policyId, riskTransactionId, docPack, type) level. A recovery/retry must
 * complete a partial active pack, not supersede it and create a second pack.
 * Other pack kinds retain their existing versioned-regeneration behaviour.
 */
export async function generateProductDocPack(
  config: ProductDocPackConfig,
  args: GenerateProductDocPackArgs,
): Promise<{
  version: number;
  documents: Array<{
    id: string;
    type: string;
    storageUri: string;
    filename: string;
    fileHash: string | null;
    status: string;
    version: number;
    docPack: string | null;
    templateVersion: string | null;
    riskTransactionId: string | null;
  }>;
}> {
  const templateVersion = args.templateVersion || DEFAULT_TEMPLATE_VERSION;
  // `args.db` may be a root client or a tenant-scoped transaction. Both
  // provide this generator's delegate surface; narrow once at the boundary
  // so Prisma extension overloads do not form an uncallable union.
  const db: Prisma.TransactionClient = args.db
    ? args.db as unknown as Prisma.TransactionClient
    : tenantScopedPrisma as unknown as Prisma.TransactionClient;

  const policy = await db.policy.findUnique({
    where: { id: args.policyId },
    include: { policyHolder: true, binder: { select: { umr: true } } },
  });
  if (!policy) throw new Error(`Policy not found for doc pack generation: ${args.policyId}`);

  const policyForPack: PolicyForDocPack = {
    id: policy.id,
    policyNumber: policy.policyNumber,
    certificateNumber: policy.certificateNumber,
    productType: policy.productType,
    inceptionDate: policy.inceptionDate,
    expiryDate: policy.expiryDate,
    umr: policy.umr,
    binderId: policy.binderId,
    binderUmr: policy.binder?.umr ?? null,
    policyHolder: policy.policyHolder
      ? {
        id: policy.policyHolder.id,
        name: policy.policyHolder.name,
        address: policy.policyHolder.address,
        contact: policy.policyHolder.contact,
      }
      : null,
  };

  const declaredProduct = String(policy.productType || '').toUpperCase();
  if (declaredProduct && declaredProduct !== config.productType.toUpperCase()) {
    throw new Error(
      `Doc pack productType mismatch: policy=${declaredProduct} but generator=${config.productType}`,
    );
  }

  const snapshot = args.riskTransactionId
    ? asRecord((await db.riskTransaction.findUnique({ where: { id: args.riskTransactionId } }))?.snapshotFinal)
    : asRecord((await db.policyStateCurrent.findUnique({ where: { policyId: policy.id } }))?.snapshot);

  const quoteData = asRecord(snapshot.quoteData) || asRecord(policy.quoteData);
  if (!Array.isArray(args.documentSources)) {
    throw new Error(`${config.productType} document generation requires an immutable programme document source mapping.`);
  }
  const sourceTypes = new Set<string>();
  const documentSources = args.documentSources.map((source, index) => {
    const documentType = typeof source?.documentType === 'string' ? source.documentType.trim() : '';
    const sourceId = typeof source?.sourceId === 'string' ? source.sourceId.trim() : '';
    const sourceVersion = typeof source?.sourceVersion === 'string' ? source.sourceVersion.trim() : '';
    if (!documentType || !sourceId || !sourceVersion || sourceTypes.has(documentType)) {
      throw new Error(`${config.productType} document generation received an invalid immutable document source mapping at index ${index}.`);
    }
    sourceTypes.add(documentType);
    return { documentType, sourceId, sourceVersion };
  });

  const ctx: DocPackContext = {
    policy: policyForPack,
    riskTransactionId: args.riskTransactionId || null,
    snapshot,
    quoteData,
    documentSources,
  };

  const versionScopeWhere = {
    policyId: policy.id,
    docPack: args.docPack,
    riskTransactionId: args.riskTransactionId || null,
  };
  const prevMax = await db.document.findFirst({
    where: versionScopeWhere,
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const activeVersion = await db.document.findFirst({
    where: { ...versionScopeWhere, status: 'GENERATED' },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const isIssuedPolicyPack = args.docPack === 'ISSUED_POLICY_PACK';
  const nextVersion = resolveDocPackVersion({
    docPack: args.docPack,
    latestVersion: prevMax?.version ?? null,
    activeVersion: activeVersion?.version ?? null,
  });

  // Issued-pack jobs are replayed by the paid-policy recovery spine. They
  // must fill only missing documents in the existing active pack; replacing
  // a complete pack on every replay created duplicate customer documents.
  if (!isIssuedPolicyPack) {
    await db.document.updateMany({
      where: { ...versionScopeWhere, status: 'GENERATED' },
      data: { status: 'SUPERSEDED' },
    });
  }

  const sharedViewModel = { ...config.buildViewModel(ctx), tenantBrand: await tenantDocumentBrand() };
  const selectedDocs = config.selectDocs(ctx, { docPack: args.docPack, nextVersion });
  for (const spec of selectedDocs) {
    const configured = documentSources.find((source) => source.documentType === spec.docType);
    if (!configured || configured.sourceId !== spec.sourceId || configured.sourceVersion !== spec.sourceVersion) {
      throw new Error(`${config.productType} document ${spec.docType} is not selected by the immutable programme document source mapping.`);
    }
  }
  const docs = args.docPack === 'ISSUED_POLICY_PACK'
    ? (() => {
      if (!Array.isArray(args.requiredIssuedDocTypes)) {
        throw new Error(`${config.productType} issued document generation requires published programme document selection.`);
      }
      const requiredTypes = new Set(args.requiredIssuedDocTypes);
      return selectedDocs.filter((spec) => requiredTypes.has(spec.docType));
    })()
    : selectedDocs;

  if (docs.length === 0) {
    logger.warn(
      { policyId: policy.id, productType: config.productType, docPack: args.docPack },
      'doc_pack.no_documents_selected',
    );
  }

  const productLabel = `${config.productType.charAt(0)}${config.productType.slice(1).toLowerCase()} insurance schedule`;
  // UMR is the binder's Unique Market Reference — never the policy number.
  const umr = String(policy.umr || policy.binder?.umr || '').trim();

  const created: Array<{
    id: string;
    type: string;
    storageUri: string;
    filename: string;
    fileHash: string | null;
    status: string;
    version: number;
    docPack: string | null;
    templateVersion: string | null;
    riskTransactionId: string | null;
  }> = [];

  for (const spec of docs) {
    const specTemplateVersion = spec.assetVersion ? `${templateVersion}:${spec.assetVersion}` : templateVersion;
    const existing = await db.document.findFirst({
      where: {
        policyId: policy.id,
        riskTransactionId: args.riskTransactionId || null,
        docPack: args.docPack,
        version: nextVersion,
        type: spec.docType,
        // A paid-policy recovery replay must retain the policy's issued
        // evidence, even if the product asset changes after issuance. The
        // active issued pack is canonical at document-type level; requiring
        // the newer asset version here would insert a second customer-visible
        // row for the same type and pack version.
        ...(!isIssuedPolicyPack ? { templateVersion: specTemplateVersion } : {}),
        status: 'GENERATED',
      },
    });
    if (existing) {
      created.push({
        id: existing.id,
        type: existing.type,
        storageUri: existing.storageUri,
        filename: existing.filename,
        fileHash: existing.fileHash,
        status: existing.status,
        version: existing.version,
        docPack: existing.docPack,
        templateVersion: existing.templateVersion,
        riskTransactionId: existing.riskTransactionId,
      });
      continue;
    }

    const buf = spec.mode === 'staticPdf'
      ? loadStaticPdf(spec.staticPdfPath)
      : await (async () => {
        const data = { ...sharedViewModel, ...(spec.viewModelOverrides || {}) };
        const html = compile(config.templatesDir, spec.template, data);
        return renderHtmlToPdf({
          html,
          headerTemplate: spec.headerTemplate ?? DEFAULT_HEADER,
          footerTemplate: spec.footerTemplate ?? defaultFooter(productLabel, umr),
          margin: spec.margin || { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' },
        });
      })();
    const hash = sha256(buf);

    const uploaded = await storageService.uploadFile(buf, spec.filename, 'application/pdf');

    const documentData: WithoutTenantScope<Prisma.DocumentUncheckedCreateInput> = {
      policyId: policy.id,
      riskTransactionId: args.riskTransactionId || null,
      type: spec.docType,
      docPack: args.docPack,
      version: nextVersion,
      status: 'GENERATED',
      templateVersion: specTemplateVersion,
      generatedByUserId: args.generatedByUserId || null,
      source: args.source,
      generatedAt: new Date(),
      storageUri: uploaded.url,
      filename: spec.filename,
      fileHash: hash,
    };
    const row = await db.document.create({
      data: documentData as Prisma.DocumentUncheckedCreateInput,
    });

    created.push({
      id: row.id,
      type: row.type,
      storageUri: row.storageUri,
      filename: row.filename,
      fileHash: row.fileHash,
      status: row.status,
      version: row.version,
      docPack: row.docPack,
      templateVersion: row.templateVersion,
      riskTransactionId: row.riskTransactionId,
    });
  }

  return { version: nextVersion, documents: created };
}
