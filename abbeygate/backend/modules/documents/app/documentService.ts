/**
 * Application-layer document service.
 *
 * Orchestrates document generation across the product adapters and the
 * background queue. Lives in `app/` (not `domain/`) because it touches
 * the database (`tenantScopedPrisma.policy.findUnique`) and the job queue — both
 * side-effects that the domain layer is forbidden from doing
 * (see `tools/quality/check-domain-purity.mjs` and `lint:layers`).
 *
 * Pure rendering logic (DocxAdapter, builders) stays under `domain/`.
 */
import { addJobAndWait } from './queueGateway.js';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';

type DocxRenderRequest = import('../domain/adapters/DocxAdapter.js').DocxRenderRequest;
type DocxAdapterModule = typeof import('../domain/adapters/DocxAdapter.js');
const docxAdapterModule: DocxAdapterModule = await import('../domain/adapters/DocxAdapter.js');

export type DocumentSource = 'CUSTOMER' | 'BO' | 'SYSTEM';

export type DocumentRequest = {
  policyId: string;
  riskTransactionId?: string | null;
  docPack: string;
  source: DocumentSource;
  generatedByUserId?: string | null;
  templateVersion?: string;
};

export type DocumentGenerationResult = {
  version: number;
  documents: Array<{
    id: string;
    type: string;
    storageUri: string;
    filename: string;
    fileHash?: string | null;
    status: string;
    version: number;
    docPack?: string | null;
    templateVersion?: string | null;
    riskTransactionId?: string | null;
  }>;
};

export class DocumentService {
  /**
   * Canonical document generation entrypoint for non-issued doc packs
   * (e.g. `ENDORSEMENT_PACK`, quote PDFs). Dispatches to the product
   * adapter resolved from the policy's productType.
   *
   * IMPORTANT — `docPack === 'ISSUED_POLICY_PACK'` is FORBIDDEN here.
   * The issued policy pack has exactly one orchestration entrypoint:
   * `enqueueIssuedPolicyPack` in
   * `backend/modules/policy/app/commands/issuedPackEnqueue.ts`, which
   * writes a `DOC.GENERATE_ISSUED_POLICY_PACK` outbox event inside
   * the issuance transaction. The worker handler is the sole
   * generator. See ADR-0013.
   */
  static async generate(
    req: DocumentRequest,
    opts?: { db?: unknown }
  ): Promise<DocumentGenerationResult> {
    if (String(req.docPack || '').trim().toUpperCase() === 'ISSUED_POLICY_PACK') {
      throw new Error(
        "DocumentService.generate() refuses docPack='ISSUED_POLICY_PACK'. Use enqueueIssuedPolicyPack(tx, args) — the canonical issuance spine (ADR-0013).",
      );
    }
    const isProd = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const modeRaw = String(process.env.DOC_GENERATION_MODE || '').trim().toLowerCase();
    if (isProd && modeRaw === 'local') {
      throw new Error('DOC_GENERATION_MODE=local is forbidden in production. Use queue mode with worker processing.');
    }
    const mode =
      modeRaw === 'local' ? 'local' :
        modeRaw === 'queue' ? 'queue' :
          (isProd ? 'queue' : 'local');

    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: req.policyId },
      select: { productType: true },
    });
    const productType = String(policy?.productType || '').toUpperCase();
    const adapter = productType ? ProductRegistry.getInstance().getAdapter(productType) : null;

    if (mode === 'queue') {
      if (opts?.db) {
        throw new Error('DOC_GENERATION_MODE=queue does not support opts.db transactions (run generation outside the DB transaction).');
      }
      const jobName = adapter?.getDocPackJobName() || 'DOC.GENERATE_MOTOR_DOC_PACK';
      const result = await addJobAndWait<DocumentGenerationResult>(jobName, {
        policyId: req.policyId,
        riskTransactionId: req.riskTransactionId || null,
        docPack: req.docPack,
        source: req.source,
        generatedByUserId: req.generatedByUserId || null,
        // Omit rather than coerce to null: worker schemas treat
        // `templateVersion` as an optional string (z.string().nullish()).
        // `|| null` made QUOTE_PACK jobs fail Zod with
        // "expected string, received null" (ABY-444).
        ...(req.templateVersion ? { templateVersion: req.templateVersion } : {}),
      });
      return result;
    }

    if (!adapter) {
      throw new Error(`No product adapter for type '${productType}'; cannot generate documents locally`);
    }
    const r = await adapter.generateDocPack({
      ...req,
      db: opts?.db || undefined,
    });
    return r as DocumentGenerationResult;
  }

  static async generateDocx(req: DocxRenderRequest, opts?: { db?: unknown }) {
    const db = (opts?.db ?? prisma) as Parameters<typeof docxAdapterModule.DocxAdapter.renderDocx>[1];
    return await docxAdapterModule.DocxAdapter.renderDocx(req, db);
  }
}
