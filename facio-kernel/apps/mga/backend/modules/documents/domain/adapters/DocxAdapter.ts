import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { routeEventToQueue } from '../../app/queueGateway.js';
import { storageService } from '../../app/storageGateway.js';

function sha256(buf: Buffer) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export type DocxRenderRequest = {
  policyId: string;
  riskTransactionId?: string | null;
  docPack?: string | null;
  type: string;
  displayFilename: string; // human-readable
  templatePath: string; // relative to repo or absolute
  data: Record<string, unknown>;
  source: 'CUSTOMER' | 'BO' | 'SYSTEM';
  generatedByUserId?: string | null;
  templateVersion?: string | null;
  // When true, enqueue docx->pdf conversion (async).
  queuePdfConversion?: boolean;
  // Type for the resulting PDF document row.
  pdfType?: string;
};

type DocxDocumentCreateArgs = {
  data: {
    policyId: string;
    riskTransactionId: string | null;
    type: string;
    docPack: string | null;
    status: 'GENERATED';
    templateVersion: string | null;
    generatedByUserId: string | null;
    source: 'CUSTOMER' | 'BO' | 'SYSTEM';
    generatedAt: Date;
    storageUri: string;
    filename: string;
    fileHash: string;
  };
};

type DocxDocumentRow = {
  id: string;
  storageUri: string;
  filename: string;
};

// Minimal structural type for the DB client used by DocxAdapter.
export type DocxDbClient = {
  document: {
    create: (args: DocxDocumentCreateArgs) => Promise<DocxDocumentRow>;
  };
};

export class DocxAdapter {
  static async renderDocx(req: DocxRenderRequest, db: DocxDbClient) {
    const templateAbs = path.isAbsolute(req.templatePath)
      ? req.templatePath
      : path.resolve(process.cwd(), req.templatePath);

    if (!fs.existsSync(templateAbs)) {
      throw new Error(`DOCX template not found: ${templateAbs}`);
    }
    const st = fs.statSync(templateAbs);
    if (!st || st.size === 0) {
      throw new Error(`DOCX template is empty: ${templateAbs}`);
    }

    const content = fs.readFileSync(templateAbs, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(req.data || {});
    const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    const hash = sha256(buf);

    const uploaded = await storageService.uploadFile(buf, req.displayFilename, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const row = await db.document.create({
      data: {
        policyId: req.policyId,
        riskTransactionId: req.riskTransactionId || null,
        type: req.type,
        docPack: req.docPack || null,
        status: 'GENERATED',
        templateVersion: req.templateVersion || null,
        generatedByUserId: req.generatedByUserId || null,
        source: req.source,
        generatedAt: new Date(),
        storageUri: uploaded.url,
        // For DOCX flows, we store the *storage filename* here so the async converter
        // can locate it when STORAGE_PROVIDER=local (and parse it for Azure blobs).
        filename: uploaded.filename,
        fileHash: hash,
      },
    });

    if (req.queuePdfConversion) {
      await routeEventToQueue('DOC.DOCX_TO_PDF', {
        sourceDocumentId: row.id,
        sourceStorageUri: row.storageUri,
        sourceFilename: row.filename,
        targetType: req.pdfType || `${req.type}_PDF`,
        policyId: req.policyId,
        riskTransactionId: req.riskTransactionId || null,
        docPack: req.docPack || null,
        templateVersion: req.templateVersion || null,
        generatedByUserId: req.generatedByUserId || null,
        source: req.source,
      });
    }

    return row;
  }
}

