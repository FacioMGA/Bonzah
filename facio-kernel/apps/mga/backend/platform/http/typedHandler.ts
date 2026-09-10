import type { NextFunction, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';
import { ZodError, type ZodType, type z } from 'zod';

// Canonical typed HTTP handler wrapper for Express routes.
//
// Per ADR-0028 (`docs/architecture/decisions/ADR-0028-typed-http-handler-wrapper.md`)
// and the canonical-ownership row "HTTP boundary input parsing wrapper",
// this is the single allowed implementation of "parse and narrow `req`
// at the HTTP boundary". Modules MUST route route-handler authoring
// through `typedHandler(schemas, handler)` rather than rolling their
// own `(req: Request, res: Response) => …` shapes that re-launder
// `req.body` / `req.params` / `req.query` field-by-field.
//
// Why this exists: a TypeScript-compiler walk of the backend program
// counted 270 declaration sites whose resolved type contains `any`
// because Express's `Request<P, ResB, ReqB, Q>` generic defaults every
// parameter to the unsafe top type. Every one of those sites had been
// papered over with secondary casts in handler bodies — defensive
// `String(req.headers[X] || '')` coercions, body-shape casts, and
// per-handler intersection casts that re-introduced canonical
// `req.user` / `req.correlationId` properties — for the same reason:
// the signature gave them no narrower type to start from. This
// wrapper removes the source of the laundering by making the schemas
// the contract.
//
// Boundary scope: this is HTTP-shape parsing only. Product validation
// continues to flow through `validateForContext({ productCode, stage,
// actor, data })` (`docs/architecture/contracts/validation.md`); the
// wrapper does not replace product/stage/actor reasoning.

// Each schema slot is parametrized to a sensible boundary type so the
// schema cannot legally widen the slot it covers. `body` parses to
// `unknown` (the contract is "narrowed at the call site, not here");
// `params` and `query` parse to Express's runtime shapes
// (`ParamsDictionary`, `ParsedQs`) so a per-route schema must be
// structurally compatible with them — `z.object({ id: z.string() })`
// works, `z.object({ id: z.number() })` rightly does not (Express
// surfaces params as strings; coerce inside the schema if you need a
// number).
export interface HandlerSchemas {
    body?: ZodType<unknown>;
    params?: ZodType<ParamsDictionary>;
    query?: ZodType<ParsedQs>;
}

type InferOrDefault<S, D> = S extends ZodType ? z.infer<S> : D;

/**
 * Express's Request and Response types default every unsupplied
 * generic slot to the unsafe top type (ResBody, ReqBody, and the
 * locals object all fall through to it). Leaving any slot implicit
 * silently pulls that top type into the resolved-any walker's count
 * for every downstream declaration. The canonical aliases below
 * close every slot at the HTTP boundary so wrapper authors and tests
 * share one named shape — bare Express Request / Response MUST NOT
 * appear in the wrapper or its test fixtures.
 *
 * `NoLocals` is the empty-record locals type, intentionally stricter
 * than a string-keyed-unknown record: this wrapper does not propagate
 * `res.locals` through the typed handler contract, so the right type
 * is "no locals expected." Handlers that genuinely need locals must
 * widen explicitly at their own boundary, where the choice is
 * visible.
 */
export type NoLocals = Record<string, never>;

/**
 * Outer boundary `Request` shape — what Express hands the wrapper
 * before any schema runs. All five generics supplied so the stdlib
 * defaults never leak. Use this as the parameter type wherever a
 * pre-parse Request appears in wrapper or test code; never bare
 * `Request`.
 */
export type BoundaryRequest = Request<ParamsDictionary, unknown, unknown, ParsedQs, NoLocals>;

/**
 * Boundary `Response` shape used by both the outer wrapper signature
 * and the inner handler. Same rule: never bare `Response`.
 */
export type BoundaryResponse = Response<unknown, NoLocals>;

/**
 * Inner-handler `Request` shape — `BoundaryRequest` narrowed by the
 * caller-supplied Zod schemas. The `LocalsObj` slot is locked to
 * `NoLocals` for the same reason as `BoundaryRequest`: closing every
 * generic at the boundary so Express defaults cannot leak `any` into
 * the resolved-any count.
 */
export type TypedRequest<S extends HandlerSchemas> = Request<
    InferOrDefault<S['params'], ParamsDictionary>,
    unknown,
    InferOrDefault<S['body'], unknown>,
    InferOrDefault<S['query'], ParsedQs>,
    NoLocals
>;

export type TypedHandlerFn<S extends HandlerSchemas> = (
    req: TypedRequest<S>,
    res: BoundaryResponse,
    next: NextFunction,
) => Promise<void> | void;

export interface TypedValidationErrorBody {
    success: false;
    error: {
        code: 'VALIDATION_ERROR';
        message: string;
        details: ZodError['issues'];
    };
}

/**
 * Wraps an Express handler with caller-supplied Zod schemas for `body`
 * / `params` / `query`. Each supplied schema runs once at entry; on
 * `ZodError` the wrapper sends a 400 with the canonical
 * `{ success: false, error: { code: 'VALIDATION_ERROR', message,
 * details } }` envelope (matching the existing convention used by
 * `accessControlRouter` and friends). Non-Zod errors fall through to
 * `next(error)` so the existing global error middleware still owns
 * 5xx mapping.
 *
 * Outer signature uses the canonical `BoundaryRequest` /
 * `BoundaryResponse` aliases (every Express generic supplied);
 * `BoundaryRequest` is the pre-parse shape Express hands the wrapper,
 * and the inner handler sees the schema-narrowed `TypedRequest<S>`
 * after the assert-and-bridge cast below. Express's runtime
 * `Request<any, any, any, any, any-Locals>` remains assignable to this
 * tighter signature because `any` is assignable to everything — but
 * the declaration sites no longer pull Express stdlib `any` defaults
 * into the resolved-any walker's count.
 */
export function typedHandler<S extends HandlerSchemas>(
    schemas: S,
    handler: TypedHandlerFn<S>,
): (req: BoundaryRequest, res: BoundaryResponse, next: NextFunction) => Promise<void> {
    return async (req, res, next) => {
        const typedReq = req as TypedRequest<S>;
        try {
            // The narrow `as TypedRequest<S>['…']` casts mirror what the
            // schema's `.parse(…)` already produced at runtime; TS can't
            // resolve the conditional type at the assignment site, so the
            // cast is purely to satisfy the indexed-access type. None of
            // them launder through `any` or `unknown`.
            if (schemas.body) typedReq.body = schemas.body.parse(req.body) as TypedRequest<S>['body'];
            if (schemas.params) typedReq.params = schemas.params.parse(req.params) as TypedRequest<S>['params'];
            if (schemas.query) typedReq.query = schemas.query.parse(req.query) as TypedRequest<S>['query'];
            await handler(typedReq, res, next);
        } catch (error) {
            if (error instanceof ZodError) {
                const body: TypedValidationErrorBody = {
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: error.issues[0]?.message ?? 'Request validation failed',
                        details: error.issues,
                    },
                };
                res.status(400).json(body);
                return;
            }
            next(error);
        }
    };
}
