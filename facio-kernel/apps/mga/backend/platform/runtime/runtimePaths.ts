import fs from 'fs';
import path from 'path';

const DEFAULT_RUNTIME_ROOT = path.resolve(process.cwd(), '..', 'facio-runtime');
const DEFAULT_OPERATOR_ROOT = path.resolve(process.cwd(), '..', 'facio-operator-data');

export function resolveUploadsDir(): string {
  return process.env.FACIO_UPLOADS_DIR
    ? path.resolve(process.env.FACIO_UPLOADS_DIR)
    : path.join(DEFAULT_RUNTIME_ROOT, 'uploads');
}

export function resolvePolicyDocumentsDir(): string {
  return process.env.FACIO_POLICY_DOCS_DIR
    ? path.resolve(process.env.FACIO_POLICY_DOCS_DIR)
    : path.join(DEFAULT_OPERATOR_ROOT, 'policy-documents');
}

export function resolvePolicyDocumentPath(filename: string): string {
  return path.join(resolvePolicyDocumentsDir(), filename);
}

export function ensureUploadsDirReady(): string {
  const uploadsDir = resolveUploadsDir();
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.accessSync(uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
  return uploadsDir;
}

