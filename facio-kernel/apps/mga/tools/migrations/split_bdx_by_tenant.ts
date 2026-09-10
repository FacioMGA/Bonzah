/**
 * Split a mixed-jurisdiction BDX workbook into per-tenant workbooks.
 *
 * The BDX import spine (tools/migrations/bdx-import-runner.mjs) imports every
 * row of a file under a single `tenantSlug`; it does NOT route rows by country.
 * A combined book that mixes jurisdictions (e.g. the July-26 home book that
 * carries Cyprus, Portugal, Greece and Spain risks on one sheet) must therefore
 * be split BEFORE import so each per-tenant file can be imported under its own
 * tenant with the correct tax jurisdiction, binder authority and portal domain.
 *
 * Routing key: "Location of risk - Country" (the property/risk jurisdiction),
 * with "Insured Country" / "Risk Country" only as explicit fallbacks. A row
 * whose country cannot be resolved is a HARD ERROR — we never silently drop or
 * default it (see .cursor/skills/no-defensive-fallbacks).
 *
 * Countries not in the include map are reported and excluded by design
 * (Spain is excluded from the go-live scope per the operator decision).
 *
 * Output files are written under --out and contain policyholder PII, so keep
 * them in the gitignored artifacts tree.
 *
 * Usage:
 *   npx tsx tools/migrations/split_bdx_by_tenant.ts \
 *     --source artifacts/bdx-import-july-26/Book11.xlsx \
 *     --out artifacts/bdx-import-july-26/split
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

type Cell = string | number | boolean | Date | null;
type Matrix = Cell[][];

/** Countries included in the go-live scope, mapped to their tenant slug. */
export const COUNTRY_TENANT_MAP: Record<string, string> = {
  cyprus: 'abbeygate-cy',
  portugal: 'abbeygate-pt',
  greece: 'abbeygate-gr',
};

/** Countries deliberately excluded from the go-live import scope. */
export const EXCLUDED_COUNTRIES = new Set(['spain']);

const COUNTRY_HEADER_PRIORITY = [
  'Location of risk - Country',
  'Risk Country',
  'Insured Country (see code list)',
];

/** Number of header/spacer rows preserved verbatim at the top of the sheet. */
const HEADER_ROW_COUNT = 3; // row 0 + row 1 (two-line header) + row 2 (blank)

function normalizeCountry(value: Cell): string {
  return String(value ?? '').trim().toLowerCase();
}

function isBlankRow(row: Cell[] | undefined): boolean {
  if (!row) return true;
  return !row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
}

function mergeHeaderName(matrix: Matrix, colIndex: number): string {
  const parts = [matrix[0]?.[colIndex], matrix[1]?.[colIndex]]
    .map((c) => String(c ?? '').trim())
    .filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Resolve the column index used to route a row to a jurisdiction. */
export function resolveCountryColumns(matrix: Matrix): number[] {
  const width = Math.max(...matrix.slice(0, 2).map((r) => r.length), 0);
  const headerByCol = new Map<string, number>();
  for (let i = 0; i < width; i += 1) headerByCol.set(mergeHeaderName(matrix, i), i);
  const cols: number[] = [];
  for (const name of COUNTRY_HEADER_PRIORITY) {
    const idx = headerByCol.get(name);
    if (typeof idx === 'number') cols.push(idx);
  }
  if (cols.length === 0) {
    throw new Error(
      `Could not locate a country column. Expected one of: ${COUNTRY_HEADER_PRIORITY.join(', ')}`,
    );
  }
  return cols;
}

export type PartitionResult = {
  headerRows: Matrix;
  byTenant: Map<string, Matrix>;
  excludedByCountry: Record<string, number>;
  totalDataRows: number;
};

/**
 * Partition the workbook matrix into per-tenant matrices (header rows + that
 * jurisdiction's data rows). Pure function — no IO — so it is unit-testable.
 */
export function partitionByTenant(matrix: Matrix): PartitionResult {
  if (matrix.length <= HEADER_ROW_COUNT) {
    throw new Error(`Workbook has no data rows (only ${matrix.length} rows).`);
  }
  const countryCols = resolveCountryColumns(matrix);
  const headerRows = matrix.slice(0, HEADER_ROW_COUNT);
  const byTenant = new Map<string, Matrix>();
  const excludedByCountry: Record<string, number> = {};
  let totalDataRows = 0;

  for (let r = HEADER_ROW_COUNT; r < matrix.length; r += 1) {
    const row = matrix[r]!;
    if (isBlankRow(row)) continue;
    totalDataRows += 1;

    let country = '';
    for (const col of countryCols) {
      country = normalizeCountry(row[col]);
      if (country) break;
    }
    if (!country) {
      throw new Error(
        `Row ${r + 1}: could not resolve a country from columns ${countryCols.join(', ')}. ` +
          `Refusing to guess a jurisdiction.`,
      );
    }

    const slug = COUNTRY_TENANT_MAP[country];
    if (!slug) {
      if (!EXCLUDED_COUNTRIES.has(country)) {
        throw new Error(
          `Row ${r + 1}: country '${country}' is neither in the include map ` +
            `(${Object.keys(COUNTRY_TENANT_MAP).join(', ')}) nor explicitly excluded ` +
            `(${[...EXCLUDED_COUNTRIES].join(', ')}). Investigate before importing.`,
        );
      }
      excludedByCountry[country] = (excludedByCountry[country] || 0) + 1;
      continue;
    }

    if (!byTenant.has(slug)) byTenant.set(slug, [...headerRows.map((h) => [...h])]);
    byTenant.get(slug)!.push(row);
  }

  return { headerRows, byTenant, excludedByCountry, totalDataRows };
}

function toStringCell(value: Cell): { type: StringConstructor; value: string } | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { type: String, value: value.toISOString().slice(0, 10) };
  }
  const raw = String(value);
  if (raw.trim() === '') return null;
  return { type: String, value: raw };
}

function matrixToCells(matrix: Matrix): Array<Array<{ type: StringConstructor; value: string } | null>> {
  const width = Math.max(...matrix.map((r) => r.length), 0);
  return matrix.map((row) => {
    const cells: Array<{ type: StringConstructor; value: string } | null> = [];
    for (let i = 0; i < width; i += 1) cells.push(toStringCell(row[i] ?? null));
    return cells;
  });
}

function parseArgs(argv: string[]): { source: string; out: string } {
  let source = 'artifacts/bdx-import-july-26/Book11.xlsx';
  let out = 'artifacts/bdx-import-july-26/split';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') source = String(argv[++i] || '');
    else if (argv[i] === '--out') out = String(argv[++i] || '');
    else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write(
        'Usage: npx tsx tools/migrations/split_bdx_by_tenant.ts --source <file.xlsx> --out <dir>\n',
      );
      process.exit(0);
    }
  }
  return { source, out };
}

async function main() {
  const { source, out } = parseArgs(process.argv.slice(2));
  const buffer = await fs.readFile(source);
  const workbook = await readXlsxFile(buffer);
  const matrix = (workbook[0]?.data || []) as Matrix;

  const result = partitionByTenant(matrix);
  await fs.mkdir(out, { recursive: true });

  const summary: Array<{ tenant: string; file: string; dataRows: number }> = [];
  for (const [slug, tenantMatrix] of result.byTenant) {
    const dataRows = tenantMatrix.length - HEADER_ROW_COUNT;
    const file = path.join(out, `${slug}.xlsx`);
    await writeXlsxFile(matrixToCells(tenantMatrix), { filePath: file });
    summary.push({ tenant: slug, file, dataRows });
  }

  process.stdout.write('[split-bdx] source: ' + source + '\n');
  process.stdout.write('[split-bdx] total data rows: ' + result.totalDataRows + '\n');
  for (const s of summary.sort((a, b) => b.dataRows - a.dataRows)) {
    process.stdout.write(`[split-bdx]   ${s.tenant}: ${s.dataRows} rows -> ${s.file}\n`);
  }
  const excluded = Object.entries(result.excludedByCountry);
  if (excluded.length > 0) {
    process.stdout.write(
      '[split-bdx] excluded (by design): ' +
        excluded.map(([c, n]) => `${c}=${n}`).join(' ') +
        '\n',
    );
  }
  const routed = summary.reduce((acc, s) => acc + s.dataRows, 0);
  const excludedTotal = excluded.reduce((acc, [, n]) => acc + n, 0);
  process.stdout.write(
    `[split-bdx] reconciliation: routed=${routed} + excluded=${excludedTotal} = ${routed + excludedTotal} (expected ${result.totalDataRows})\n`,
  );
  if (routed + excludedTotal !== result.totalDataRows) {
    throw new Error('Row reconciliation failed: routed + excluded != total data rows.');
  }
}

// Only run when invoked directly (keeps exports importable by tests).
if (process.argv[1] && process.argv[1].endsWith('split_bdx_by_tenant.ts')) {
  main().catch((err) => {
    process.stderr.write(`[split-bdx] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
