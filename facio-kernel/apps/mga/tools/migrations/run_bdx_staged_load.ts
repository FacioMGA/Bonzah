import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolvePolicyDocumentPath } from '../../backend/platform/runtime/runtimePaths.js';

type Range = { startRow: number; endRow: number };
type Stage = {
  name: string;
  dryRun: boolean;
  batchSize: number;
  maxImports: number;
  parallelWorkers: number;
  ranges?: Range[];
  rowNumbers?: number[];
  policyChainKeys?: string[];
  retryFailedFromStage?: string;
};
type Template = {
  endpoint: string;
  sourceFilePath: string;
  uploadFromRunner?: boolean;
  authTokenEnv?: string;
  commonPayload?: Record<string, unknown>;
  chainRows?: Record<string, number[]>;
  stages: Stage[];
};

type StageResult = {
  stage: string;
  runId: string;
  sourceHash?: string;
  dryRun: boolean;
  totalCalls: number;
  totalRowsRequested: number;
  importedRows: number;
  failRows: number;
  generatedPolicyIds: string[];
  failedRows: Array<{
    rowId: string;
    policyRef: string;
    sourceRowNumber: number;
    reason: string;
  }>;
  callResults: Array<{
    range: Range;
    importedRows: number;
    failRows: number;
    generatedPolicyIds: string[];
  }>;
};

function splitRange(range: Range, batchSize: number): Range[] {
  const chunks: Range[] = [];
  for (let start = range.startRow; start <= range.endRow; start += batchSize) {
    chunks.push({ startRow: start, endRow: Math.min(range.endRow, start + batchSize - 1) });
  }
  return chunks;
}

function parseCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replaceAll('"', '""')}"`;
  }
  return raw;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const head = headers.join(',');
  const lines = rows.map((row) => headers.map((key) => parseCsvCell(row[key])).join(','));
  return [head, ...lines].join('\n');
}

function uniqueRowNumbers(rows: number[]): number[] {
  return [...new Set(rows.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}

function rangesFromRowNumbers(rows: number[], batchSize: number): Range[] {
  const ordered = uniqueRowNumbers(rows);
  if (ordered.length === 0) return [];
  const maxBatch = Math.max(1, Math.floor(batchSize || 1));
  const result: Range[] = [];
  let contiguousGroup: number[] = [];
  const flushGroup = () => {
    if (contiguousGroup.length === 0) return;
    for (let i = 0; i < contiguousGroup.length; i += maxBatch) {
      const slice = contiguousGroup.slice(i, i + maxBatch);
      result.push({ startRow: slice[0]!, endRow: slice[slice.length - 1]! });
    }
    contiguousGroup = [];
  };
  for (const rowNumber of ordered) {
    const previous = contiguousGroup[contiguousGroup.length - 1];
    if (previous !== undefined && rowNumber !== previous + 1) {
      flushGroup();
    }
    contiguousGroup.push(rowNumber);
  }
  flushGroup();
  return result;
}

function rowNumbersFromPolicyChains(template: Template, policyChainKeys: string[]): number[] {
  const chainRows = template.chainRows || {};
  const rows: number[] = [];
  for (const key of policyChainKeys) {
    rows.push(...(chainRows[key] || []));
  }
  return uniqueRowNumbers(rows);
}

async function callImport(args: {
  endpoint: string;
  payload: Record<string, unknown>;
  token?: string;
  uploadFilePath?: string;
}) {
  const { endpoint, payload, token, uploadFilePath } = args;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit;
  if (uploadFilePath) {
    const bytes = await readFile(uploadFilePath);
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), path.basename(uploadFilePath));
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      // Skip nested tolerances in multipart mode; endpoint defaults are used.
      if (key === 'tolerances' && typeof value === 'object') continue;
      form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    body = form;
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  const timeoutMs = Math.max(1_000, Number(process.env.BDX_REQUEST_TIMEOUT_MS || 45_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Import call timed out after ${timeoutMs}ms for payload ${JSON.stringify(payload)}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const responseBody = await response.json();
  if (!response.ok || !responseBody?.success) {
    throw new Error(`Import call failed (${response.status}): ${JSON.stringify(responseBody)}`);
  }
  return responseBody.data as {
    runId: string;
    sourceHash?: string;
    dryRun: boolean;
    summary: { importedRows: number; failRows: number; generatedPolicyIds: string[] };
    evaluations: Array<{
      dto: { sourceId: string; policyRef: string; sourceRowNumber: number };
    }>;
    outputs: {
      importOutcomes: Array<{
        rowId: string;
        policyRef: string;
        sourceRowNumber: number;
        status:
          | 'imported'
          | 'already_imported'
          | 'failed_with_reason'
          | 'skipped'
          | 'deferred_waiting_for_prior_row'
          | 'blocked_existing_history'
          | 'blocked_prior_row_failed';
        reason?: string;
      }>;
    };
  };
}

async function runWithConcurrency<T>(items: T[], workers: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const runner = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      await fn(item);
    }
  };
  const slots = Array.from({ length: Math.max(1, workers) }, () => runner());
  await Promise.all(slots);
}

function resolveRetryRangesFromStage(previous: StageResult): Range[] {
  const rowNumbers = previous.failedRows.map((x) => x.sourceRowNumber);
  return rangesFromRowNumbers(rowNumbers, 1);
}

async function runStage(
  template: Template,
  stage: Stage,
  stageMap: Map<string, StageResult>
): Promise<StageResult> {
  const tokenName = template.authTokenEnv || 'BDX_AUTH_TOKEN';
  const resolveToken = async () => {
    const existing = process.env[tokenName];
    if (existing) return existing;
    const email = process.env.API_SMOKE_EMAIL;
    const password = process.env.API_SMOKE_PASSWORD;
    if (!email || !password) {
      throw new Error(`Missing auth token in environment variable ${tokenName}`);
    }
    const authUrl = template.endpoint.replace(/\/api\/policies\/imports\/bdx$/i, '/api/auth/login');
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const responseBody = await response.json();
    const token = String(responseBody?.data?.token || '').trim();
    if (!response.ok || !token) {
      throw new Error(`Failed to mint auth token from ${authUrl}`);
    }
    process.env[tokenName] = token;
    return token;
  };
  const token = await resolveToken();
  if (!token) {
    throw new Error(`Missing auth token in environment variable ${tokenName}`);
  }
  const uploadFromRunner = process.env.BDX_UPLOAD_FILE === 'true' || template.uploadFromRunner === true;
  let ranges: Range[] = [];
  if (stage.retryFailedFromStage) {
    const prior = stageMap.get(stage.retryFailedFromStage);
    if (!prior) {
      throw new Error(`retryFailedFromStage '${stage.retryFailedFromStage}' not found`);
    }
    ranges = resolveRetryRangesFromStage(prior);
  } else {
    const chainRowNumbers = rowNumbersFromPolicyChains(template, stage.policyChainKeys || []);
    const explicitRowRanges = rangesFromRowNumbers([...(stage.rowNumbers || []), ...chainRowNumbers], stage.batchSize);
    ranges = explicitRowRanges.length > 0
      ? explicitRowRanges
      : (stage.ranges || []).flatMap((range) => splitRange(range, stage.batchSize));
  }

  if (ranges.length === 0) {
    return {
      stage: stage.name,
      runId: '',
      sourceHash: undefined,
      dryRun: stage.dryRun,
      totalCalls: 0,
      totalRowsRequested: 0,
      importedRows: 0,
      failRows: 0,
      generatedPolicyIds: [],
      failedRows: [],
      callResults: [],
    };
  }

  const result: StageResult = {
    stage: stage.name,
    runId: '',
    sourceHash: undefined,
    dryRun: stage.dryRun,
    totalCalls: 0,
    totalRowsRequested: ranges.reduce((sum, r) => sum + (r.endRow - r.startRow + 1), 0),
    importedRows: 0,
    failRows: 0,
    generatedPolicyIds: [],
    failedRows: [],
    callResults: [],
  };

  await runWithConcurrency(ranges, stage.parallelWorkers, async (range) => {
    const payload = {
      ...(uploadFromRunner ? {} : { sourceFilePath: template.sourceFilePath }),
      dryRun: stage.dryRun,
      startRow: range.startRow,
      endRow: range.endRow,
      maxImports: stage.maxImports,
      ...(template.commonPayload || {}),
    };
    const data = await callImport({
      endpoint: template.endpoint,
      payload,
      token,
      uploadFilePath: uploadFromRunner ? template.sourceFilePath : undefined,
    });
    result.runId = data.runId || result.runId;
    result.sourceHash = data.sourceHash || result.sourceHash;
    result.totalCalls += 1;
    result.importedRows += Number(data.summary.importedRows || 0);
    result.failRows += Number(data.summary.failRows || 0);
    result.generatedPolicyIds.push(...(data.summary.generatedPolicyIds || []));
    result.callResults.push({
      range,
      importedRows: Number(data.summary.importedRows || 0),
      failRows: Number(data.summary.failRows || 0),
      generatedPolicyIds: [...(data.summary.generatedPolicyIds || [])],
    });
    const rowNumByOutcome = new Map<string, number>();
    for (const ev of data.evaluations || []) {
      rowNumByOutcome.set(`${ev.dto.sourceId}::${ev.dto.policyRef}::${ev.dto.sourceRowNumber}`, Number(ev.dto.sourceRowNumber || 0));
    }
    for (const outcome of data.outputs?.importOutcomes || []) {
      if (outcome.status === 'imported' || outcome.status === 'already_imported' || outcome.status === 'skipped') continue;
      const key = `${outcome.rowId}::${outcome.policyRef}::${outcome.sourceRowNumber}`;
      result.failedRows.push({
        rowId: outcome.rowId,
        policyRef: outcome.policyRef,
        sourceRowNumber: Number(rowNumByOutcome.get(key) || outcome.sourceRowNumber || 0),
        reason: `${String(outcome.status)}: ${String(outcome.reason || 'Unknown failure')}`,
      });
    }
    process.stdout.write(
      `[${stage.name}] ${range.startRow}-${range.endRow} imported=${data.summary.importedRows} fail=${data.summary.failRows}\n`
    );
  });

  result.failedRows = result.failedRows
    .filter((row) => Number.isFinite(row.sourceRowNumber) && row.sourceRowNumber > 0)
    .sort((a, b) => a.sourceRowNumber - b.sourceRowNumber);
  result.generatedPolicyIds = [...new Set(result.generatedPolicyIds)];
  return result;
}

async function writeArtifacts(outputDir: string, summary: StageResult[]) {
  await mkdir(outputDir, { recursive: true });
  const failedRows = summary.flatMap((s) =>
    s.failedRows.map((row) => ({
      stage: s.stage,
      runId: s.runId,
      sourceHash: s.sourceHash || '',
      sourceRowNumber: row.sourceRowNumber,
      rowId: row.rowId,
      policyRef: row.policyRef,
      reason: row.reason,
    }))
  );
  const allPolicyIds = [...new Set(summary.flatMap((s) => s.generatedPolicyIds))];
  const retryPayload = {
    rowNumbers: uniqueRowNumbers(failedRows.map((row) => Number(row.sourceRowNumber || 0))),
    failedCount: failedRows.length,
  };

  await Promise.all([
    writeFile(path.join(outputDir, 'stage-summary.json'), JSON.stringify(summary, null, 2), 'utf8'),
    writeFile(path.join(outputDir, 'failed-rows.json'), JSON.stringify(failedRows, null, 2), 'utf8'),
    writeFile(path.join(outputDir, 'failed-rows.csv'), toCsv(failedRows, [
      'stage',
      'runId',
      'sourceHash',
      'sourceRowNumber',
      'rowId',
      'policyRef',
      'reason',
    ]), 'utf8'),
    writeFile(path.join(outputDir, 'failed-rows-retry-payload.json'), JSON.stringify(retryPayload, null, 2), 'utf8'),
    writeFile(path.join(outputDir, 'imported-policy-ids.json'), JSON.stringify(allPolicyIds, null, 2), 'utf8'),
  ]);
}

async function main() {
  const templatePath = process.argv[2] || process.env.BDX_TEMPLATE_FILE_PATH || resolvePolicyDocumentPath('bdx-staged-load-template.json');
  const stageNameFilter = process.argv[3] || process.env.BDX_STAGE_FILTER || '';
  const outputDir = process.env.BDX_OUTPUT_DIR || `tmp/bdx-load-${Date.now()}`;
  const raw = await readFile(templatePath, 'utf8');
  const template = JSON.parse(raw) as Template;
  if (process.env.BDX_ENDPOINT) template.endpoint = process.env.BDX_ENDPOINT;
  if (process.env.BDX_SOURCE_FILE_PATH) template.sourceFilePath = process.env.BDX_SOURCE_FILE_PATH;
  if (process.env.BDX_AUTH_TOKEN_ENV) template.authTokenEnv = process.env.BDX_AUTH_TOKEN_ENV;
  const requestedStages = stageNameFilter
    ? new Set(stageNameFilter.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const stages = requestedStages
    ? template.stages.filter((stage) => requestedStages.has(stage.name))
    : template.stages;

  if (stages.length === 0) {
    throw new Error(`No stages found for filter '${stageNameFilter}'`);
  }

  const summary: StageResult[] = [];
  const stageMap = new Map<string, StageResult>();
  for (const stage of stages) {
    process.stdout.write(`\n== Running stage: ${stage.name} ==\n`);
    const stageResult = await runStage(template, stage, stageMap);
    summary.push(stageResult);
    stageMap.set(stage.name, stageResult);
  }
  process.stdout.write('\n== Stage Summary ==\n');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  await writeArtifacts(outputDir, summary);
  process.stdout.write(`\nArtifacts written to ${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
