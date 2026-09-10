## Backend Modules Boundary

`backend/modules/*` is the business capability layer.

### Expected structure per module

- `index.ts` — module public contract (what other modules/roots may import)
- `domain/` — pure business rules, invariants, entities, calculations
- `app/` — use-case orchestration and application services
- `infra/` — adapters/repositories for DB, queues, external providers
- `http/` — transport mapping (request/response, schema validation, router handlers)
- `__tests__/` — module tests

### Ownership rules

- Domain stays pure: no transport wiring, no direct infra/platform side effects.
- HTTP is an adapter: delegate to `app/` or explicit module services.
- Infra is capability-local unless truly cross-module.

### Import intent

- `http -> app -> domain` (downstream direction)
- `app` may call `infra` via explicit adapters/interfaces.
- `domain` should not depend on `http`, `infra`, or route composition.

