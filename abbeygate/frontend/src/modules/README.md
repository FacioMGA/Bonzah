## Frontend Products Contract

`src/products/*` is the single canonical business-feature root consumed by `src/surfaces/*`.

### Public API Boundary

- Every product must expose `index.ts` as its public API.
- Surfaces should import from product public APIs, not deep internals.
- Products must never import from `src/surfaces/*`.
- Cross-product primitives belong in `src/shared/*` only when truly generic.

### Allowed Subfeature Vocabulary

- `views/` — page/section compositions
- `hooks/` — React hooks and controllers
- `actions/` — user-triggered operations and command wrappers
- `model/` — view models, selectors, local types/contracts
- `api/` — product or subfeature transport
- `validation/` — schemas and validators
- `renderers/` — reusable render-only UI blocks
- `domain/` — pure business logic
- `list/` / `detail/` — list/detail subfeatures

### `detail/` Boundary

- `detail/` is composition-only.
- Allowed: `views/`, `hooks/` (page state only).
- Forbidden inside `detail/`: `model/`, `domain/`, `actions/`, `validation/`.

### Forbidden At Product Root

- `components/` (allowed only under subfeature depth)
- `features/`
- `internal/`
- `lib/`
- `helpers/`
- `controller/`
- `ui/`
- `types/`

### Canonical Namespace Rules

- `src/domains/*` is retired. Use `src/products/*`.
- `src/products/features/*` is retired.
- Standalone `src/products/underwriting/*` and `src/products/wizard/*` are retired; policy-specific code belongs under `src/products/policies/*`.

