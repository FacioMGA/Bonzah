import crypto from 'crypto';
import fs from 'fs';
import Handlebars from 'handlebars';
import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { storageService } from '../../../platform/storage/service.js';
import { loadTemplate, renderHtmlToPdf } from '../../../modules/documents/app/pdfRenderer.js';
import path from 'path';
import { reserveNextGreenCardSerial } from '../../../platform/utils/platformIds.js';
import { parsePublishedMotorProductKitForSources } from '../../../modules/programs/domain/productKit/productKit.js';
import { parsePublishedProgrammeDocumentSelection } from '../../../modules/programs/app/programRuntimeDefinitions.js';
import { resolveMappedProgramDefinition } from '../../../modules/programs/app/activeProgramDefinition.js';
import { buildMotorDocViewModel } from './viewModel.js';
import { resolveEffectiveCoverageContract } from '../../../modules/policy/domain/coverageSelectionContract.js';
import { latestTermOrderBy } from '../../../modules/policy/app/policyTermFamily.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { MOTOR_DOCUMENT_PACK_CONTRACT } from './documentPackContract.js';
import type {
  ProductStaticPdfDocumentEntry,
  ProductTemplateDocumentEntry,
} from '../../shared/documents/productDocumentPackContract.js';
import { resolveMotorPolicyWording } from './policyWording.js';
import { tenantDocumentBrand } from '../../shared/documents/tenantDocumentBrand.js';
import { resolveDocPackVersion } from '../../shared/documents/docPackVersion.js';

export type MotorDocPack = 'QUOTE_PACK' | 'DRAFT_POLICY_PACK' | 'ISSUED_POLICY_PACK' | 'ENDORSEMENT_PACK';

type GenerateArgs = {
  policyId: string;
  riskTransactionId?: string | null;
  docPack: MotorDocPack;
  source: 'CUSTOMER' | 'BO' | 'SYSTEM';
  generatedByUserId?: string | null;
  templateVersion?: string;
  requiredIssuedDocTypes?: string[];
  documentSources?: Array<{ documentType: string; sourceId: string; sourceVersion: string }>;
  db?: Prisma.TransactionClient | typeof prisma;
};

type RootTransactionClient = {
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};

function hasRootTransactionClient(db: unknown): db is RootTransactionClient {
  return typeof (db as { $transaction?: unknown }).$transaction === 'function';
}

function sha256(buf: Buffer) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeStr(v: unknown) {
  return String(v ?? '').trim();
}

// Note: formatting utilities live in `viewModel.ts` for shared reuse.

// Compile Template Helper
function compile(templateName: string, data: Record<string, unknown>) {
  const html = loadTemplate(templateName);
  const t = Handlebars.compile(html);
  return t(data);
}

// Absolute path to assets for Puppeteer to load local images
const ASSETS_PATH = path.join(process.cwd(), './templates');

function motorContractEntry(docType: string): ProductTemplateDocumentEntry {
  const entry = MOTOR_DOCUMENT_PACK_CONTRACT.entries.find((item) => item.docType === docType);
  if (!entry || entry.mode !== 'template') {
    throw new Error(`MOTOR document pack contract missing generated template entry for ${docType}`);
  }
  return entry;
}

function motorStaticContractEntry(docType: string): ProductStaticPdfDocumentEntry {
  const entry = MOTOR_DOCUMENT_PACK_CONTRACT.entries.find((item) => item.docType === docType);
  if (!entry || entry.mode !== 'staticPdf') {
    throw new Error(`MOTOR document pack contract missing static PDF entry for ${docType}`);
  }
  return entry;
}

const MOTOR_CERTIFICATE_DOC = motorContractEntry('MOTOR_CERTIFICATE_PDF');
const MOTOR_QUOTE_DOC = motorContractEntry('MOTOR_QUOTE_PDF');
const MOTOR_GREEN_CARD_DOC = motorContractEntry('MOTOR_GREEN_CARD_PDF');
const MOTOR_SCHEDULE_DOC = motorContractEntry('MOTOR_SCHEDULE_PDF');
const MOTOR_STATEMENT_OF_FACT_DOC = motorContractEntry('MOTOR_STATEMENT_OF_FACT_PDF');
const MOTOR_ENDORSEMENT_DOC = motorContractEntry('MOTOR_ENDORSEMENT_SCHEDULE_PDF');
const MOTOR_POLICY_WORDING_DOC = motorStaticContractEntry('MOTOR_POLICY_WORDING_PDF');

export async function executeMotorDocPackGeneration(args: GenerateArgs) {
  const templateVersion = args.templateVersion || 'mga:premium:v1';
  // Both the root Prisma client and the tenant-scoped client implement the
  // transaction delegate surface used by this generator. Keep that union at
  // the boundary; Prisma's extension overloads otherwise make every delegate
  // call an uncallable union.
  const db: Prisma.TransactionClient = args.db ? args.db as unknown as Prisma.TransactionClient : tenantScopedPrisma as unknown as Prisma.TransactionClient;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.policyId);
  const policy = isUuid
    ? await db.policy.findUnique({
      where: { id: args.policyId },
      include: { policyHolder: true, binder: true },
    })
    : await db.policy.findFirst({
      where: { policyNumber: args.policyId },
      orderBy: latestTermOrderBy(),
      include: { policyHolder: true, binder: true },
    });
  if (!policy) throw new Error('Policy not found');

  const policyId = policy.id;

  // [MBE] Fetch Active Endorsements
  const activeEndorsements = await db.endorsementInstance.findMany({
    where: { policyId, status: { in: ['APPLIED', 'PENDING'] } },
    include: { template: true }
  });

  const snapshot =
    args.riskTransactionId
      ? (await db.riskTransaction.findUnique({ where: { id: args.riskTransactionId } }))?.snapshotFinal
      : (await db.policyStateCurrent.findUnique({ where: { policyId: policyId } }))?.snapshot;

  const snap = asRecord(snapshot);
  const qd = asRecord(snap.quoteData);
  const snapshotDefinition = asRecord(snap.programDefinition);
  if (!Object.keys(snapshotDefinition).length) {
    throw new Error('Motor document generation requires an immutable programme definition in the policy decision snapshot.');
  }
  if (safeStr(snapshotDefinition.programId) !== safeStr(policy.programId)) {
    throw new Error('Motor document generation snapshot programme does not match the policy programme.');
  }
  const snapshotDocuments = asRecord(snapshotDefinition.documents);
  if (!Object.keys(snapshotDocuments).length) {
    throw new Error('Motor document generation requires immutable programme document components.');
  }
  const snapshotDocumentSelection = parsePublishedProgrammeDocumentSelection('MOTOR', snapshotDocuments);
  if (!Array.isArray(args.requiredIssuedDocTypes) || !Array.isArray(args.documentSources)) {
    throw new Error('Motor document generation requires immutable programme document selection.');
  }
  const suppliedRequiredTypes = new Set(args.requiredIssuedDocTypes);
  if (
    suppliedRequiredTypes.size !== args.requiredIssuedDocTypes.length
    || suppliedRequiredTypes.size !== snapshotDocumentSelection.requiredIssuedDocTypes.length
    || snapshotDocumentSelection.requiredIssuedDocTypes.some((type) => !suppliedRequiredTypes.has(type))
  ) {
    throw new Error('Motor document generation received a document selection that differs from the policy decision snapshot.');
  }
  const suppliedSources = new Map<string, string>();
  for (const source of args.documentSources) {
    const documentType = safeStr(source.documentType);
    const sourceId = safeStr(source.sourceId);
    const sourceVersion = safeStr(source.sourceVersion);
    if (!documentType || !sourceId || !sourceVersion || suppliedSources.has(documentType)) {
      throw new Error('Motor document generation received an invalid immutable document source mapping.');
    }
    suppliedSources.set(documentType, `${sourceId}:${sourceVersion}`);
  }
  if (
    suppliedSources.size !== snapshotDocumentSelection.sources.length
    || snapshotDocumentSelection.sources.some((source) => suppliedSources.get(source.documentType) !== `${source.sourceId}:${source.sourceVersion}`)
  ) {
    throw new Error('Motor document generation source mapping differs from the policy decision snapshot.');
  }
  // Program-driven MBE (MagicB Endorsements) product configuration.
  // This powers the schedule sections: Coverages / Excesses / Extensions / Conditions / Extras.
  const resolvedProgram = policy.programId
    ? await db.program.findUnique({ where: { id: policy.programId }, select: { id: true, productType: true } })
    : null;
  if (!resolvedProgram || !policy.binderId) throw new Error('Motor document generation requires a policy programme and binder.');
  const authority = await db.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId: policy.binderId, productCode: 'MOTOR' } },
    select: { id: true },
  });
  if (!authority) throw new Error('Motor document generation requires an active binder product authority.');
  const programDefinition = await resolveMappedProgramDefinition({
    programId: resolvedProgram.id,
    binderProductAuthorityId: authority.id,
  });
  if (!programDefinition.ratingModel) throw new Error('Motor document generation requires an automated programme definition.');
  const requiredIssuedDocTypes = snapshotDocumentSelection.requiredIssuedDocTypes;
  // Ensure we have an immutable Green Card serial for issued packs (global sequence).
  // This must be stable across regenerations.
  let greenCardSerial: string | null = policy.greenCardSerial || null;
  if (!greenCardSerial && args.docPack === 'ISSUED_POLICY_PACK' && snapshotDocumentSelection.requiredIssuedDocTypes.includes('MOTOR_GREEN_CARD_PDF')) {
    try {
      if (hasRootTransactionClient(db)) {
        const rootDb = db as { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
        greenCardSerial = await rootDb.$transaction(async (tx) => {
          const serialTx = tx as Parameters<typeof reserveNextGreenCardSerial>[0];
          const existing = await serialTx.policy.findUnique({ where: { id: policyId }, select: { greenCardSerial: true } });
          if (existing?.greenCardSerial) return String(existing.greenCardSerial);
          const serial = await reserveNextGreenCardSerial(serialTx);
          await serialTx.policy.update({ where: { id: policyId }, data: { greenCardSerial: serial } });
          return serial;
        });
      } else {
        const existing = await db.policy.findUnique({ where: { id: policyId }, select: { greenCardSerial: true } });
        if (existing?.greenCardSerial) {
          greenCardSerial = String(existing.greenCardSerial);
        } else {
          const serial = await reserveNextGreenCardSerial(db as Parameters<typeof reserveNextGreenCardSerial>[0]);
          await db.policy.update({ where: { id: policyId }, data: { greenCardSerial: serial } });
          greenCardSerial = serial;
        }
      }
    } catch {
      throw new Error('Selected Green Card requires a durable serial; generation cannot continue.');
    }
  }

  const kit = parsePublishedMotorProductKitForSources(snapshotDocuments.productKit, snapshotDocumentSelection.sources.map(source => source.documentType));
  const brand = kit.brand;
  const tenantConfig = getTenantConfig();
  const jurisdictionConfig = resolveJurisdictionProductConfig({
    productCode: 'MOTOR',
    program: resolvedProgram,
    binder: policy.binder,
    tenant: tenantConfig,
  });
  const {
    parsePublishedProgramMbeProductConfig,
    buildMagicBSectionsForSchedule
  } = await import('../../../modules/mbe/domain/programProduct.js');
  const normalizedMbeCfg = parsePublishedProgramMbeProductConfig(programDefinition.coverage, { productType: 'MOTOR' });
  const baseApplied = resolveEffectiveCoverageContract({
    productType: 'MOTOR',
    quoteData: qd,
    cfg: normalizedMbeCfg,
    storedSelection: snap.coverageSelection,
    programId: String(policy.programId || ''),
    source: 'DOC_PACK',
  }).resolvedCoverageSet.applied;

  // Combine base (program) templates with explicit applied endorsements (policy-level instances)
  const combinedApplied = (() => {
    const out = new Map<string, Record<string, unknown>>();
    // Start with program/selection-derived applied set
    (baseApplied || []).forEach((x) => out.set(String(x.code), asRecord(x.params)));
    // Overlay explicit policy endorsement instances (policy-level params win)
    activeEndorsements.forEach((e) => out.set(String(e.code), asRecord(e.params)));
    return Array.from(out.entries()).map(([code, params]) => ({ code, params }));
  })();

  const mbeSections = buildMagicBSectionsForSchedule({ quoteData: qd, applied: combinedApplied });

  const data: ReturnType<typeof buildMotorDocViewModel> = { ...buildMotorDocViewModel({
    policy,
    snap,
    activeEndorsements,
    appliedEndorsements: combinedApplied,
    mbeSections,
    normalizedMbeCfg,
    greenCardSerial,
    brand,
    assetsBasePath: `file://${ASSETS_PATH}/`,
    jurisdictionConfig,
  }), tenantBrand: await tenantDocumentBrand() };

  // Header/Footer Templates for Puppeteer
  const globalHeader = `
    <div style="font-family: Inter, sans-serif; font-size: 10px; color: #64748B; width: 100%; padding: 0 6mm; display: flex; justify-content: flex-end; align-items: center; height: 100%;">
        <!-- Optionally put Logo here if needed on every page -->
    </div>`;

  const globalFooter = `
    <div style="font-family: Inter, sans-serif; font-size: 10px; color: #64748B; width: 100%; padding: 0 6mm; display: flex; justify-content: space-between; border-top: 1px solid #E2E8F0; padding-top: 8px;">
        <span style="font-weight: 600;">${safeStr(brand.coverholderStatement)}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span> | UMR: ${data.umr}</span>
    </div>`;

  // ---------------------------------------------------------------------------
  // GENERATION LOOP
  // ---------------------------------------------------------------------------

  const docsToRender: Array<{
    docType: string;
    filename: string;
    assetVersion?: string;
    render: () => Promise<Buffer>;
  }> = [];

  // Versioning Scope
  const versionScopeWhere = {
    policyId: policyId,
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

  // Paid-policy recovery replays the issued-pack event. Keep its active
  // version intact so a retry fills missing files instead of making a second
  // customer-visible document pack.
  if (!isIssuedPolicyPack) {
    await db.document.updateMany({
      where: { ...versionScopeWhere, status: 'GENERATED' },
      data: { status: 'SUPERSEDED' },
    });
  }

  if (args.docPack === 'QUOTE_PACK') {
    // Quote pack: certificate-style quote PDF (non-binding, draft-marked).
      docsToRender.push({
      docType: MOTOR_QUOTE_DOC.docType,
        filename: `Your Motor Insurance Quote - ${data.policy_number} (v${nextVersion}).pdf`,
        assetVersion: MOTOR_QUOTE_DOC.assetVersion,
      render: () => renderHtmlToPdf({
        html: compile('certificate.html', { ...data, isQuote: true, isDraft: true }),
        headerTemplate: '<div></div>',
        footerTemplate: '<div></div>',
        margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
      })
    });
  }

  if (args.docPack === 'DRAFT_POLICY_PACK' || args.docPack === 'ISSUED_POLICY_PACK' || args.docPack === 'ENDORSEMENT_PACK') {
    if (args.docPack === 'DRAFT_POLICY_PACK') {
      // Draft pack: same structure as issued pack, but clearly watermarked and NOT legally final.
      const draftData: Record<string, unknown> = { ...data, isDraft: true };
      const draftPolicyNumber = safeStr(draftData.policy_number);
      const draftCertificateNumber = safeStr(draftData.certificate_number);
      docsToRender.push({
        docType: MOTOR_CERTIFICATE_DOC.docType,
        filename: `DRAFT_Certificate_Motor_Policy${draftCertificateNumber}-${draftPolicyNumber}.pdf`,
        assetVersion: MOTOR_CERTIFICATE_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_CERTIFICATE_DOC.template, draftData),
          headerTemplate: '<div></div>',
          footerTemplate: '<div></div>',
          // Certificate is a 1-page statutory form: keep the frame close to the edge.
          margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
        })
      });

      docsToRender.push({
        docType: MOTOR_GREEN_CARD_DOC.docType,
        filename: `DRAFT_Green_Card_Motor_Policy${draftCertificateNumber}-${draftPolicyNumber}.pdf`,
        assetVersion: MOTOR_GREEN_CARD_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_GREEN_CARD_DOC.template, draftData),
          headerTemplate: '<div></div>',
          footerTemplate: '<div></div>',
          margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
        })
      });

      docsToRender.push({
        docType: MOTOR_SCHEDULE_DOC.docType,
        filename: `DRAFT_Schedule_of_Insurance_Motor-${draftPolicyNumber}.pdf`,
        assetVersion: MOTOR_SCHEDULE_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_SCHEDULE_DOC.template, draftData),
          headerTemplate: globalHeader,
          footerTemplate: globalFooter,
          margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
        })
      });

      docsToRender.push({
        docType: MOTOR_STATEMENT_OF_FACT_DOC.docType,
        filename: `DRAFT_Statement_of_Fact_Motor_Policy${draftCertificateNumber}-${draftPolicyNumber}.pdf`,
        assetVersion: MOTOR_STATEMENT_OF_FACT_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_STATEMENT_OF_FACT_DOC.template, draftData),
          headerTemplate: globalHeader,
          footerTemplate: globalFooter,
          margin: { left: '6mm', right: '6mm' },
        })
      });
    } else if (args.docPack === 'ISSUED_POLICY_PACK') {
      // Issued pack: four client-specific generated documents plus the
      // approved policy wording for the operating jurisdiction.
      docsToRender.push({
        docType: MOTOR_CERTIFICATE_DOC.docType,
        filename: `Certificate_Motor_Policy${data.certificate_number}-${data.policy_number}.pdf`,
        assetVersion: MOTOR_CERTIFICATE_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_CERTIFICATE_DOC.template, data),
          headerTemplate: '<div></div>',
          footerTemplate: '<div></div>',
          // Certificate is a 1-page statutory form: keep the frame close to the edge.
          margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
        })
      });

      docsToRender.push({
        docType: MOTOR_GREEN_CARD_DOC.docType,
        filename: `Green_Card_Motor_Policy${data.certificate_number}-${data.policy_number}.pdf`,
        assetVersion: MOTOR_GREEN_CARD_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_GREEN_CARD_DOC.template, data),
          headerTemplate: '<div></div>',
          footerTemplate: '<div></div>',
          margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
        })
      });

      docsToRender.push({
        docType: MOTOR_SCHEDULE_DOC.docType,
        filename: `Schedule_of_Insurance_Motor-${data.policy_number}.pdf`,
        assetVersion: MOTOR_SCHEDULE_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_SCHEDULE_DOC.template, data),
          headerTemplate: globalHeader,
          footerTemplate: globalFooter,
          margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
        })
      });

      docsToRender.push({
        docType: MOTOR_STATEMENT_OF_FACT_DOC.docType,
        filename: `Statement_of_Fact_Motor_Policy${data.certificate_number}-${data.policy_number}.pdf`,
        assetVersion: MOTOR_STATEMENT_OF_FACT_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_STATEMENT_OF_FACT_DOC.template, data),
          headerTemplate: globalHeader,
          footerTemplate: globalFooter,
          margin: { left: '6mm', right: '6mm' },
        })
      });

      if (suppliedSources.has(MOTOR_POLICY_WORDING_DOC.docType)) {
      const policyWording = resolveMotorPolicyWording(jurisdictionConfig.countryCode);
      docsToRender.push({
        docType: MOTOR_POLICY_WORDING_DOC.docType,
        filename: policyWording.filename,
        assetVersion: policyWording.assetVersion,
        render: () => fs.promises.readFile(policyWording.staticPdfPath),
      });
      }
    } else {
      // Endorsement packs remain separate for now.
      docsToRender.push({
        docType: MOTOR_SCHEDULE_DOC.docType,
        filename: `Schedule of Insurance - ${data.policy_number} (v${nextVersion}).pdf`,
        assetVersion: MOTOR_SCHEDULE_DOC.assetVersion,
        render: () => renderHtmlToPdf({
          html: compile(MOTOR_SCHEDULE_DOC.template, data),
          headerTemplate: globalHeader,
          footerTemplate: globalFooter,
          margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
        })
      });
      if (Array.isArray(data?.endorsements) && data.endorsements.length > 0) {
        docsToRender.push({
          docType: MOTOR_ENDORSEMENT_DOC.docType,
          filename: `Endorsements - ${data.policy_number} (v${nextVersion}).pdf`,
          assetVersion: MOTOR_ENDORSEMENT_DOC.assetVersion,
          render: () => renderHtmlToPdf({
            html: compile(MOTOR_ENDORSEMENT_DOC.template, data),
            headerTemplate: globalHeader,
            footerTemplate: globalFooter,
            margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
          })
        });
      }
    }
  }

  // The immutable source selection also bounds draft, quote and endorsement packs.
  for (let index = docsToRender.length - 1; index >= 0; index -= 1) if (!suppliedSources.has(docsToRender[index]!.docType)) docsToRender.splice(index, 1);
  if (args.docPack === 'ISSUED_POLICY_PACK') {
    const requiredTypes = new Set(requiredIssuedDocTypes);
    for (let index = docsToRender.length - 1; index >= 0; index -= 1) {
      if (!requiredTypes.has(docsToRender[index].docType)) docsToRender.splice(index, 1);
    }
  }

  for (const item of docsToRender) {
    const contractEntry = MOTOR_DOCUMENT_PACK_CONTRACT.entries.find((entry) => entry.docType === item.docType);
    if (!contractEntry || suppliedSources.get(item.docType) !== `${contractEntry.sourceId}:${contractEntry.sourceVersion}`) {
      throw new Error(`Motor document ${item.docType} is not selected by the immutable programme document source mapping.`);
    }
  }

  const created: unknown[] = [];

  for (const item of docsToRender) {
    const itemTemplateVersion = item.assetVersion ? `${templateVersion}:${item.assetVersion}` : templateVersion;
    const existing = await db.document.findFirst({
      where: {
        policyId: policyId,
        riskTransactionId: args.riskTransactionId || null,
        docPack: args.docPack,
        version: nextVersion,
        type: item.docType,
        // Replays complete the original issued pack. A later product asset
        // version must not create a duplicate customer-visible document of
        // the same type within that issued-pack version.
        ...(!isIssuedPolicyPack ? { templateVersion: itemTemplateVersion } : {}),
        status: 'GENERATED',
      },
    });

    if (existing) {
      created.push(existing);
      continue;
    }

    const buf = await item.render();
    const hash = sha256(buf);

    const uploaded = await storageService.uploadFile(buf, item.filename, 'application/pdf');

    const docRow = await db.document.create({
      data: {
        policyId: policyId,
        riskTransactionId: args.riskTransactionId || null,
        type: item.docType,
        docPack: args.docPack,
        version: nextVersion,
        status: 'GENERATED',
        templateVersion: itemTemplateVersion,
        generatedByUserId: args.generatedByUserId || null,
        source: args.source,
        generatedAt: new Date(),
        storageUri: uploaded.url,
        filename: item.filename,
        fileHash: hash,
      } as unknown as Prisma.DocumentUncheckedCreateInput,
    });

    created.push(docRow);
  }

  return { version: nextVersion, documents: created };
}
