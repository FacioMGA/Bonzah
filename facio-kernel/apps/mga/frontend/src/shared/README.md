## Frontend Shared Boundary

`src/shared/*` is strictly product-agnostic reusable code.

### What belongs

- `ui/` reusable UI primitives and shared components
- `api/` shared transport helpers and cross-cutting API plumbing
- `core/` reusable engines/utilities (e.g., generic list mechanics)
- `lib/`, `types/`, `styles/`, `config/`

### What does not belong

- Product-specific business logic
- Surface-specific route or shell wiring
- Domain-specific folders that should live under `src/products/*`

### Guardrail

Shared code must not import from `src/products/*` or `src/surfaces/*`.

