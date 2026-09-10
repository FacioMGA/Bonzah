#!/usr/bin/env node
/**
 * BDX Reconciliation Runner
 *
 * Runs a dry-run validation pass against the BDX import API, captures every
 * row's disposition and outcome, and produces a structured reconciliation
 * report with actionable categories.
 *
 * Designed to run as a Kubernetes Job against the internal ClusterIP service.
 *
 * Output: JSON reconciliation report written to stdout (last line) and
 * structured progress to stderr, so `kubectl logs | tail -1 | jq` gives
 * the full report.
 *
 * Required env:
 *   BDX_ENDPOINT        - API import URL
 *   BDX_SOURCE_FILE     - Path to BDX XLSX file
 *   API_SMOKE_EMAIL     - Login email (or BDX_AUTH_TOKEN)
 *   API_SMOKE_PASSWORD  - Login password
 *
 * Optional env:
 *   BDX_START_ROW, BDX_END_ROW, BDX_BATCH_SIZE, BDX_REQUEST_TIMEOUT_MS
 */

import fs from 'node:fs';
import path from 'node:path';

const endpoint = String(process.env.BDX_ENDPOINT || 'http://abbeygate-abbeygate-api/api/policies/imports/bdx').trim();
const sourceFile = String(process.env.BDX_SOURCE_FILE || '').trim();
const startRow = Number(process.env.BDX_START_ROW || 2);
const endRow = Number(process.env.BDX_END_ROW || 7581);
const batchSize = Number(process.env.BDX_BATCH_SIZE || 50);
const maxRetries = Number(process.env.BDX_MAX_RETRIES || 3);
const timeoutMs = Number(process.env.BDX_REQUEST_TIMEOUT_MS || 600000);

const log = (msg) => process.stderr.write(`[bdx-recon] ${msg}\n`);

const allRows = [];
const failedBatches = [];

async function resolveToken() {
  if (process.env.BDX_AUTH_TOKEN) return process.env.BDX_AUTH_TOKEN;
  const email = process.env.API_SMOKE_EMAIL;
  const password = process.env.API_SMOKE_PASSWORD;
  if (!email || !password) throw new Error('Missing BDX_AUTH_TOKEN and API_SMOKE_EMAIL/API_SMOKE_PASSWORD');
  const authUrl = endpoint.replace(/\/api\/policies\/imports\/bdx$/i, '/api/auth/login');
  log(`Minting token from ${authUrl}`);
  const resp = await fetch(authUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await resp.json();
  const token = body?.data?.token;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return token;
}

async function callDryRun(token, batchStart, batchEnd) {
  const headers = { authorization: `Bearer ${token}` };
  let body;
  if (sourceFile) {
    const bytes = fs.readFileSync(sourceFile);
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), path.basename(sourceFile));
    form.set('dryRun', 'true');
    form.set('startRow', String(batchStart));
    form.set('endRow', String(batchEnd));
    form.set('maxImports', '1');
    body = form;
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ dryRun: true, startRow: batchStart, endRow: batchEnd, maxImports: 1 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint, { method: 'POST', headers, body, signal: controller.signal });
    const json = await resp.json();
    if (!resp.ok || !json?.success) throw new Error(`API error (${resp.status}): ${JSON.stringify(json?.error || json)}`);
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

async function processBatch(token, batchStart, batchEnd) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const data = await callDryRun(token, batchStart, batchEnd);

      for (const ev of data.evaluations || []) {
        const outcome = (data.outputs?.importOutcomes || []).find(
          o => o.sourceRowNumber === ev.dto.sourceRowNumber && o.policyRef === ev.dto.policyRef
        );
        allRows.push({
          sourceRowNumber: ev.dto.sourceRowNumber,
          policyRef: ev.dto.policyRef || '',
          policyChainKey: ev.dto.policyChainKey || '',
          insured: ev.dto.insured || '',
          inceptionDate: ev.dto.inceptionDate || '',
          expiryDate: ev.dto.expiryDate || '',
          result: ev.result || 'UNKNOWN',
          disposition: ev.policyImportDisposition || 'UNKNOWN',
          outcomeStatus: outcome?.status || 'not_evaluated',
          outcomeReason: outcome?.reason || '',
          primaryGap: ev.gaps?.[0]?.message || '',
          gapCategory: ev.gaps?.[0]?.category || '',
          gapCount: ev.gaps?.length || 0,
          hasPricingDelta: ev.deltas ? true : false,
          grossDelta: ev.deltas?.gross ?? null,
          totalDelta: ev.deltas?.total ?? null,
        });
      }
      return;
    } catch (err) {
      const isTransient = err.name === 'AbortError' || String(err.message).includes('fetch failed');
      if (isTransient && attempt < maxRetries) {
        log(`${batchStart}-${batchEnd} attempt ${attempt}/${maxRetries} failed, retrying...`);
        await new Promise(r => setTimeout(r, 5000 * attempt));
        continue;
      }
      log(`${batchStart}-${batchEnd} FAILED: ${err.message}`);
      failedBatches.push({ start: batchStart, end: batchEnd, error: err.message });
      return;
    }
  }
}

function buildReport() {
  const total = allRows.length;

  const byResult = {};
  const byDisposition = {};
  const byOutcome = {};
  const byGapCategory = {};
  const failReasons = {};

  for (const row of allRows) {
    byResult[row.result] = (byResult[row.result] || 0) + 1;
    byDisposition[row.disposition] = (byDisposition[row.disposition] || 0) + 1;
    byOutcome[row.outcomeStatus] = (byOutcome[row.outcomeStatus] || 0) + 1;
    if (row.gapCategory) byGapCategory[row.gapCategory] = (byGapCategory[row.gapCategory] || 0) + 1;
    if (row.result === 'FAIL' && row.primaryGap) {
      failReasons[row.primaryGap] = (failReasons[row.primaryGap] || 0) + 1;
    }
  }

  const passRows = allRows.filter(r => r.result === 'PASS');
  const failRows = allRows.filter(r => r.result === 'FAIL');
  const importCandidates = allRows.filter(r => r.disposition === 'IMPORT_POLICY');
  const endorsementRows = allRows.filter(r => r.disposition === 'IMPORT_ENDORSEMENT');
  const renewalRows = allRows.filter(r => r.disposition === 'IMPORT_RENEWAL');
  const skippedRows = allRows.filter(r => r.disposition === 'SKIP_UNGROUPED_ROW');

  const alreadyImported = allRows.filter(r => r.outcomeStatus === 'already_imported');
  const pendingImport = passRows.filter(r => r.outcomeStatus !== 'already_imported');

  const topFailReasons = Object.entries(failReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([reason, count]) => ({ reason, count }));

  const uniquePolicyRefs = [...new Set(allRows.map(r => r.policyRef).filter(Boolean))];
  const uniqueImportedRefs = [...new Set(alreadyImported.map(r => r.policyRef).filter(Boolean))];
  const uniqueFailedRefs = [...new Set(failRows.map(r => r.policyRef).filter(Boolean))];
  const uniquePendingRefs = [...new Set(pendingImport.map(r => r.policyRef).filter(Boolean))];

  const pricingDeltaRows = allRows.filter(r => r.hasPricingDelta && r.totalDelta !== null && Math.abs(r.totalDelta) > 0.01);
  const avgTotalDelta = pricingDeltaRows.length > 0
    ? Math.round(pricingDeltaRows.reduce((s, r) => s + Math.abs(r.totalDelta), 0) / pricingDeltaRows.length * 100) / 100
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    scope: { startRow, endRow, totalRowsEvaluated: total },

    summary: {
      totalRows: total,
      passRows: passRows.length,
      failRows: failRows.length,
      passRate: total > 0 ? `${Math.round(passRows.length / total * 1000) / 10}%` : '0%',
      uniquePolicyRefs: uniquePolicyRefs.length,
    },

    importDisposition: {
      basePolicies: importCandidates.length,
      endorsements: endorsementRows.length,
      renewals: renewalRows.length,
      skippedUngrouped: skippedRows.length,
    },

    currentState: {
      alreadyImported: alreadyImported.length,
      alreadyImportedUniquePolicies: uniqueImportedRefs.length,
      pendingImport: pendingImport.length,
      pendingImportUniquePolicies: uniquePendingRefs.length,
      failedUniquePolicies: uniqueFailedRefs.length,
    },

    failureAnalysis: {
      totalFailedRows: failRows.length,
      topReasons: topFailReasons,
      byGapCategory,
    },

    pricingReconciliation: {
      rowsWithDelta: pricingDeltaRows.length,
      avgAbsTotalDelta: avgTotalDelta,
    },

    operationalHealth: {
      failedBatches: failedBatches.length,
      failedBatchDetails: failedBatches,
    },

    actionItems: [
      ...(pendingImport.length > 0 ? [{
        action: 'CONTINUE_IMPORT',
        description: `${pendingImport.length} rows passed validation but are not yet imported. Run the import job to completion.`,
        priority: 'HIGH',
      }] : []),
      ...(failRows.length > 0 ? [{
        action: 'REVIEW_FAILURES',
        description: `${failRows.length} rows failed validation across ${uniqueFailedRefs.length} unique policies. Review top failure reasons.`,
        priority: 'MEDIUM',
      }] : []),
      ...(pricingDeltaRows.length > 0 ? [{
        action: 'REVIEW_PRICING_DELTAS',
        description: `${pricingDeltaRows.length} rows have non-zero pricing deltas (avg absolute delta: ${avgTotalDelta}). Review for data quality.`,
        priority: 'LOW',
      }] : []),
      ...(failedBatches.length > 0 ? [{
        action: 'RETRY_FAILED_BATCHES',
        description: `${failedBatches.length} batches had unrecoverable errors during reconciliation.`,
        priority: 'HIGH',
      }] : []),
    ],

    failedRowDetail: failRows.slice(0, 100).map(r => ({
      row: r.sourceRowNumber,
      policyRef: r.policyRef,
      reason: r.primaryGap,
      category: r.gapCategory,
    })),
  };
}

async function main() {
  log(`Starting BDX reconciliation`);
  log(`endpoint=${endpoint} rows=${startRow}-${endRow} batch=${batchSize}`);

  const token = await resolveToken();
  log(`Authenticated`);

  const batches = [];
  for (let row = startRow; row <= endRow; row += batchSize) {
    batches.push({ start: row, end: Math.min(row + batchSize - 1, endRow) });
  }
  log(`${batches.length} batches to evaluate`);

  for (let i = 0; i < batches.length; i++) {
    await processBatch(token, batches[i].start, batches[i].end);
    if ((i + 1) % 10 === 0) {
      log(`Progress: ${i + 1}/${batches.length} batches, ${allRows.length} rows evaluated`);
    }
  }

  log(`Evaluation complete. Building report...`);
  const report = buildReport();

  log(`=== RECONCILIATION SUMMARY ===`);
  log(`Total rows: ${report.summary.totalRows}`);
  log(`Pass: ${report.summary.passRows} (${report.summary.passRate})`);
  log(`Fail: ${report.summary.failRows}`);
  log(`Already imported: ${report.currentState.alreadyImported}`);
  log(`Pending import: ${report.currentState.pendingImport}`);
  log(`Action items: ${report.actionItems.length}`);
  for (const item of report.actionItems) {
    log(`  [${item.priority}] ${item.action}: ${item.description}`);
  }

  // Full report as the last stdout line for easy extraction
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
