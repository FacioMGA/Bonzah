import path from 'path';
import fs from 'fs';
import SVGtoPDF from 'svg-to-pdfkit';
import { fmtDate } from './pdfUtils.js';
import { buildDefaultProductKit } from '../../programs/domain/productKit/productKit.js';

export const COLORS = {
  ABBEY_BLUE: '#1e3a8a',
  SLATE_900: '#0f172a',
  SLATE_600: '#475569',
  SLATE_400: '#94a3b8',
  BG_LIGHT: '#f8fafc',
  RED_ALERT: '#dc2626',
};

export const FONTS = {
  BOLD: 'Helvetica-Bold',
  REGULAR: 'Helvetica',
};

const MARGIN_X = 50;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function getAssetPath(filename: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'src/abbeygate/src/assets', filename),
    path.resolve(process.cwd(), '../src/abbeygate/src/assets', filename),
    path.resolve(process.cwd(), 'client/src/assets', filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function drawHeader(doc: PDFKit.PDFDocument, docTitle: string, subTitle?: string): number {
  const headerTop = 40;
  const logoAbbeygate = getAssetPath('abbeygateLogo.svg');
  if (logoAbbeygate) {
    const svgContent = fs.readFileSync(logoAbbeygate, 'utf-8');
    SVGtoPDF(doc, svgContent, MARGIN_X, headerTop, { preserveAspectRatio: 'xMinYMin meet', height: 35, width: 140 });
  } else {
    doc.font(FONTS.BOLD).fontSize(18).fillColor(COLORS.ABBEY_BLUE).text('Abbeygate', MARGIN_X, headerTop);
  }

  const logoLloyds = getAssetPath('lloyds.png');
  const lloydsWidth = 90;
  const lloydsX = PAGE_WIDTH - MARGIN_X - lloydsWidth - 5;
  if (logoLloyds) {
    doc.image(logoLloyds, lloydsX, headerTop + 5, { width: lloydsWidth });
  } else {
    doc.fontSize(10).fillColor(COLORS.SLATE_600).text('Lloyd’s Coverholder', lloydsX, headerTop + 10, { align: 'right', width: lloydsWidth });
  }

  const titleY = headerTop + 55;
  doc.font(FONTS.BOLD).fontSize(14).fillColor(COLORS.SLATE_900).text(docTitle.toUpperCase(), MARGIN_X, titleY);
  if (subTitle) {
    doc.fontSize(10).fillColor(COLORS.RED_ALERT).text(subTitle, MARGIN_X, titleY + 18);
    return titleY + 35;
  }
  return titleY + 25;
}

export function applyGlobalFooters(doc: PDFKit.PDFDocument, refNumber: string) {
  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  const footerStatement = buildDefaultProductKit().brand.coverholderStatement;

  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(range.start + i);
    doc.moveTo(MARGIN_X, 730).lineTo(PAGE_WIDTH - MARGIN_X, 730).strokeColor(COLORS.SLATE_400).lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor(COLORS.SLATE_400);
    doc.text(footerStatement, MARGIN_X, 740, { align: 'center', width: CONTENT_WIDTH });
    doc.text(`Ref: ${refNumber} | Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} | Page ${i + 1} of ${totalPages}`, MARGIN_X, 750, { align: 'center', width: CONTENT_WIDTH });
  }
}

export function drawSectionHeader(doc: PDFKit.PDFDocument, text: string, y: number): number {
  doc.font(FONTS.BOLD).fontSize(11).fillColor(COLORS.ABBEY_BLUE).text(text.toUpperCase(), MARGIN_X, y);
  doc.moveTo(MARGIN_X, y + 14).lineTo(PAGE_WIDTH - MARGIN_X, y + 14).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  return y + 24;
}

export function drawTableRow(doc: PDFKit.PDFDocument, y: number, cols: { text: string; x: number; width: number; align?: string; isBold?: boolean }[], isHeader = false) {
  if (isHeader) {
    doc.rect(MARGIN_X, y - 4, CONTENT_WIDTH, 18).fill(COLORS.BG_LIGHT);
  }
  cols.forEach((col) => {
    const align: 'left' | 'center' | 'right' | 'justify' = col.align === 'center' || col.align === 'right' || col.align === 'justify' ? col.align : 'left';
    doc.font(col.isBold || isHeader ? FONTS.BOLD : FONTS.REGULAR).fontSize(9).fillColor(isHeader ? COLORS.SLATE_900 : COLORS.SLATE_600).text(col.text, col.x, y, { width: col.width, align });
  });
  doc.moveTo(MARGIN_X, y + 14).lineTo(PAGE_WIDTH - MARGIN_X, y + 14).strokeColor(COLORS.SLATE_400).lineWidth(0.25).stroke();
  return y + 20;
}

export { fmtDate };
