import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CommunicationAttachmentRef } from '../../domain/types.js';

const ADAPTER_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(ADAPTER_DIR, 'static');

const TERMS_ATTACHMENTS: Readonly<Record<string, { filename: string; staticFilename: string }>> = {
  CY: {
    filename: 'TermsAndConditionsCyprus.pdf',
    staticFilename: 'TermsAndConditions_CY.pdf',
  },
  PT: {
    filename: 'TermsAndConditionsPortugal.pdf',
    staticFilename: 'TermsAndConditions_PT.pdf',
  },
};

const contentCache = new Map<string, string>();

function readPdfBase64(staticFilename: string): string {
  const cached = contentCache.get(staticFilename);
  if (cached) return cached;
  const contentBase64 = fs.readFileSync(path.join(STATIC_DIR, staticFilename)).toString('base64');
  contentCache.set(staticFilename, contentBase64);
  return contentBase64;
}

export function getTenantTermsAttachment(countryCode: string): CommunicationAttachmentRef | null {
  const config = TERMS_ATTACHMENTS[String(countryCode || '').trim().toUpperCase()];
  if (!config) return null;
  const contentBase64 = readPdfBase64(config.staticFilename);
  return {
    filename: config.filename,
    mimetype: 'application/pdf',
    size: Buffer.byteLength(contentBase64, 'base64'),
    contentBase64,
  };
}
