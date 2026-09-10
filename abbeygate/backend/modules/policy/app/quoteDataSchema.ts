import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Under zod v4, `.openapi()` is bound onto each schema instance at
// construction time — schemas built BEFORE `extendZodWithOpenApi(z)` runs
// permanently lack it. Several HTTP routers (`v1ProgramsRouter`,
// `v1QuotesRouter`, …) import the transport schema below and pass it to
// OpenAPI registries, so we must extend zod here, before constructing the
// export, regardless of whether `backend/platform/openapi/openapi.ts`
// happens to load first in the dependency graph for a given entrypoint.
extendZodWithOpenApi(z);

/**
 * Generic quote data transport envelope.
 *
 * This is intentionally NOT the canonical business/schema authority for any
 * product. It only describes the outer HTTP/shared-contract shape:
 * quoteData is a JSON object payload.
 *
 * Product-specific validation, normalization, and semantic requiredness must
 * live in product-owned backend modules and be selected only after resolving
 * productType.
 */
export const quoteDataTransportSchema = z.record(z.string(), z.unknown());

// Backward-compatible alias for existing imports. Prefer the transport-specific
// name in new code to avoid implying this is the canonical product contract.
export const quoteDataInputSchema = quoteDataTransportSchema;
