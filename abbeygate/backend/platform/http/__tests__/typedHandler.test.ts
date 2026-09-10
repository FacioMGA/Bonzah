/**
 * Integration smoke for the canonical typed HTTP handler wrapper at
 * `backend/platform/http/typedHandler.ts` (ADR-0028 Phase 1).
 *
 * The wrapper is the single allowed implementation of "parse + narrow
 * `req` at the HTTP boundary"; these tests pin its three observable
 * behaviours so a future refactor cannot silently change them:
 *
 *   1. On a successful parse, the inner handler sees the parsed shapes
 *      and `next` is never called with an error.
 *   2. On a `ZodError`, the wrapper sends a 400 with the canonical
 *      `{ success: false, error: { code: 'VALIDATION_ERROR', message,
 *      details } }` envelope and the inner handler is never invoked.
 *   3. On any non-Zod error, the wrapper forwards to `next(error)` so
 *      the existing global error middleware still owns 5xx mapping.
 */
import type { NextFunction } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
    typedHandler,
    type BoundaryRequest,
    type BoundaryResponse,
    type TypedRequest,
    type TypedValidationErrorBody,
} from '../typedHandler.js';

// Rule: test code can fake INFRASTRUCTURE, not BUSINESS CONTRACTS. Express's
// transport scaffolding (the request/response objects) is what we mimic —
// the wrapper-under-test reads body / params / query off req and calls
// status / json on res, and that is all this fixture provides. The data
// flowing through (Zod schemas, parsed bodies, error envelopes) stays real,
// because that is what is being tested.
//
// Naming rule: bare Express Request / Response MUST NOT appear in this
// file. The stdlib's unsupplied generics default to the unsafe top type;
// the canonical `BoundaryRequest` / `BoundaryResponse` aliases close every
// slot (`NoLocals` for the locals object, etc.) so the resolved-any walker
// stops counting test-fixture declaration sites as Express stdlib leaks.
// The single bridge cast happens in `expressResponseFixture()` below; all
// other declaration sites stay structurally typed and any-free.

type ReqFixtureBag = {
    body: unknown;
    params: ParamsDictionary;
    query: ParsedQs;
};

type ResponseStub = {
    status: (code: number) => ResponseStub;
    json: (body: unknown) => ResponseStub;
};

function expressResponseFixture(): {
    res: BoundaryResponse;
    statusMock: ReturnType<typeof vi.fn<(code: number) => ResponseStub>>;
    jsonMock: ReturnType<typeof vi.fn<(body: unknown) => ResponseStub>>;
} {
    const statusMock = vi.fn<(code: number) => ResponseStub>();
    const jsonMock = vi.fn<(body: unknown) => ResponseStub>();
    const fixture: ResponseStub = { status: statusMock, json: jsonMock };
    statusMock.mockReturnValue(fixture);
    jsonMock.mockReturnValue(fixture);
    // Single boundary bridge from the structural ResponseStub to the
    // canonical BoundaryResponse. Declaration sites above stay any-free;
    // the stub carries only the surface the wrapper actually exercises
    // (status, json), and the runtime values are real Vitest mocks.
    const res = fixture as unknown as BoundaryResponse; // TODO(FAC-9003): owner=platform-http expires=2026-12-31 deletionPR=express-stub-canonical-helper test-only boundary bridge from structural mock to BoundaryResponse.
    return { res, statusMock, jsonMock };
}

function makeReqRes(
    overrides: { body?: unknown; params?: ParamsDictionary; query?: ParsedQs } = {},
) {
    const reqFixture: ReqFixtureBag = {
        body: overrides.body,
        params: overrides.params ?? {},
        query: overrides.query ?? {},
    };
    // Single boundary bridge from the local ReqFixtureBag to BoundaryRequest.
    // The wrapper only reads body / params / query, so the bag carries only
    // those keys; everything else stays structurally typed.
    const req = reqFixture as unknown as BoundaryRequest; // TODO(FAC-9004): owner=platform-http expires=2026-12-31 deletionPR=express-stub-canonical-helper test-only boundary bridge from local ReqFixtureBag to BoundaryRequest.
    const { res, statusMock, jsonMock } = expressResponseFixture();
    const next: NextFunction = vi.fn();
    return { req, res, next, statusMock, jsonMock };
}

describe('typedHandler', () => {
    it('parses body / params / query once and forwards the typed request to the handler', async () => {
        const schemas = {
            body: z.object({ amount: z.number().positive() }),
            params: z.object({ policyId: z.string().min(1) }),
            query: z.object({ stage: z.enum(['QUOTE', 'BIND']) }),
        };
        const innerHandler = vi.fn(
            async (req: TypedRequest<typeof schemas>, res: BoundaryResponse) => {
                res.status(200).json({
                    ok: true,
                    parsed: { body: req.body, params: req.params, query: req.query },
                });
            },
        );
        const handler = typedHandler(schemas, innerHandler);

        const { req, res, next, statusMock } = makeReqRes({
            body: { amount: 42 },
            params: { policyId: 'POL-1' },
            query: { stage: 'QUOTE' },
        });
        await handler(req, res, next);

        expect(innerHandler).toHaveBeenCalledTimes(1);
        const calledReq = innerHandler.mock.calls[0][0];
        expect(calledReq.body).toEqual({ amount: 42 });
        expect(calledReq.params).toEqual({ policyId: 'POL-1' });
        expect(calledReq.query).toEqual({ stage: 'QUOTE' });
        expect(next).not.toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(200);
    });

    it('returns 400 with the canonical VALIDATION_ERROR envelope when the body fails to parse', async () => {
        const BodySchema = z.object({ amount: z.number().positive('amount must be positive') });
        const innerHandler = vi.fn();
        const handler = typedHandler({ body: BodySchema }, innerHandler);

        const { req, res, next, statusMock, jsonMock } = makeReqRes({ body: { amount: -1 } });
        await handler(req, res, next);

        expect(innerHandler).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(400);
        // The cast is to the wrapper's OWN exported envelope contract,
        // not an ad-hoc inline shape — the same type the production code
        // constructs at line ~107 of typedHandler.ts. If the contract
        // changes there, this site fails the typecheck (good).
        const sent = jsonMock.mock.calls[0][0] as TypedValidationErrorBody;
        expect(sent.success).toBe(false);
        expect(sent.error.code).toBe('VALIDATION_ERROR');
        expect(sent.error.message).toBe('amount must be positive');
        expect(Array.isArray(sent.error.details)).toBe(true);
        expect(sent.error.details[0]?.path).toEqual(['amount']);
    });

    it('forwards non-Zod errors to next() so the global error middleware still owns 5xx mapping', async () => {
        const BodySchema = z.object({ name: z.string() });
        const boom = new Error('downstream blew up');
        const innerHandler = vi.fn(async () => {
            throw boom;
        });
        const handler = typedHandler({ body: BodySchema }, innerHandler);

        const { req, res, next, statusMock } = makeReqRes({ body: { name: 'ok' } });
        await handler(req, res, next);

        expect(innerHandler).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(boom);
        expect(statusMock).not.toHaveBeenCalled();
    });

    it('skips parsing for slots without a schema (params/query stay unmodified)', async () => {
        const schemas = { body: z.object({ flag: z.boolean() }) };
        const innerHandler = vi.fn(
            async (req: TypedRequest<typeof schemas>, res: BoundaryResponse) => {
                void req;
                res.status(200).json({ ok: true });
            },
        );
        const handler = typedHandler(schemas, innerHandler);

        const { req, res, next } = makeReqRes({
            body: { flag: true },
            params: { unparsed: 'ZZ' },
            query: { unparsed: '1' },
        });
        await handler(req, res, next);

        expect(innerHandler).toHaveBeenCalledTimes(1);
        const calledReq = innerHandler.mock.calls[0][0];
        expect(calledReq.body).toEqual({ flag: true });
        expect(calledReq.params).toEqual({ unparsed: 'ZZ' });
        expect(calledReq.query).toEqual({ unparsed: '1' });
        expect(next).not.toHaveBeenCalled();
    });
});
