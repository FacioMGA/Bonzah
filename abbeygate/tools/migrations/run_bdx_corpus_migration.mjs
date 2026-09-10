#!/usr/bin/env node
import { BlobServiceClient } from '@azure/storage-blob';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerAllProducts } from '../../backend/dist/products/registerProducts.js';
import { runWithOperatingTenant } from '../../backend/dist/platform/tenant/tenantAls.js';
import { loadTenantBySlug } from '../../backend/dist/platform/tenant/tenantJobContext.js';
import { evaluateBdxMigrationImportRequest } from '../../backend/dist/modules/reporting/app/bdxImport/service.js';
import { executeBdxImportLiveRun } from '../../backend/dist/modules/policy/app/bdxImport/bdxImportOrchestrator.js';
import { ensureQueueRedisReady } from '../../backend/dist/platform/events/queue.js';
import { prisma, tenantScopedPrisma } from '../../backend/dist/platform/db/connection.js';

const mode = String(process.env.BDX_CORPUS_MODE || process.argv[2] || 'dryrun').trim().toLowerCase();
const allowCommit = ['1', 'true', 'yes'].includes(String(process.env.BDX_CORPUS_ALLOW_COMMIT || '').toLowerCase());
const productFilter = new Set(String(process.env.BDX_CORPUS_PRODUCT_FILTER || '').split(',').map((value) => value.trim()).filter(Boolean));
const tenantFilter = new Set(String(process.env.BDX_CORPUS_TENANT_FILTER || '').split(',').map((value) => value.trim()).filter(Boolean));
const maxImports = Math.max(1, Number(process.env.BDX_CORPUS_MAX_IMPORTS || 100000) || 100000);
const connectionString = String(process.env.BDX_STORAGE_CONNECTION_STRING || process.env.STORAGE_CONNECTION_STRING || '').trim();
const containerName = String(process.env.BDX_BLOB_CONTAINER || process.env.STORAGE_CONTAINER_NAME || '').trim();
const manifestBlobName = String(process.env.BDX_CORPUS_MANIFEST_BLOB || '').trim();
const manifestLocalPath = String(process.env.BDX_CORPUS_MANIFEST_PATH || '').trim();
const outputPrefix = String(process.env.BDX_CORPUS_OUTPUT_PREFIX || `bdx-corpus-runs/${new Date().toISOString().replace(/[:.]/g, '-')}`).replace(/^\/+|\/+$/g, '');
const productTypeByLine = {
  motor: 'MOTOR',
  home: 'HOME',
  travel: 'TRAVEL',
};
const debugGroupsLimit = Math.max(1, Number(process.env.BDX_CORPUS_DEBUG_GROUPS || 10) || 10);
const debugExamplesPerGroup = Math.max(1, Number(process.env.BDX_CORPUS_DEBUG_EXAMPLES_PER_GROUP || 3) || 3);

const validQuoteExamples = {
  home: {
    proposer: {
      firstName: 'Ada',
      lastName: 'Home',
      email: 'ada.home@example.com',
      phone: '+351000000000',
      dateOfBirth: '1980-01-01',
      nationality: 'Portugal',
      domicileCountry: 'Portugal',
      address: {
        line1: '1 Home Street',
        city: 'Lisbon',
        country: 'Portugal',
        postcode: '1000-000',
      },
    },
    property: {
      address: { line1: '1 Home Street', city: 'Lisbon', country: 'Portugal', postcode: '1000-000' },
      sameAsProposer: true,
      propertyType: 'Villa',
      bedrooms: 3,
      floorAreaSqm: 140,
      permanentHome: true,
      woodenConstruction: false,
      nonCombustibleMaterial: true,
      alarm: 'Yes',
      yearBuilt: '1990 or Later',
    },
    risk: {
      previousClaims: 'None',
      noClaimsDiscount: '0 Years',
      increasedExcess: 'STD 150 XS',
      proposerOver45: false,
    },
    usage: {
      permanentHome: true,
      businessUse: false,
      rentedOut: false,
    },
    security: {
      doorsFiveLeverLocks: true,
      windowsSecured: true,
      additionalSecurity: false,
    },
    coverage: {
      buildings: 100000,
      contents: 25000,
      accidentalDamageBuildings: false,
      accidentalDamageContents: false,
      allRiskJewellery: 0,
      allRiskOther: 0,
      solarPanelCover: 0,
    },
    eligibility: { confirmation: true },
    policy: { startDate: '2026-01-01' },
  },
  travel: {
    eligibility: {
      countryOfResidence: 'Portugal',
      isExpat: false,
      residencyConfirmation: true,
      languageConfirmation: true,
      legalAgreement: true,
    },
    travellers: {
      coverType: 'single',
      leadTravellerDOB: '1987-01-18',
    },
    trip: {
      planType: 'single_trip',
      destinations: ['Germany'],
      startDate: '2026-01-01',
      endDate: '2026-01-08',
    },
    quote: { selectedPlan: 'silver' },
    addons: {
      winterSports: false,
      businessCover: false,
      golfCover: false,
      terrorism: false,
      sportsEquipment: false,
      wedding: false,
      gadget: false,
    },
    proposer: {
      firstName: 'Ada',
      lastName: 'Travel',
      email: 'ada.travel@example.com',
      phone: '+351000000000',
    },
    declarations: {
      medicalNotice: true,
      howToClaimReview: true,
      personalDataConsent: true,
      contractConsent: true,
      contractAgreement: true,
    },
  },
};

if (mode !== 'dryrun' && mode !== 'commit') throw new Error('BDX corpus mode must be dryrun or commit');
if (mode === 'commit' && !allowCommit) throw new Error('Set BDX_CORPUS_ALLOW_COMMIT=true to run commit mode');
if (!connectionString) throw new Error('Set BDX_STORAGE_CONNECTION_STRING or STORAGE_CONNECTION_STRING');
if (!containerName) throw new Error('Set BDX_BLOB_CONTAINER or STORAGE_CONTAINER_NAME');
if (!manifestBlobName && !manifestLocalPath) throw new Error('Set BDX_CORPUS_MANIFEST_BLOB or BDX_CORPUS_MANIFEST_PATH');

const service = BlobServiceClient.fromConnectionString(connectionString);
const container = service.getContainerClient(containerName);

function csvCell(value) {
  const raw = String(value ?? '');
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function toCsv(rows, headers) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
}

async function downloadBlobToFile(blobName, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await container.getBlockBlobClient(blobName).downloadToFile(filePath);
}

async function readManifest() {
  if (manifestLocalPath) {
    return JSON.parse(await fs.readFile(manifestLocalPath, 'utf8'));
  }
  const tmp = path.join(os.tmpdir(), `bdx-corpus-manifest-${Date.now()}.json`);
  await downloadBlobToFile(manifestBlobName, tmp);
  return JSON.parse(await fs.readFile(tmp, 'utf8'));
}

async function uploadText(blobName, content, contentType) {
  await container.getBlockBlobClient(blobName).upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  console.log(`[bdx-corpus] report ${blobName}`);
}

function failureRowsFromEvaluation(entry, evaluation) {
  return evaluation.gaps
    .filter((gap) => gap.severity === 'Critical')
    .map((gap) => ({
      tenantSlug: entry.tenantSlug,
      tenantHost: entry.tenantHost,
      productLine: entry.productLine,
      sourceLabel: entry.sourceLabel,
      blobName: entry.blobName,
      sourceSheetName: evaluation.dto.sourceSheetName,
      sourceMonth: evaluation.dto.sourceMonth || '',
      sourceRowNumber: evaluation.dto.sourceRowNumber,
      policyRef: evaluation.dto.policyRef,
      termKey: evaluation.dto.termKey || '',
      result: evaluation.result,
      category: gap.category,
      severity: gap.severity,
      message: gap.message,
      rootCauseHint: gap.rootCauseHint || '',
    }));
}

function summaryForResult(entry, result, durationMs) {
  return {
    tenantSlug: entry.tenantSlug,
    tenantHost: entry.tenantHost,
    productLine: entry.productLine,
    sourceLabel: entry.sourceLabel,
    blobName: entry.blobName,
    sheetName: entry.sheetName || '',
    runId: result.runId,
    dryRun: result.dryRun,
    totalRows: result.summary.totalRows,
    skippedBlankRows: result.summary.skippedBlankRows || 0,
    skippedAggregateRows: result.summary.skippedAggregateRows || 0,
    passRows: result.summary.passRows,
    failRows: result.summary.failRows,
    successRows: result.summary.passRows,
    importedRows: result.summary.importedRows,
    durationMs,
  };
}

function parseRootCauseHint(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('{')) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function failurePathCounts(failures) {
  const counts = new Map();
  for (const failure of failures) {
    const parsed = parseRootCauseHint(failure.rootCauseHint);
    const paths = Array.isArray(parsed?.schemaIssuePaths)
      ? parsed.schemaIssuePaths
      : [];
    if (paths.length === 0) {
      const key = `${failure.productLine || 'unknown'}:${failure.category}:${failure.message}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      continue;
    }
    for (const pathName of paths) {
      const key = `${failure.productLine || 'unknown'}:${String(pathName || 'unknown').trim() || 'unknown'}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [productLine, ...rest] = key.split(':');
      return { productLine, path: rest.join(':'), count };
    })
    .sort((a, b) => b.count - a.count || a.productLine.localeCompare(b.productLine) || a.path.localeCompare(b.path));
}

function valueAtPath(input, pathName) {
  if (!pathName) return undefined;
  return String(pathName).split('.').reduce((value, segment) => {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(segment)) return value[Number(segment)];
    if (typeof value !== 'object') return undefined;
    return value[segment];
  }, input);
}

function groupKeysForEvaluation(evaluation) {
  const keys = [];
  for (const gap of evaluation.gaps || []) {
    if (gap?.severity !== 'Critical') continue;
    const parsed = parseRootCauseHint(gap.rootCauseHint);
    const paths = Array.isArray(parsed?.schemaIssuePaths) ? parsed.schemaIssuePaths : [];
    if (paths.length === 0) {
      keys.push(`${evaluation.dto.productLine || 'unknown'}:${gap.category}:${gap.message}`);
      continue;
    }
    for (const pathName of paths) {
      keys.push(`${evaluation.dto.productLine || 'unknown'}:${String(pathName || 'unknown').trim() || 'unknown'}`);
    }
  }
  return [...new Set(keys)];
}

function buildDebugArtifact(entry, evaluation, resolved, group) {
  const productLine = String(entry.productLine || '').toLowerCase();
  const validQuoteData = validQuoteExamples[productLine] || null;
  const groupPath = String(group.path || '');
  return {
    group,
    classification: 'unclassified',
    classificationCandidates: [
      'missing BDX mapping',
      'wrong enum normalization',
      'wrong nested shape',
      'missing default from jurisdiction/product config',
      'issue-readiness schema expecting customer-flow fields not available in BDX imports',
    ],
    source: {
      tenantSlug: entry.tenantSlug,
      tenantHost: entry.tenantHost,
      productLine: entry.productLine,
      sourceLabel: entry.sourceLabel,
      blobName: entry.blobName,
      sourceSheetName: evaluation.dto.sourceSheetName,
      sourceMonth: evaluation.dto.sourceMonth || '',
      sourceRowNumber: evaluation.dto.sourceRowNumber,
      policyRef: evaluation.dto.policyRef,
      termKey: evaluation.dto.termKey || '',
    },
    selectedProgramBinder: {
      programId: resolved.program?.id || null,
      programProductType: resolved.program?.productType || null,
      binderId: resolved.binders?.[0]?.id || null,
      binderUmr: resolved.binders?.[0]?.umr || null,
    },
    comparison: {
      path: groupPath,
      failedValue: valueAtPath(evaluation.normalizedQuoteData || {}, groupPath),
      validValue: validQuoteData ? valueAtPath(validQuoteData, groupPath) : undefined,
      failedHasPath: valueAtPath(evaluation.normalizedQuoteData || {}, groupPath) !== undefined,
      validHasPath: validQuoteData ? valueAtPath(validQuoteData, groupPath) !== undefined : false,
    },
    gaps: evaluation.gaps,
    rawBdxRow: evaluation.rawRow || null,
    mappedDto: evaluation.dto,
    generatedQuoteData: evaluation.normalizedQuoteData || null,
    validQuoteDataExample: validQuoteData,
    enrichment: evaluation.enrichment || null,
  };
}

async function resolveProgramBinderForEntry(entry) {
  const productType = productTypeByLine[String(entry.productLine || '').toLowerCase()];
  if (!productType) {
    throw new Error(`Unsupported product line for Program/Binder resolution: ${entry.productLine}`);
  }

  const program = await tenantScopedPrisma.program.findFirst({
    where: { status: 'ACTIVE', productType },
    orderBy: { updatedAt: 'desc' },
  });
  if (!program) return { program: null, binders: [], linkOk: false };

  const links = await prisma.programBinderLink.findMany({
    where: { programId: program.id, status: 'ACTIVE' },
    include: { binder: true },
    orderBy: { updatedAt: 'desc' },
  });
  const binders = links
    .map((link) => link.binder)
    .filter((binder) => String(binder.status || '').toUpperCase() === 'ACTIVE');

  return { program, binders, linkOk: binders.length > 0 };
}

async function evaluateEntry(entry, index) {
  const tenant = await loadTenantBySlug(entry.tenantSlug);
  if (!tenant) throw new Error(`Unknown tenant slug: ${entry.tenantSlug}`);
  const resolved = await runWithOperatingTenant(tenant, () => resolveProgramBinderForEntry(entry));
  if (mode === 'commit' && (!resolved.program || resolved.binders.length === 0)) {
    throw new Error(`Commit requires active Program/Binder for ${entry.tenantSlug}/${entry.productLine}`);
  }
  const tmpSource = path.join(os.tmpdir(), 'bdx-corpus', createHash('sha1').update(entry.blobName).digest('hex') + path.extname(entry.blobName));
  await downloadBlobToFile(entry.blobName, tmpSource);
  const started = Date.now();
  console.log(`[bdx-corpus] ${mode === 'commit' ? 'committing' : 'evaluating'} ${entry.tenantSlug}/${entry.productLine} ${entry.sourceLabel}`);
  const request = {
      sourceFilePath: tmpSource,
      sourceHash: createHash('sha256').update(entry.blobName).digest('hex'),
      dryRun: mode !== 'commit',
      fileType: entry.fileType,
      productLine: entry.productLine,
      tenantHost: entry.tenantHost,
      operatingTenantId: tenant.id,
      importRunId: `bdx-corpus-${index}-${Date.now()}`,
      programId: resolved.program?.id || null,
      binderId: resolved.binders[0]?.id || null,
    };
  const runId = `bdx-corpus-${index}-${Date.now()}`;
  const result = await runWithOperatingTenant(tenant, () => evaluateBdxMigrationImportRequest({
    request,
    runId,
    program: resolved.program ? { id: resolved.program.id, metadata: resolved.program.metadata } : null,
  }));
  if (mode === 'commit') {
    await runWithOperatingTenant(tenant, () => executeBdxImportLiveRun({
      result,
      request,
      runId,
      maxImports,
      accountId: null,
      program: { id: resolved.program.id, metadata: resolved.program.metadata },
      binders: resolved.binders,
      context: {
        actor: { id: null, name: 'BDX Corpus Runner', email: null, role: 'SYSTEM' },
        correlationId: runId,
        reqUrlContext: { protocol: 'https', host: entry.tenantHost },
      },
    }));
  }
  const durationMs = Date.now() - started;
  const debugCandidates = result.evaluations
    .filter((evaluation) => evaluation.result === 'FAIL')
    .map((evaluation) => ({
      evaluation,
      groupKeys: groupKeysForEvaluation(evaluation),
    }))
    .filter((candidate) => candidate.groupKeys.length > 0);
  const committed = (result.outputs?.importOutcomes || [])
    .filter((outcome) => outcome.status === 'imported' || outcome.status === 'already_imported')
    .map((outcome) => ({
      tenantSlug: entry.tenantSlug,
      productLine: entry.productLine,
      sourceLabel: entry.sourceLabel,
      sourceRowNumber: outcome.sourceRowNumber,
      policyRef: outcome.policyRef,
      termKey: outcome.termKey || '',
      status: outcome.status,
      policyId: outcome.policyId || '',
    }));
  return {
    summary: summaryForResult(entry, result, durationMs),
    failures: result.evaluations.flatMap((evaluation) => failureRowsFromEvaluation(entry, evaluation)),
    debugCandidates: debugCandidates.map((candidate) => ({
      entry,
      resolved,
      evaluation: candidate.evaluation,
      groupKeys: candidate.groupKeys,
    })),
    committed,
    rerunRows: result.evaluations
      .filter((evaluation) => evaluation.result === 'FAIL')
      .map((evaluation) => ({
        tenantSlug: entry.tenantSlug,
        productLine: entry.productLine,
        sourceLabel: entry.sourceLabel,
        sourceSheetName: evaluation.dto.sourceSheetName,
        sourceRowNumber: evaluation.dto.sourceRowNumber,
        policyRef: evaluation.dto.policyRef,
        termKey: evaluation.dto.termKey || '',
      })),
  };
}

async function main() {
  registerAllProducts();
  if (mode === 'commit') {
    await ensureQueueRedisReady();
  }
  const manifest = await readManifest();
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('Manifest has no entries');
  }
  const entries = manifest.entries.filter((entry) => {
    if (productFilter.size > 0 && !productFilter.has(entry.productLine)) return false;
    if (tenantFilter.size > 0 && !tenantFilter.has(entry.tenantSlug)) return false;
    return true;
  });
  if (entries.length === 0) throw new Error('No manifest entries match filters');
  const summaries = [];
  const failures = [];
  const committed = [];
  const rerunRows = [];
  const debugCandidates = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entryResult = await evaluateEntry(entries[i], i + 1);
    summaries.push(entryResult.summary);
    failures.push(...entryResult.failures);
    committed.push(...entryResult.committed);
    rerunRows.push(...entryResult.rerunRows);
    debugCandidates.push(...entryResult.debugCandidates);
    await uploadText(`${outputPrefix}/progress-summary.json`, `${JSON.stringify(summaries, null, 2)}\n`, 'application/json');
  }
  const groupedFailureCounts = failurePathCounts(failures);
  const topDebugGroups = groupedFailureCounts.slice(0, debugGroupsLimit);
  const debugIndex = [];
  for (const group of topDebugGroups) {
    const key = `${group.productLine}:${group.path}`;
    const candidates = debugCandidates
      .filter((candidate) => candidate.groupKeys.includes(key))
      .slice(0, debugExamplesPerGroup);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const safePath = String(group.path || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 120);
      const fileName = `debug/${group.productLine}-${safePath}-row-${candidate.evaluation.dto.sourceRowNumber}-${i + 1}.json`;
      const blobName = `${outputPrefix}/${fileName}`;
      await uploadText(
        blobName,
        `${JSON.stringify(buildDebugArtifact(candidate.entry, candidate.evaluation, candidate.resolved, group), null, 2)}\n`,
        'application/json'
      );
      debugIndex.push({
        group,
        blobName,
        sourceLabel: candidate.entry.sourceLabel,
        sourceRowNumber: candidate.evaluation.dto.sourceRowNumber,
        policyRef: candidate.evaluation.dto.policyRef,
      });
    }
  }

  const finalSummary = {
    mode,
    manifest: {
      containerName: manifest.containerName,
      prefix: manifest.prefix,
      manifestBlobName: manifestBlobName || null,
    },
    generatedAt: new Date().toISOString(),
    totals: {
      entries: summaries.length,
      rows: summaries.reduce((sum, row) => sum + row.totalRows, 0),
      skippedBlankRows: summaries.reduce((sum, row) => sum + (row.skippedBlankRows || 0), 0),
      skippedAggregateRows: summaries.reduce((sum, row) => sum + (row.skippedAggregateRows || 0), 0),
      successRows: summaries.reduce((sum, row) => sum + row.successRows, 0),
      failRows: summaries.reduce((sum, row) => sum + row.failRows, 0),
      importedRows: summaries.reduce((sum, row) => sum + (row.importedRows || 0), 0),
    },
    failurePathCounts: groupedFailureCounts,
    debugArtifacts: debugIndex,
    entries: summaries,
  };
  const failureHeaders = ['tenantSlug', 'productLine', 'sourceLabel', 'sourceSheetName', 'sourceMonth', 'sourceRowNumber', 'policyRef', 'termKey', 'result', 'category', 'severity', 'message', 'rootCauseHint'];
  const committedHeaders = ['tenantSlug', 'productLine', 'sourceLabel', 'sourceRowNumber', 'policyRef', 'termKey', 'status', 'policyId'];
  await uploadText(`${outputPrefix}/summary.json`, `${JSON.stringify(finalSummary, null, 2)}\n`, 'application/json');
  await uploadText(`${outputPrefix}/failures.csv`, `${toCsv(failures, failureHeaders)}\n`, 'text/csv');
  await uploadText(`${outputPrefix}/committed.csv`, `${toCsv(committed, committedHeaders)}\n`, 'text/csv');
  await uploadText(`${outputPrefix}/rerun-template.json`, `${JSON.stringify({ mode: 'dryrun', failedCount: rerunRows.length, rows: rerunRows }, null, 2)}\n`, 'application/json');
  console.log(`[bdx-corpus] complete outputPrefix=${outputPrefix}`);
  console.log(JSON.stringify(finalSummary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
