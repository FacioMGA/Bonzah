import { describe, expect, it } from 'vitest';
import { uploadBinderAgreementUseCase } from './uploadBinderAgreement.js';

describe('uploadBinderAgreementUseCase', () => {
  it('returns 400 when file is missing', async () => {
    const result = await uploadBinderAgreementUseCase(
      {
        file: null,
        actor: { actorId: 'u1', actorType: 'USER' },
        env: {},
      },
      {
        parser: {
          async parsePdf() {
            return { text: '' };
          },
          async recognizeImage() {
            return { text: '' };
          },
        },
        storage: {
          async uploadFile() {
            return { filename: 'x', url: 'y' };
          },
        },
        repo: {
          async createBinder() {
            return { id: 'b1', agreementNumber: 'AG', umr: 'UMR' };
          },
          async createBinderDocument() {},
          async createBinderClause() {},
        },
        audit: {
          async logUploadedAndParsed() {},
        },
        logger: {
          info() {},
          error() {},
        },
      }
    );

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ success: false, error: 'No file uploaded' });
  });

  it('returns OCR_FAILED when OCR throws', async () => {
    const result = await uploadBinderAgreementUseCase(
      {
        file: {
          originalname: 'doc.png',
          mimetype: 'image/png',
          size: 1,
          buffer: Buffer.from('x'),
        },
        actor: { actorId: 'u1', actorType: 'USER' },
        env: {},
      },
      {
        parser: {
          async parsePdf() {
            return { text: '' };
          },
          async recognizeImage() {
            throw new Error('ocr boom');
          },
        },
        storage: {
          async uploadFile() {
            return { filename: 'x', url: 'y' };
          },
        },
        repo: {
          async createBinder() {
            return { id: 'b1', agreementNumber: 'AG', umr: 'UMR' };
          },
          async createBinderDocument() {},
          async createBinderClause() {},
        },
        audit: {
          async logUploadedAndParsed() {},
        },
        logger: {
          info() {},
          error() {},
        },
      }
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      success: false,
      error: {
        code: 'OCR_FAILED',
        message: 'OCR Processing Failed: ocr boom',
      },
    });
  });
});
