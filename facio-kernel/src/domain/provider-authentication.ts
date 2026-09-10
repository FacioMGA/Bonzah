import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { id } from '../contracts/primitives.js';
import type { ProviderAuthentication } from '../contracts/provider.js';
import { hash, KernelError } from './canonical.js';

export type ProviderHeaders = Readonly<Record<string, string | undefined>>;
export type ProviderVerification = {
  authentication: ProviderAuthentication;
  /** Server-derived identifier; persisted atomically with a newly accepted receipt. */
  nonceKey?: string;
};
export type ProviderVerifier = (
  body: Uint8Array,
  headers: ProviderHeaders,
  now: string,
) => ProviderVerification;

/**
 * Registered server seam. Protocol: HMAC-SHA256(timestamp + '.' + nonce + '.' + exact body).
 * Timestamp is canonical Unix seconds; headers are x-provider-timestamp/nonce/signature.
 * Storage must retain nonceKey with the accepted receipt. No credential is returned or persisted.
 */
export function createHmacSha256Verifier(options: {
  secret: Uint8Array;
  principalRef: string;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
}): ProviderVerifier {
  id.parse(options.principalRef);
  if (!(options.secret instanceof Uint8Array) || options.secret.byteLength < 32)
    throw new KernelError(
      'INVALID_PROVIDER_REGISTRATION',
      'HMAC registration requires at least 32 secret bytes',
      422,
    );
  const secret = Buffer.from(options.secret);
  const maxAgeMs = options.maxAgeMs ?? 300_000;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 30_000;
  if (
    !Number.isInteger(maxAgeMs) ||
    maxAgeMs < 1 ||
    maxAgeMs > 86_400_000 ||
    !Number.isInteger(maxFutureSkewMs) ||
    maxFutureSkewMs < 0 ||
    maxFutureSkewMs > 300_000
  )
    throw new KernelError(
      'INVALID_PROVIDER_REGISTRATION',
      'HMAC freshness bounds are invalid',
      422,
    );
  return (body, headers, now) => {
    const timestamp = headers['x-provider-timestamp'];
    const nonce = headers['x-provider-nonce'];
    const signature = headers['x-provider-signature'];
    if (
      !timestamp ||
      !/^\d{10}$/.test(timestamp) ||
      !nonce ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(nonce) ||
      !signature ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !(body instanceof Uint8Array)
    )
      return { authentication: { status: 'failed' } };
    const age = Date.parse(now) - Number(timestamp) * 1000;
    if (!Number.isFinite(age) || age > maxAgeMs || age < -maxFutureSkewMs)
      return { authentication: { status: 'failed' } };
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${nonce}.`)
      .update(body)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      return { authentication: { status: 'failed' } };
    const bodyHash = createHash('sha256').update(body).digest('hex');
    return {
      authentication: {
        status: 'verified',
        method: 'hmac_sha256',
        principalRef: options.principalRef,
        evidenceRef: `evidence://hmac-sha256/${bodyHash}`,
      },
      nonceKey: hash({ principalRef: options.principalRef, nonce }),
    };
  };
}
