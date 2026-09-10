/**
 * controllerUtils.ts — Shared utilities for public auto quote HTTP handlers.
 *
 * Pure helpers and request/response utilities used across all handler modules.
 * No business logic — only HTTP/transport concerns.
 */
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { asRecord } from './quoteDataGuards.js';
import type { QuoteResponse } from '../../../platform/types/autoInsurance.js';
import type { PerfTimings } from './perfTimings.js';
import { storageService } from '../../../platform/storage/service.js';
import { resolvePublicAppBaseUrlFromRequest } from '../../../platform/http/publicAppLinks.js';
import { getCorrelationId } from '../../../platform/observability/context.js';

type ErrorsModule = typeof import('./errors.js');
const errorsModule: ErrorsModule = await import('./errors.js');
const { PublicApiError } = errorsModule;

export type RequestWithPerf = Request & { perf?: PerfTimings };

export function policyIdFrom(req: Request): string {
    return String(req.params?.policyId || '');
}

export function resolveCorrelationId(req: Request): string {
    const fromHeader = String(req.headers['x-correlation-id'] || '').trim();
    const fromRequest = String(req.correlationId || '').trim();
    const correlationId = fromHeader || fromRequest || randomUUID();
    req.correlationId = correlationId;
    return correlationId;
}

export function resolvePublicQuoteBaseUrl(req: Request): string {
    return resolvePublicAppBaseUrlFromRequest(req);
}

export function extractLocalStorageFilename(storageUri: string): string | null {
    const m = String(storageUri || '').match(/^\/api\/documents\/([^/?#]+)$/);
    return m?.[1] || null;
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return await new Promise((resolve, reject) => {
        stream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

export async function fetchPdfBufferFromStorageUri(storageUri: string): Promise<Buffer | null> {
    const uri = String(storageUri || '').trim();
    if (!uri) return null;
    if (/^https?:\/\//i.test(uri)) {
        const resp = await fetch(uri);
        if (!resp.ok) return null;
        const ab = await resp.arrayBuffer();
        return Buffer.from(ab);
    }
    const localFilename = extractLocalStorageFilename(uri);
    if (!localFilename) return null;
    const stream = await storageService.getFileStream(localFilename);
    if (!stream) return null;
    return await streamToBuffer(stream);
}

export function isQuoteResponse(value: unknown): value is QuoteResponse {
    const record = asRecord(value);
    const primaryOption = asRecord(record.primaryOption);
    return (
        typeof record.reference === 'string' &&
        typeof record.currency === 'string' &&
        Object.keys(primaryOption).length > 0 &&
        Array.isArray(record.alternatives)
    );
}

export function sendPublicError(res: Response, error: unknown, fallbackMessage: string) {
    const cid = getCorrelationId();
    if (error instanceof PublicApiError) {
        return res.status(error.httpStatus).json({
            success: false,
            error: { code: error.code, message: error.message, details: error.details, ...(cid ? { correlationId: cid } : {}) },
        });
    }
    return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : fallbackMessage, ...(cid ? { correlationId: cid } : {}) },
    });
}
