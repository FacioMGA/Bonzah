import crypto from 'crypto';
import fs from 'fs';
import Handlebars from 'handlebars';
import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { storageService } from '../../../platform/storage/service.js';
import { loadTemplate, renderHtmlToPdf } from '../../../modules/documents/app/pdfRenderer.js';
import path from 'path';
import { reserveNextGreenCardSerial } from '../../../platform/utils/platformIds.js';
import { normalizeProductKit } from '../../../modules/programs/domain/productKit/productKit.js';
import { buildMotorDocViewModel } from './viewModel.js';
import { resolveEffectiveCoverageContract } from '../../../modules/policy/app/coverageSelectionContract.js';
import { latestTermOrderBy } from '../../../modules/policy/app/policyTermFamily.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { MOTOR_DOCUMENT_PACK_CONTRACT } from './documentPackContract.js';
import type {
  ProductStaticPdfDocumentEntry,
  ProductTemplateDocumentEntry,
} from '../../shared/documents/productDocumentPackContract.js';
import { resolveMotorPolicyWording } from './policyWording.js';

export type MotorDocPack = 'QUOTE_PACK' | 'DRAFT_POLICY_PACK' | 'ISSUED_POLICY_PACK' | 'ENDORSEMENT_PACK';

type GenerateArgs = {
  policyId: string;
  riskTransactionId?: string | null;
  docPack: MotorDocPack;
  source: 'CUSTOMER' | 'BO' | 'SYSTEM';
  generatedByUserId?: string | null;
  templateVersion?: string;
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
const MOTOR_GREEN_CARD_DOC = motorContractEntry('MOTOR_GREEN_CARD_PDF');
const MOTOR_SCHEDULE_DOC = motorContractEntry('MOTOR_SCHEDULE_PDF');
const MOTOR_STATEMENT_OF_FACT_DOC = motorContractEntry('MOTOR_STATEMENT_OF_FACT_PDF');
const MOTOR_ENDORSEMENT_DOC = motorContractEntry('MOTOR_ENDORSEMENT_SCHEDULE_PDF');
const MOTOR_POLICY_WORDING_DOC = motorStaticContractEntry('MOTOR_POLICY_WORDING_PDF');

export async function executeMotorDocPackGeneration(args: GenerateArgs) {
  const templateVersion = args.templateVersion || 'abbeygate:premium:v1';
  const db = args.db || tenantScopedPrisma;

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

  // Ensure we have an immutable Green Card serial for issued packs (global sequence).
  // This must be stable across regenerations.
  let greenCardSerial: string | null = policy.greenCardSerial || null;
  if (!greenCardSerial && args.docPack === 'ISSUED_POLICY_PACK') {
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
      // best-effort; templates will fall back to placeholder if missing
      greenCardSerial = null;
    }
  }

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
  // Program-driven MBE (MagicB Endorsements) product configuration.
  // This powers the schedule sections: Coverages / Excesses / Extensions / Conditions / Extras.
  let mbeProductConfig: unknown = undefined;
  let productKit: unknown = undefined;
  let resolvedProgram: { id?: string | null; productType?: string | null; metadata?: unknown } | null = null;
  try {
    resolvedProgram =
      policy?.programId
        ? await db.program.findUnique({ where: { id: policy.programId } })
        : await db.program.findFirst({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } });
    const metadata = asRecord(resolvedProgram?.metadata);
    mbeProductConfig = metadata.mbeProductConfig;
    productKit = metadata.productKit;
  } catch {
    // best-effort
  }
  const kit = normalizeProductKit(productKit);
  const brand = kit.brand;
  const tenantConfig = getTenantConfig();
  const jurisdictionConfig = resolveJurisdictionProductConfig({
    productCode: 'MOTOR',
    program: resolvedProgram,
    binder: policy.binder,
    tenant: tenantConfig,
  });
  const {
    normalizeProgramMbeProductConfig,
    buildMagicBSectionsForSchedule
  } = await import('../../../modules/mbe/domain/programProduct.js');
  const normalizedMbeCfg = normalizeProgramMbeProductConfig(mbeProductConfig);
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

  const data = buildMotorDocViewModel({
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
  });

  // Header/Footer Templates for Puppeteer
  const globalHeader = `
    <div style="font-family: Inter, sans-serif; font-size: 10px; color: #64748B; width: 100%; padding: 0 6mm; display: flex; justify-content: flex-end; align-items: center; height: 100%;">
        <!-- Optionally put Logo here if needed on every page -->
    </div>`;

  const globalFooter = `
    <div style="font-family: Inter, sans-serif; font-size: 10px; color: #64748B; width: 100%; padding: 0 6mm; display: flex; justify-content: space-between; border-top: 1px solid #E2E8F0; padding-top: 8px;">
        <span style="font-weight: 600;">${safeStr(brand.coverholderStatement) || `${jurisdictionConfig.countryName} authorised Lloyd’s Coverholder.`}</span>
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
  const nextVersion = (prevMax?.version || 0) + 1;

  // Supersede previous
  await db.document.updateMany({
    where: { ...versionScopeWhere, status: 'GENERATED' },
    data: { status: 'SUPERSEDED' },
  });

  if (args.docPack === 'QUOTE_PACK') {
    // Quote pack: certificate-style quote PDF (non-binding, draft-marked).
    docsToRender.push({
      docType: 'MOTOR_QUOTE_PDF',
      filename: `Your Motor Insurance Quote - ${data.policy_number} (v${nextVersion}).pdf`,
        assetVersion: 'motor-quote:v1',
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

      const policyWording = resolveMotorPolicyWording(jurisdictionConfig.countryCode);
      docsToRender.push({
        docType: MOTOR_POLICY_WORDING_DOC.docType,
        filename: policyWording.filename,
        assetVersion: policyWording.assetVersion,
        render: () => fs.promises.readFile(policyWording.staticPdfPath),
      });
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
        templateVersion: itemTemplateVersion,
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
