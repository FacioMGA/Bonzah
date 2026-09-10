import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  CRS_V52_MOTOR_CLAIMS_COLUMNS,
  CRS_V52_MOTOR_PREMIUM_COLUMNS,
  CRS_V52_MOTOR_RISK_COLUMNS,
} from '../../backend/modules/reporting/domain/crsV52Motor.js';
import {
  CRS_V52_HOME_CLAIMS_COLUMNS,
  CRS_V52_HOME_PREMIUM_COLUMNS,
  CRS_V52_HOME_RISK_COLUMNS,
} from '../../backend/modules/reporting/domain/crsV52Home.js';
import {
  CRS_V52_TRAVEL_CLAIMS_COLUMNS,
  CRS_V52_TRAVEL_PREMIUM_COLUMNS,
  CRS_V52_TRAVEL_RISK_COLUMNS,
} from '../../backend/modules/reporting/domain/crsV52Travel.js';
import {
  homeManifest,
  motorManifest,
  travelManifest,
  type ProductManifest,
} from '../../packages/products/src/index.js';

type Stream = 'risk' | 'premium' | 'claims';

type LloydsStandard = {
  standardId: string;
  fieldCount: number;
  fields: Array<{ crCode: string }>;
};

type SlugCoverageRow = {
  productType: string;
  slug: string;
  label: string;
  required: boolean;
  source: string;
  classification: 'maps_to_cr' | 'not_crs_reportable';
  crCodes: string[];
};

type LineageRow = {
  productType: string;
  stream: Stream;
  crCode: string;
  lloydsTitle: string;
  internalKey: string;
  requiredness: string;
  applicability: string;
  sourceEntity: string;
  sourceField: string;
  sourcePath: string;
  sourceKind: string;
  authoritativeSource: string;
  derivationRule: string;
  fallbackRule: string;
  sourceReliability: string;
  validationRules: string;
  exampleValue: string;
  notes: string;
};

function csvEscape(value: string): string {
  if (/[,"\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function rowsToCsv(rows: LineageRow[]): string {
  const headers = [
    'productType',
    'stream',
    'crCode',
    'lloydsTitle',
    'internalKey',
    'requiredness',
    'applicability',
    'sourceEntity',
    'sourceField',
    'sourcePath',
    'sourceKind',
    'authoritativeSource',
    'derivationRule',
    'fallbackRule',
    'sourceReliability',
    'validationRules',
    'exampleValue',
    'notes',
  ] as const;
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(String(row[header] || ''))).join(','));
  }
  return lines.join('\n');
}

function collectRows(): LineageRow[] {
  const streams: Array<{ productType: string; stream: Stream; columns: Array<Record<string, unknown>> }> = [
    { productType: 'MOTOR', stream: 'risk', columns: CRS_V52_MOTOR_RISK_COLUMNS },
    { productType: 'MOTOR', stream: 'premium', columns: CRS_V52_MOTOR_PREMIUM_COLUMNS },
    { productType: 'MOTOR', stream: 'claims', columns: CRS_V52_MOTOR_CLAIMS_COLUMNS },
    { productType: 'HOME', stream: 'risk', columns: CRS_V52_HOME_RISK_COLUMNS },
    { productType: 'HOME', stream: 'premium', columns: CRS_V52_HOME_PREMIUM_COLUMNS },
    { productType: 'HOME', stream: 'claims', columns: CRS_V52_HOME_CLAIMS_COLUMNS },
    { productType: 'TRAVEL', stream: 'risk', columns: CRS_V52_TRAVEL_RISK_COLUMNS },
    { productType: 'TRAVEL', stream: 'premium', columns: CRS_V52_TRAVEL_PREMIUM_COLUMNS },
    { productType: 'TRAVEL', stream: 'claims', columns: CRS_V52_TRAVEL_CLAIMS_COLUMNS },
  ];
  const rows: LineageRow[] = [];
  for (const { productType, stream, columns } of streams) {
    for (const col of columns) {
      const field = col as Record<string, unknown>;
      rows.push({
        productType,
        stream,
        crCode: String(field.crCode || ''),
        lloydsTitle: String(field.title || ''),
        internalKey: String(field.key || ''),
        requiredness: String(field.requiredness || (field.required ? 'mandatory' : 'optional')),
        applicability: String(field.applicabilityKey || 'always'),
        sourceEntity: String(field.sourceEntity || ''),
        sourceField: String(field.sourceField || ''),
        sourcePath: String(field.sourcePath || ''),
        sourceKind: String(field.sourceKind || ''),
        authoritativeSource: String(Boolean(field.authoritativeSource)),
        derivationRule: String(field.derivationRule || ''),
        fallbackRule: String(field.fallbackRule || ''),
        sourceReliability: String(field.sourceReliability || ''),
        validationRules: [
          `requiredness:${String(field.requiredness || (field.required ? 'mandatory' : 'optional'))}`,
          `severity:${String(field.validationSeverity || '')}`,
          `applicability:${String(field.applicabilityKey || 'always')}`,
        ].join(';'),
        exampleValue: String(field.fallbackRule || ''),
        notes: [field.lloydsDefinition, field.plainEnglishNote].filter(Boolean).map((v) => String(v)).join(' | '),
      });
    }
  }
  return rows.sort((a, b) => {
    if (a.productType !== b.productType) return a.productType.localeCompare(b.productType);
    if (a.stream !== b.stream) return a.stream.localeCompare(b.stream);
    if (a.crCode !== b.crCode) return a.crCode.localeCompare(b.crCode);
    return a.internalKey.localeCompare(b.internalKey);
  });
}

async function readLloydsStandard(): Promise<LloydsStandard> {
  const path = resolve(process.cwd(), 'backend/modules/reporting/domain/standards/lloyds-v52-bdx.schema.json');
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as LloydsStandard;
}

function assertColumnsExistInStandard(rows: LineageRow[], standard: LloydsStandard): void {
  const standardCodes = new Set(standard.fields.map((field) => field.crCode).filter(Boolean));
  const missing = rows
    .map((row) => row.crCode)
    .filter(Boolean)
    .filter((crCode) => !standardCodes.has(crCode));
  if (missing.length > 0) {
    throw new Error(`Lloyd's V5.2 standard JSON is missing mapped CR codes: ${Array.from(new Set(missing)).sort().join(', ')}`);
  }
}

function collectManifestFields(productType: string, manifest: ProductManifest): SlugCoverageRow[] {
  const rows: SlugCoverageRow[] = [];
  const addField = (source: string, field: { path: string; label: string; required?: boolean }) => {
    rows.push({
      productType,
      slug: field.path,
      label: field.label,
      required: Boolean(field.required),
      source,
      classification: 'not_crs_reportable',
      crCodes: [],
    });
  };
  for (const field of manifest.insuredObject.fields) addField('manifest.insuredObject', field);
  for (const section of manifest.questionnaire.sections) {
    for (const field of section.fields) addField(`manifest.questionnaire.${section.id}`, field);
  }
  for (const path of manifest.summaryFields.titlePaths) {
    addField('manifest.summaryFields.titlePaths', { path, label: path });
  }
  for (const path of manifest.summaryFields.subtitlePaths) {
    addField('manifest.summaryFields.subtitlePaths', { path, label: path });
  }
  if (manifest.summaryFields.insuredValuePath) {
    addField('manifest.summaryFields.insuredValuePath', {
      path: manifest.summaryFields.insuredValuePath,
      label: manifest.summaryFields.insuredValuePath,
    });
  }
  return rows;
}

function collectSlugCoverage(rows: LineageRow[]): SlugCoverageRow[] {
  const bySlug = new Map<string, Set<string>>();
  for (const row of rows) {
    const sourcePath = row.sourcePath.replace(/^\$\./, '');
    if (!sourcePath || !row.crCode) continue;
    const bucket = bySlug.get(sourcePath) || new Set<string>();
    bucket.add(row.crCode);
    bySlug.set(sourcePath, bucket);
  }

  return [
    ...collectManifestFields('MOTOR', motorManifest),
    ...collectManifestFields('HOME', homeManifest),
    ...collectManifestFields('TRAVEL', travelManifest),
  ].map((row) => {
    const crCodes = Array.from(bySlug.get(row.slug) || []).sort();
    return crCodes.length
      ? { ...row, classification: 'maps_to_cr' as const, crCodes }
      : row;
  }).sort((a, b) => (
    a.productType.localeCompare(b.productType)
    || a.slug.localeCompare(b.slug)
    || a.source.localeCompare(b.source)
  ));
}

async function writeOrCheck(path: string, content: string, check: boolean) {
  if (!check) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    return;
  }
  const existing = await readFile(path, 'utf8').catch(() => '');
  if (existing !== content) {
    throw new Error(`Artifact drift detected: ${path}`);
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const standard = await readLloydsStandard();
  const rows = collectRows();
  assertColumnsExistInStandard(rows, standard);
  const spec = {
    specVersion: 'lloyds-v52-products-1',
    standardId: standard.standardId,
    standardFieldCount: standard.fieldCount,
    products: {
      MOTOR: {
        risk: CRS_V52_MOTOR_RISK_COLUMNS,
        premium: CRS_V52_MOTOR_PREMIUM_COLUMNS,
        claims: CRS_V52_MOTOR_CLAIMS_COLUMNS,
      },
      HOME: {
        risk: CRS_V52_HOME_RISK_COLUMNS,
        premium: CRS_V52_HOME_PREMIUM_COLUMNS,
        claims: CRS_V52_HOME_CLAIMS_COLUMNS,
      },
      TRAVEL: {
        risk: CRS_V52_TRAVEL_RISK_COLUMNS,
        premium: CRS_V52_TRAVEL_PREMIUM_COLUMNS,
        claims: CRS_V52_TRAVEL_CLAIMS_COLUMNS,
      },
    },
    rows,
  };
  const csvPath = resolve(process.cwd(), 'docs/architecture/baselines/lloyds-v52-motor-lineage.csv');
  const jsonPath = resolve(process.cwd(), 'docs/architecture/baselines/lloyds-v52-motor-spec.json');
  const premiumRows = rows.filter((row) => row.productType === 'MOTOR' && row.stream === 'premium');
  const premiumCsvPath = resolve(process.cwd(), 'docs/architecture/baselines/lloyds-v52-motor-premium-lineage.csv');
  const premiumJsonPath = resolve(process.cwd(), 'docs/architecture/baselines/lloyds-v52-motor-premium-spec.json');
  const slugCoverage = collectSlugCoverage(rows);
  const slugCoveragePath = resolve(process.cwd(), 'docs/architecture/baselines/lloyds-v52-product-slug-coverage.json');

  await writeOrCheck(csvPath, `${rowsToCsv(rows)}\n`, check);
  await writeOrCheck(jsonPath, `${JSON.stringify(spec, null, 2)}\n`, check);
  await writeOrCheck(premiumCsvPath, `${rowsToCsv(premiumRows)}\n`, check);
  await writeOrCheck(premiumJsonPath, `${JSON.stringify({
    specVersion: spec.specVersion,
    stream: 'premium',
    columns: CRS_V52_MOTOR_PREMIUM_COLUMNS,
    rows: premiumRows,
  }, null, 2)}\n`, check);
  await writeOrCheck(slugCoveragePath, `${JSON.stringify({
    standardId: standard.standardId,
    rows: slugCoverage,
  }, null, 2)}\n`, check);
  if (!check) {
    process.stdout.write(`Generated artifacts:\n- ${csvPath}\n- ${jsonPath}\n- ${premiumCsvPath}\n- ${premiumJsonPath}\n- ${slugCoveragePath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

