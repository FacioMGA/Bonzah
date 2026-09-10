import PDFDocument from 'pdfkit';

export async function pdfToBuffer(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    try {
      // We need page buffering because some generators
      // apply footers at the end using doc.switchToPage(...).
      // Without buffering, PDFKit only keeps the current page and switchToPage
      // will throw "out of bounds".
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];

      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = String(dt.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function fmtTime(d: Date | string | null | undefined) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function fmtMoneyEUR(n: unknown) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '€0.00';
  return `€${v.toFixed(2)}`;
}
