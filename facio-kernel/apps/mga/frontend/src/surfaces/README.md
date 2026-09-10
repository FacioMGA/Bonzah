## Frontend Surfaces Boundary

`src/surfaces/*` is the deployable composition layer (`public`, `client`, `bo`).

### Essence

- Route composition
- Layout shells
- Surface-level auth/access wiring
- Delegation to product public APIs

### Expected content

- `App*.tsx`, `router.tsx`, surface `pages.ts`, layout wrappers
- Minimal presentation-only glue for route concerns

### Avoid in surfaces

- Deep business logic that should live in `src/products/*`
- Direct imports across surfaces (`bo` importing `client`, etc.)

