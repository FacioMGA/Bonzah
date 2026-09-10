import path from 'node:path';
import multer from 'multer';

function normalizedExt(filename: string): string {
  return path.extname(String(filename || '')).toLowerCase();
}

function toLowerSet(values: string[]): Set<string> {
  return new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

/**
 * Unsupported-file-type error.
 *
 * Carries the rejected mime + extension AND the allowlist verbatim so:
 *
 *   - UI surfaces can render an actionable message (e.g. "Cannot accept
 *     `image/heic`. Accepted formats: pdf, png, jpg, jpeg, webp, docx.")
 *     instead of the bare "Unsupported file type" Sentry-noise message
 *     that triggered ABBEYGATE-H — operators couldn't tell which format
 *     was rejected or what to upload instead.
 *   - Sentry events become self-diagnosing: the next event's
 *     `error.value` includes the rejected mime/ext and the
 *     allowlist, so the next allowlist-expansion decision is data-
 *     driven (we know exactly what was tried).
 *
 * Per `no-defensive-fallbacks` the error still fails closed — we do
 * NOT silently accept formats that aren't on the allowlist. The only
 * change is that the failure carries diagnostic detail with it.
 */
export class UnsupportedFileTypeError extends Error {
  readonly mime: string;
  readonly extension: string;
  readonly allowedMimeTypes: ReadonlyArray<string>;
  readonly allowedExtensions: ReadonlyArray<string>;
  constructor(args: {
    mime: string;
    extension: string;
    allowedMimeTypes: ReadonlyArray<string>;
    allowedExtensions: ReadonlyArray<string>;
  }) {
    const acceptedHuman = [...args.allowedExtensions]
      .map((ext) => ext.replace(/^\./, ''))
      .filter(Boolean);
    const seen = args.mime || args.extension || '(no file metadata)';
    super(
      `Unsupported file type "${seen}". Accepted formats: ${
        acceptedHuman.length > 0 ? acceptedHuman.join(', ') : '(none configured)'
      }.`,
    );
    this.name = 'UnsupportedFileTypeError';
    this.mime = args.mime;
    this.extension = args.extension;
    this.allowedMimeTypes = args.allowedMimeTypes;
    this.allowedExtensions = args.allowedExtensions;
  }
}

export function createRestrictedMemoryUpload(args: {
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maxFiles?: number;
}) {
  const allowedMimeTypes = toLowerSet(args.allowedMimeTypes);
  const allowedExtensions = toLowerSet(args.allowedExtensions);
  const allowedMimeList = [...allowedMimeTypes];
  const allowedExtList = [...allowedExtensions];
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.max(1, Math.floor(args.maxFileSizeBytes)),
      files: Math.max(1, Math.floor(args.maxFiles || 1)),
    },
    fileFilter: (_req, file, cb) => {
      const mime = String(file.mimetype || '').toLowerCase();
      const ext = normalizedExt(file.originalname || '');
      if (!allowedMimeTypes.has(mime) && !allowedExtensions.has(ext)) {
        cb(
          new UnsupportedFileTypeError({
            mime,
            extension: ext,
            allowedMimeTypes: allowedMimeList,
            allowedExtensions: allowedExtList,
          }),
        );
        return;
      }
      cb(null, true);
    },
  });
}
