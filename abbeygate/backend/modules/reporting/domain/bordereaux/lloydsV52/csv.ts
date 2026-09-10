// CSV serialiser for Lloyd's CRS v5.2 row dumps.
// The XLSX writer lives in the worker boundary
// (`backend/modules/reporting/infra/xlsx/writeBdxWorkbook.ts`).

export function rowsToCsv(rows: Record<string, unknown>[], headers?: string[]) {
  const hdrs = headers && headers.length ? headers : (rows[0] ? Object.keys(rows[0]) : []);
  if (hdrs.length === 0) return '';
  if (rows.length === 0) return hdrs.join(',');

  const csvEscape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [hdrs.join(',')];
  for (const r of rows) {
    lines.push(hdrs.map((h) => csvEscape(r[h])).join(','));
  }
  return lines.join('\n');
}
