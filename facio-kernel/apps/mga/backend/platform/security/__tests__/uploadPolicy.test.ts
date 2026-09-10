/* @vitest-environment node */
/**
 * uploadPolicy — diagnostic error contract for unsupported file types.
 *
 * ABBEYGATE-H: production Sentry event "Error: Unsupported file type"
 * at POST /api/public/documents/upload was unactionable because the
 * error payload didn't say which mime / extension was rejected or
 * what the allowlist was. This suite pins the new contract:
 *
 *   - Rejection message names the rejected mime/extension verbatim.
 *   - Rejection message lists the accepted formats.
 *   - Error is an `UnsupportedFileTypeError` with structured fields
 *     suitable for both Sentry tagging and FE rendering.
 *   - Behaviour is unchanged for accepted formats (no allowlist
 *     change as part of this commit — `no-defensive-fallbacks`).
 */
import { describe, expect, it } from 'vitest';
import {
  UnsupportedFileTypeError,
  createRestrictedMemoryUpload,
} from '../uploadPolicy';

type FilterCb = (err: Error | null, accept?: boolean) => void;
type Filter = (req: unknown, file: { mimetype?: string; originalname?: string }, cb: FilterCb) => void;
type MulterLike = { fileFilter?: Filter } & Record<string, unknown>;

function makeUpload(args?: Partial<Parameters<typeof createRestrictedMemoryUpload>[0]>) {
  return createRestrictedMemoryUpload({
    maxFileSizeBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
    allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
    ...(args || {}),
  }) as unknown as MulterLike;
}

function runFilter(
  upload: MulterLike,
  file: { mimetype?: string; originalname?: string },
): { err: Error | null; accepted: boolean } {
  const filter = upload.fileFilter;
  if (!filter) throw new Error('uploadPolicy did not configure a fileFilter');
  let captured: { err: Error | null; accepted: boolean } = { err: null, accepted: false };
  filter({}, file, (err, accept) => {
    captured = { err: err ?? null, accepted: Boolean(accept) };
  });
  return captured;
}

describe('createRestrictedMemoryUpload — unsupported file type diagnostic (ABBEYGATE-H)', () => {
  it('accepts a file when the mime is on the allowlist', () => {
    const result = runFilter(makeUpload(), { mimetype: 'image/png', originalname: 'photo.png' });
    expect(result.err).toBeNull();
    expect(result.accepted).toBe(true);
  });

  it('accepts a file when only the extension matches (mime missing)', () => {
    const result = runFilter(makeUpload(), { mimetype: '', originalname: 'photo.png' });
    expect(result.err).toBeNull();
    expect(result.accepted).toBe(true);
  });

  it('rejects an HEIC iPhone photo with a diagnostic error containing the rejected mime and the allowlist', () => {
    const result = runFilter(makeUpload(), { mimetype: 'image/heic', originalname: 'IMG_4321.heic' });
    expect(result.err).toBeInstanceOf(UnsupportedFileTypeError);
    const err = result.err as UnsupportedFileTypeError;
    expect(err.mime).toBe('image/heic');
    expect(err.extension).toBe('.heic');
    expect(err.message).toContain('image/heic');
    // Structured allowlist preserved on the error for Sentry tagging.
    expect(err.allowedMimeTypes).toContain('image/png');
    expect(err.allowedExtensions).toContain('.png');
    // Human-friendly message lists the accepted human formats so the
    // operator can self-correct without a support round-trip.
    expect(err.message).toContain('pdf');
    expect(err.message).toContain('png');
    expect(err.message).toContain('webp');
  });

  it('rejects a file with no metadata and still names what was attempted', () => {
    const result = runFilter(makeUpload(), { mimetype: '', originalname: 'no-extension' });
    expect(result.err).toBeInstanceOf(UnsupportedFileTypeError);
    const err = result.err as UnsupportedFileTypeError;
    // No mime, no extension — the message MUST NOT silently swallow
    // that case. It still names the missing metadata explicitly.
    expect(err.message).toContain('(no file metadata)');
  });

  it('case-folds the mime and extension before comparing (matches Express/multer convention)', () => {
    const result = runFilter(makeUpload(), { mimetype: 'IMAGE/PNG', originalname: 'PHOTO.PNG' });
    expect(result.err).toBeNull();
    expect(result.accepted).toBe(true);
  });
});
