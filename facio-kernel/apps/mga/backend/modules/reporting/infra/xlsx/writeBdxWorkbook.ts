import writeXlsxFile from 'write-excel-file/node';
import { bdxCellTypeForHeader, type BordereauxStream, type BdxCellType } from './bdxTypedCells.js';

type RowRecord = Record<string, unknown>;

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const dmyMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch;
    const dmyDate = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    if (!Number.isNaN(dmyDate.getTime())) return dmyDate;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function valueForType(value: unknown, type: BdxCellType): string | number | Date | undefined {
  if (type === 'date') return parseDate(value);
  if (type === 'number') return parseNumber(value);
  const raw = value === null || value === undefined ? '' : String(value);
  return raw;
}

function jsTypeFor(type: BdxCellType): StringConstructor | NumberConstructor | DateConstructor {
  if (type === 'date') return Date;
  if (type === 'number') return Number;
  return String;
}

function inferCellType(rows: RowRecord[], header: string, configuredType: BdxCellType): BdxCellType {
  if (configuredType !== 'string') return configuredType;
  const sample = rows.map((row) => row[header]).find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  if (typeof sample === 'number' && Number.isFinite(sample)) return 'number';
  if (sample instanceof Date || parseDate(sample)) return 'date';
  return configuredType;
}

export async function writeBdxWorkbookBuffer(args: {
  stream: BordereauxStream;
  rows: RowRecord[];
  headers: string[];
  sheetName: string;
}): Promise<Buffer> {
  const schema = args.headers.map((header) => {
    const configuredType = bdxCellTypeForHeader(args.stream, header);
    const cellType = inferCellType(args.rows, header, configuredType);
    return {
      column: header,
      type: jsTypeFor(cellType),
      value: (row: RowRecord) => valueForType(row[header], cellType),
    };
  });
  return writeXlsxFile(args.rows, {
    schema,
    sheet: args.sheetName,
    dateFormat: 'dd/mm/yyyy',
    buffer: true,
  });
}
