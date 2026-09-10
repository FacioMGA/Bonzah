type PdfRendererModule = typeof import('../../../products/motor/documents/pdfRenderer.js');

const pdfRendererModule: PdfRendererModule = await import('../../../products/motor/documents/pdfRenderer.js');

export function loadTemplate(
  ...args: Parameters<PdfRendererModule['loadTemplate']>
): ReturnType<PdfRendererModule['loadTemplate']> {
  return pdfRendererModule.loadTemplate(...args);
}

export function renderHtmlToPdf(
  ...args: Parameters<PdfRendererModule['renderHtmlToPdf']>
): ReturnType<PdfRendererModule['renderHtmlToPdf']> {
  return pdfRendererModule.renderHtmlToPdf(...args);
}

export function closePdfBrowser(
  ...args: Parameters<PdfRendererModule['closePdfBrowser']>
): ReturnType<PdfRendererModule['closePdfBrowser']> {
  return pdfRendererModule.closePdfBrowser(...args);
}
