import { storageService } from '../../../../platform/storage/service.js';
import type { DocumentStorageGatewayPort } from '../../app/read/emailPolicyDocumentsUseCase.js';

function extractLocalStorageFilename(storageUri: string): string | null {
  const match = String(storageUri || '').match(/^\/api\/documents\/([^/?#]+)$/);
  return match?.[1] || null;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export function buildDocumentStorageGateway(): DocumentStorageGatewayPort {
  return {
    async fetchPdfBufferFromStorageUri(storageUri: string): Promise<Buffer | null> {
      const uri = String(storageUri || '').trim();
      if (!uri) return null;
      if (/^https?:\/\//i.test(uri)) {
        const response = await fetch(uri);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
      const localFilename = extractLocalStorageFilename(uri);
      if (!localFilename) return null;
      const stream = await storageService.getFileStream(localFilename);
      if (!stream) return null;
      return streamToBuffer(stream);
    },
  };
}
