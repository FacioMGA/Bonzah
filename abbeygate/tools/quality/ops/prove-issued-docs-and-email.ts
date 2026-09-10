#!/usr/bin/env tsx
import type { Prisma } from '@prisma/client';
import { Job } from 'bullmq';

type RuntimeDeps = {
  registerAllProducts: () => void;
  ProductRegistry: {
    getInstance: () => {
      getAllAdapters: () => ProductAdapter[];
    };
  };
  prisma: {
    $disconnect: () => Promise<void>;
    tenant: {
      findUnique: (args: unknown) => Promise<{ id: string } | null>;
      create: (args: unknown) => Promise<unknown>;
    };
    communicationThread: {
      deleteMany: (args: unknown) => Promise<unknown>;
    };
    communicationMessage: {
      findFirst: (args: unknown) => Promise<{ id: string; status?: string } | null>;
      findUnique: (args: unknown) => Promise<{ id: string; status?: string } | null>;
    };
    programBinderLink: {
      create: (args: unknown) => Promise<unknown>;
      deleteMany: (args: unknown) => Promise<unknown>;
    };
  };
  tenantScopedPrisma: {
    program: { create: (args: unknown) => Promise<{ id: string }>; delete: (args: unknown) => Promise<unknown> };
    binder: { create: (args: unknown) => Promise<{ id: string; umr: string }>; delete: (args: unknown) => Promise<unknown> };
    policyHolder: { create: (args: unknown) => Promise<{ id: string }>; delete: (args: unknown) => Promise<unknown> };
    policy: { create: (args: unknown) => Promise<{ id: string }>; delete: (args: unknown) => Promise<unknown> };
    riskTransaction: { create: (args: unknown) => Promise<{ id: string }> };
    policyStateCurrent: {
      create: (args: unknown) => Promise<unknown>;
      findUnique: (args: unknown) => Promise<{ snapshot?: unknown } | null>;
    };
    document: { findMany: (args: unknown) => Promise<Array<{ type?: string; storageUri?: string | null; filename?: string | null }>> };
  };
  runWithOperatingTenant: <T>(tenantConfig: unknown, fn: () => Promise<T>) => Promise<T>;
  buildTenantConfigFromEnv: () => {
    id: string;
    tenantSlug: string;
    countryCode: string;
    country: string;
    currency: string;
    ipt: unknown;
    adminFee: number;
    legalPack: string;
    publicBaseUrl: string;
    fromEmail: string;
    brandLogo: unknown;
  };
  runIssuedPackJob: (job: { eventType: string; data: Record<string, unknown> }) => Promise<void>;
  handleCommunicationOutbound: (job: Job | unknown) => Promise<void>;
  sendTimelineMessageEmail: (args: { toEmail: string; subject: string; message: string }) => Promise<boolean>;
  markSyntheticEmailCleanup: (args: {
    correlationId: string;
    status: 'DONE' | 'FAILED';
    detail?: string | null;
  }) => Promise<void>;
};

type ProductAdapter = {
  productType: string;
  displayName: string;
  getGoldenFixtures: () => {
    minimumIssuable?: Record<string, unknown>;
    minimumValid: Record<string, unknown>;
  };
  buildQuoteResponse: (
    quoteData: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<{ quoteResponse: unknown }>;
  getRequiredIssuedDocTypes: () => string[];
};

async function importFirst<T>(specifiers: string[]): Promise<T> {
  const errors: unknown[] = [];
  for (const specifier of specifiers) {
    try {
      return await import(specifier) as T;
    } catch (error) {
      errors.push(error);
      const code = String((error as { code?: string })?.code || '');
      if (code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  throw new AggregateError(errors, `Unable to load module from candidates: ${specifiers.join(', ')}`);
}

async function loadRuntimeDeps(): Promise<RuntimeDeps> {
  const productsModule = await importFirst<{ registerAllProducts: () => void }>([
    '../../../backend/products/registerProducts.js',
    '../../../backend/dist/products/registerProducts.js',
  ]);
  const registryModule = await importFirst<{ ProductRegistry: RuntimeDeps['ProductRegistry'] }>([
    '../../../backend/modules/policy/domain/ProductRegistry.js',
    '../../../backend/dist/modules/policy/domain/ProductRegistry.js',
  ]);
  const dbModule = await importFirst<{ prisma: RuntimeDeps['prisma']; tenantScopedPrisma: RuntimeDeps['tenantScopedPrisma'] }>([
    '../../../backend/platform/db/connection.js',
    '../../../backend/dist/platform/db/connection.js',
  ]);
  const tenantAlsModule = await importFirst<{ runWithOperatingTenant: RuntimeDeps['runWithOperatingTenant'] }>([
    '../../../backend/platform/tenant/tenantAls.js',
    '../../../backend/dist/platform/tenant/tenantAls.js',
  ]);
  const tenantConfigModule = await importFirst<{ buildTenantConfigFromEnv: RuntimeDeps['buildTenantConfigFromEnv'] }>([
    '../../../backend/platform/tenant/tenantConfigForCli.js',
    '../../../backend/dist/platform/tenant/tenantConfigForCli.js',
  ]);
  const docHandlerModule = await importFirst<{ runIssuedPackJob: RuntimeDeps['runIssuedPackJob'] }>([
    '../../../backend/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.js',
    '../../../backend/dist/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.js',
  ]);
  const commHandlerModule = await importFirst<{ handleCommunicationOutbound: RuntimeDeps['handleCommunicationOutbound'] }>([
    '../../../backend/workers/handlers/COMMUNICATION_OUTBOUND.js',
    '../../../backend/dist/workers/handlers/COMMUNICATION_OUTBOUND.js',
  ]);
  const emailModule = await importFirst<{ sendTimelineMessageEmail: RuntimeDeps['sendTimelineMessageEmail'] }>([
    '../../../backend/modules/communications/domain/notifications/email.js',
    '../../../backend/dist/modules/communications/domain/notifications/email.js',
  ]);
  const syntheticAuditModule = await importFirst<{ markSyntheticEmailCleanup: RuntimeDeps['markSyntheticEmailCleanup'] }>([
    '../../../backend/modules/communications/app/syntheticEmailAudit.js',
    '../../../backend/dist/modules/communications/app/syntheticEmailAudit.js',
  ]);
  return {
    registerAllProducts: productsModule.registerAllProducts,
    ProductRegistry: registryModule.ProductRegistry,
    prisma: dbModule.prisma,
    tenantScopedPrisma: dbModule.tenantScopedPrisma,
    runWithOperatingTenant: tenantAlsModule.runWithOperatingTenant,
    buildTenantConfigFromEnv: tenantConfigModule.buildTenantConfigFromEnv,
    runIssuedPackJob: docHandlerModule.runIssuedPackJob,
    handleCommunicationOutbound: commHandlerModule.handleCommunicationOutbound,
    sendTimelineMessageEmail: emailModule.sendTimelineMessageEmail,
    markSyntheticEmailCleanup: syntheticAuditModule.markSyntheticEmailCleanup,
  };
}

const {
  registerAllProducts,
  ProductRegistry,
  prisma,
  tenantScopedPrisma,
  runWithOperatingTenant,
  buildTenantConfigFromEnv,
  runIssuedPackJob,
  handleCommunicationOutbound,
  sendTimelineMessageEmail,
  markSyntheticEmailCleanup,
} = await loadRuntimeDeps();

type ProofResult = {
  productType: string;
  policyId: string;
  riskTransactionId: string;
  requiredDocTypes: string[];
  generatedDocTypes: string[];
  welcomeMessageId?: string;
  welcomeStatus?: string;
};

type CreatedIds = {
  policyIds: string[];
  policyHolderIds: string[];
  programIds: string[];
  binderIds: string[];
};

type ProofReport = {
  startedAt: string;
  finishedAt?: string;
  tenant: { id: string; slug: string };
  welcomeTo: string;
  alertTo: string | null;
  products: ProofResult[];
  passed: boolean;
  error: string | null;
  cleanup?: {
    attempted: boolean;
    succeeded: boolean;
    error: string | null;
  };
};

const tenant = buildTenantConfigFromEnv();
const startedAt = new Date();
const welcomeTo = String(process.env.ISSUANCE_PROOF_WELCOME_TO || '').trim();
const alertTo = String(process.env.ISSUANCE_PROOF_ALERT_TO || '').trim();
const artifactPath = String(process.env.ISSUANCE_PROOF_ARTIFACT_PATH || '/tmp/issuance-proof.json').trim();
const cleanupOnSuccess = !/^(0|false|no)$/i.test(String(process.env.ISSUANCE_PROOF_CLEANUP_ON_SUCCESS || 'true'));
const productFilter = new Set(
  String(process.env.ISSUANCE_PROOF_PRODUCTS || 'MOTOR,HOME,TRAVEL')
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean),
);

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addOneYear(date: Date): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

function patchProofContact(quoteData: Record<string, unknown>, productType: string): Record<string, unknown> {
  const clone = structuredClone(quoteData) as Record<string, unknown>;
  const firstName = 'Issuance';
  const lastName = `${productType} Proof`;
  clone.firstName = firstName;
  clone.lastName = lastName;
  clone.email = welcomeTo;
  clone.telephone = '+35799111222';
  const proposer = clone.proposer && typeof clone.proposer === 'object' && !Array.isArray(clone.proposer)
    ? clone.proposer as Record<string, unknown>
    : {};
  clone.proposer = {
    ...proposer,
    firstName,
    lastName,
    email: welcomeTo,
    phone: String(proposer.phone || '+35799111222'),
  };
  return clone;
}

async function ensureTenantExists(): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { id: true } });
  if (existing) return;
  await prisma.tenant.create({
    data: {
      id: tenant.id,
      tenantSlug: tenant.tenantSlug,
      kind: 'SYNTHETIC',
      status: 'ACTIVE',
      countryCode: tenant.countryCode,
      country: tenant.country,
      currency: tenant.currency,
      iptJson: asInputJson(tenant.ipt),
      adminFee: tenant.adminFee,
      legalPack: tenant.legalPack,
      publicBaseUrl: tenant.publicBaseUrl,
      fromEmail: tenant.fromEmail,
      brandLogos: asInputJson(tenant.brandLogo),
      priorityCountries: [tenant.country],
      allowedRiskCountries: ['Cyprus', 'Spain', 'Portugal', 'Greece'],
      defaultNationality: tenant.country,
      defaultDriversLicenseCountry: tenant.country,
    } as Prisma.TenantUncheckedCreateInput,
  });
}

async function deliverQueuedWelcomeMessage(policyId: string): Promise<{ id: string; status: string }> {
  const message = await prisma.communicationMessage.findFirst({
    where: {
      thread: { entityType: 'POLICY', entityId: policyId },
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      status: { in: ['QUEUED', 'FAILED', 'SENT', 'DELIVERED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  if (!message) throw new Error(`No queued welcome email message found for policy ${policyId}`);
  if (message.status === 'QUEUED' || message.status === 'FAILED') {
    await handleCommunicationOutbound({
      id: `issuance-proof:${message.id}`,
      data: { messageId: message.id, correlationId: `issuance-proof:${policyId}` },
    } as unknown as Job);
  }
  const after = await prisma.communicationMessage.findUnique({
    where: { id: message.id },
    select: { id: true, status: true },
  });
  const status = String(after?.status || message.status || '');
  if (status !== 'SENT' && status !== 'DELIVERED') {
    throw new Error(`Welcome email delivery did not complete for policy ${policyId}; status=${status}`);
  }
  return { id: message.id, status };
}

async function proveProduct(adapter: ProductAdapter, created: CreatedIds): Promise<ProofResult> {
  const fixture = adapter.getGoldenFixtures().minimumIssuable || adapter.getGoldenFixtures().minimumValid;
  const quoteData = patchProofContact(structuredClone(fixture) as Record<string, unknown>, adapter.productType);
  const quote = await adapter.buildQuoteResponse(quoteData, {});
  const quoteResponse = quote.quoteResponse as Record<string, unknown>;
  if (!quoteResponse) throw new Error(`${adapter.productType}: buildQuoteResponse returned no quoteResponse`);

  const inceptionDate = new Date('2026-05-01T00:00:00.000Z');
  const expiryDate = addOneYear(inceptionDate);
  const program = await tenantScopedPrisma.program.create({
    data: {
      name: unique(`${adapter.productType} Issuance Proof Program`),
      productType: adapter.productType,
      status: 'ISSUANCE_PROOF',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2027-12-31T23:59:59.999Z'),
      metadata: asInputJson({ issuanceProof: true }),
    } as Prisma.ProgramUncheckedCreateInput,
    select: { id: true },
  });
  created.programIds.push(program.id);

  const binder = await tenantScopedPrisma.binder.create({
    data: {
      coverholderName: 'Abbeygate Insurance Brokers Limited',
      coverholderPin: '115933OFE',
      umr: unique(`B1760-${adapter.productType}`),
      agreementNumber: unique(`${adapter.productType}-ISSUANCE-PROOF`),
      lloydsReportingVer: 'V5.2',
      defaultCurrency: tenant.currency,
      settlementCurrency: tenant.currency,
      status: 'ACTIVE',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2027-12-31T23:59:59.999Z'),
      config: asInputJson({ issuanceProof: true }),
    } as Prisma.BinderUncheckedCreateInput,
    select: { id: true, umr: true },
  });
  created.binderIds.push(binder.id);
  await prisma.programBinderLink.create({
    data: { programId: program.id, binderId: binder.id, status: 'ACTIVE', mapping: asInputJson({ issuanceProof: true }) },
  });

  const holder = await tenantScopedPrisma.policyHolder.create({
    data: {
      name: `Issuance ${adapter.productType} Proof`,
      segment: adapter.displayName,
      address: `Synthetic ${adapter.productType} proof, ${tenant.country}`,
        contact: JSON.stringify({ email: welcomeTo, phone: '+35799111222' }),
    } as Prisma.PolicyHolderUncheckedCreateInput,
    select: { id: true },
  });
  created.policyHolderIds.push(holder.id);

  const policy = await tenantScopedPrisma.policy.create({
    data: {
      policyNumber: unique(`PROOF-${adapter.productType}`),
      certificateNumber: unique(`CERT-PROOF-${adapter.productType}`),
      productType: adapter.productType,
      status: 'ISSUING',
      inceptionDate,
      expiryDate,
      issuedAt: inceptionDate,
      policyHolderId: holder.id,
      programId: program.id,
      binderId: binder.id,
      umr: binder.umr,
      quoteData: asInputJson(quoteData),
      quoteResponse: asInputJson(quoteResponse),
    } as Prisma.PolicyUncheckedCreateInput,
    select: { id: true },
  });
  created.policyIds.push(policy.id);

  const snapshot = { quoteData, quoteResponse };
  const riskTransaction = await tenantScopedPrisma.riskTransaction.create({
    data: {
      policyId: policy.id,
      programId: program.id,
      binderId: binder.id,
      transactionNumber: 1,
      transactionType: 'INCEPTION',
      status: 'BOUND',
      effectiveDate: inceptionDate,
      expiryDate,
      changeReason: 'ISSUANCE_PROOF',
      createdBy: 'issuance-proof',
      snapshotFinal: asInputJson(snapshot),
      pricingFinal: asInputJson(quoteResponse),
    } as Prisma.RiskTransactionUncheckedCreateInput,
    select: { id: true },
  });

  await tenantScopedPrisma.policyStateCurrent.create({
    data: { policyId: policy.id, snapshot: asInputJson(snapshot) } as Prisma.PolicyStateCurrentUncheckedCreateInput,
  });

  await runIssuedPackJob({
    eventType: 'DOC.GENERATE_ISSUED_POLICY_PACK',
    data: {
      policyId: policy.id,
      riskTransactionId: riskTransaction.id,
      source: 'ISSUANCE_PROOF',
      generatedByUserId: null,
    },
  });

  const requiredDocTypes = adapter.getRequiredIssuedDocTypes();
  const docs = await tenantScopedPrisma.document.findMany({
    where: {
      policyId: policy.id,
      riskTransactionId: riskTransaction.id,
      docPack: 'ISSUED_POLICY_PACK',
      status: 'GENERATED',
      type: { in: [...requiredDocTypes] },
    },
    select: { type: true, storageUri: true, filename: true },
  });
  const generatedDocTypes = docs.map((doc) => String(doc.type || ''));
  for (const required of requiredDocTypes) {
    const row = docs.find((doc) => String(doc.type) === required);
    if (!row?.storageUri || !String(row.filename || '').endsWith('.pdf')) {
      throw new Error(`${adapter.productType}: missing generated ${required}`);
    }
  }

  const state = await tenantScopedPrisma.policyStateCurrent.findUnique({
    where: { policyId: policy.id },
    select: { snapshot: true },
  });
  const snapshotRecord = state?.snapshot && typeof state.snapshot === 'object' && !Array.isArray(state.snapshot)
    ? state.snapshot as Record<string, unknown>
    : {};
  const issuance = snapshotRecord.issuance && typeof snapshotRecord.issuance === 'object' && !Array.isArray(snapshotRecord.issuance)
    ? snapshotRecord.issuance as Record<string, unknown>
    : {};
  const welcomeEmail = issuance.welcomeEmail && typeof issuance.welcomeEmail === 'object' && !Array.isArray(issuance.welcomeEmail)
    ? issuance.welcomeEmail as Record<string, unknown>
    : {};
  if (!String(welcomeEmail.sentAt || '').trim()) {
    throw new Error(`${adapter.productType}: welcome email was not marked sent by the issued-pack spine`);
  }

  const delivered = await deliverQueuedWelcomeMessage(policy.id);
  return {
    productType: adapter.productType,
    policyId: policy.id,
    riskTransactionId: riskTransaction.id,
    requiredDocTypes: [...requiredDocTypes],
    generatedDocTypes,
    welcomeMessageId: delivered.id,
    welcomeStatus: delivered.status,
  };
}

async function cleanupCreated(created: CreatedIds): Promise<void> {
  await prisma.communicationThread.deleteMany({
    where: { entityType: 'POLICY', entityId: { in: created.policyIds } },
  }).catch(() => undefined);
  for (const policyId of created.policyIds.reverse()) {
    // The welcome-email synthetic audit row is keyed by correlationId=policyId.
    // Close it out with the real cleanup outcome so the audit never lies about
    // whether the throwaway policy still exists.
    let policyDeleted = true;
    await tenantScopedPrisma.policy.delete({ where: { id: policyId } }).catch(() => {
      policyDeleted = false;
    });
    await markSyntheticEmailCleanup({
      correlationId: policyId,
      status: policyDeleted ? 'DONE' : 'FAILED',
      detail: policyDeleted ? null : 'issuance-proof policy delete failed',
    });
  }
  for (const policyHolderId of created.policyHolderIds.reverse()) {
    await tenantScopedPrisma.policyHolder.delete({ where: { id: policyHolderId } }).catch(() => undefined);
  }
  await prisma.programBinderLink.deleteMany({
    where: { programId: { in: created.programIds }, binderId: { in: created.binderIds } },
  }).catch(() => undefined);
  for (const binderId of created.binderIds.reverse()) {
    await tenantScopedPrisma.binder.delete({ where: { id: binderId } }).catch(() => undefined);
  }
  for (const programId of created.programIds.reverse()) {
    await tenantScopedPrisma.program.delete({ where: { id: programId } }).catch(() => undefined);
  }
}

async function sendFailureAlert(message: string, report: unknown): Promise<void> {
  if (!alertTo) return;
  await runWithOperatingTenant(tenant, async () => {
    const ok = await sendTimelineMessageEmail({
      toEmail: alertTo,
      subject: 'CRITICAL Abbeygate issuance proof failed',
      message: [
        'CRITICAL ABBEYGATE ISSUANCE PROOF FAILED',
        '',
        message,
        '',
        JSON.stringify(report, null, 2).slice(0, 8000),
      ].join('\n'),
    });
    if (!ok) throw new Error('Failed to queue issuance proof alert email');
    const alertMessage = await prisma.communicationMessage.findFirst({
      where: {
        thread: { entityType: 'ACCOUNT', entityId: alertTo.toLowerCase() },
        channel: 'EMAIL',
        direction: 'OUTBOUND',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (alertMessage?.id) {
      await handleCommunicationOutbound({
        id: `issuance-proof-alert:${alertMessage.id}`,
        data: { messageId: alertMessage.id, correlationId: `issuance-proof-alert:${Date.now()}` },
      } as unknown as Job);
    }
  });
}

async function main(): Promise<void> {
  registerAllProducts();
  if (!welcomeTo) {
    throw new Error('ISSUANCE_PROOF_WELCOME_TO is required for issuance-proof welcome email dispatch');
  }
  const created: CreatedIds = { policyIds: [], policyHolderIds: [], programIds: [], binderIds: [] };
  const report: ProofReport = {
    startedAt: startedAt.toISOString(),
    tenant: { id: tenant.id, slug: tenant.tenantSlug },
    welcomeTo,
    alertTo: alertTo || null,
    products: [] as ProofResult[],
    passed: false,
    error: null as string | null,
  };

  try {
    await runWithOperatingTenant(tenant, async () => {
      await ensureTenantExists();
      const adapters = ProductRegistry.getInstance()
        .getAllAdapters()
        .filter((adapter) => productFilter.has(String(adapter.productType).toUpperCase()));
      if (adapters.length !== productFilter.size) {
        throw new Error(`Expected adapters for ${[...productFilter].join(', ')}, found ${adapters.map((a) => a.productType).join(', ')}`);
      }
      for (const adapter of adapters) {
        report.products.push(await proveProduct(adapter, created));
      }
    });
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    await sendFailureAlert(report.error, report).catch((alertError) => {
      report.error = `${report.error}; alert_failed=${alertError instanceof Error ? alertError.message : String(alertError)}`;
    });
    throw error;
  } finally {
    let cleanupError: Error | null = null;
    if (cleanupOnSuccess) {
      report.cleanup = { attempted: true, succeeded: false, error: null };
      try {
        await runWithOperatingTenant(tenant, async () => cleanupCreated(created));
        report.cleanup.succeeded = true;
      } catch (error) {
        cleanupError = error instanceof Error ? error : new Error(String(error));
        report.cleanup.error = cleanupError.message;
        report.error = report.error ? `${report.error}; cleanup_failed=${cleanupError.message}` : `cleanup_failed=${cleanupError.message}`;
        report.passed = false;
      }
    } else {
      report.cleanup = { attempted: false, succeeded: false, error: null };
    }
    report.finishedAt = new Date().toISOString();
    await import('node:fs/promises').then((fs) => fs.writeFile(artifactPath, JSON.stringify(report, null, 2), 'utf8'));
    await prisma.$disconnect().catch(() => undefined);
    if (cleanupError) throw cleanupError;
  }
}

main()
  .then(() => {
    // The proof imports worker handlers directly, and those modules can leave
    // queue/Redis handles alive even after Prisma disconnects. The report has
    // already been written in `finally`; terminate explicitly so the Kubernetes
    // proof Job completes instead of being killed by activeDeadlineSeconds.
    process.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`[issuance-proof] FAILED: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  });
