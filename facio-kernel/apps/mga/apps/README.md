# Apps

- `apps/api`: boots the API process.
- `apps/worker`: boots the worker process.

## Runtime Ownership

- `apps/api/index.ts` is the API process entrypoint.
- `backend/index.ts` is backend composition root used by the API process.
- Run queue consumers in the dedicated worker process (`apps/worker`) in production.
- A per-process guard prevents duplicate worker initialization within the same process.

## `apps/api/router.ts` and `backend/http/composition.ts`

These two files form a deliberate boot-vs-implementation boundary:

```
apps/api/index.ts        → starts the process (imports backend/index.ts)
apps/api/router.ts       → re-exports createApiRouter from backend/http/composition.ts
backend/http/composition.ts → assembles middleware + routes into the API surface
backend/index.ts         → wires composition into Express, adds rate limiters, starts server
```

**Rule**: `apps/api/` is a thin boot layer only. It must never contain route handlers,
middleware logic, or business code. All HTTP implementation lives in `backend/http/`.
`apps/api/router.ts` exists solely so that external tooling or tests can import the
composed router without importing the full server bootstrap.
