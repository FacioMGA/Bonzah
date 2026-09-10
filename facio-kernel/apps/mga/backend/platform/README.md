## Platform Boundary

`backend/platform` contains cross-module technical primitives.

### What belongs here

- Database runtime foundation (`db`)
- Queue/event infrastructure (`events`, `redis`)
- Security and policy middleware primitives (`security`)
- Observability/logging/telemetry
- Shared runtime services reused by multiple modules

### What does not belong here

- Capability-specific business logic
- Module-local repository rules better placed in `modules/*/infra`
- HTTP route orchestration

### Decision rule

If code is only used by one capability and encodes capability semantics, prefer
`modules/<capability>/infra` over `platform`.

### `platform/http/` vs `backend/http/` — Naming Clarification

Two directories share the `http` name at different depths. Their responsibilities are distinct:

| Directory | Responsibility | Contains |
|-----------|---------------|----------|
| `backend/http/` | **Transport layer** — owns route composition, middleware, and API surface wiring. | `routes/`, `middleware/`, `composition.ts`, `docs/` |
| `backend/platform/http/` | **HTTP infrastructure primitives** — low-level outbound HTTP helpers reused by any module. | `safeHttpClient.ts` (SSRF-safe outbound POST) |

Rule: if it handles an inbound request or mounts a route, it belongs in `backend/http/`.
If it is an outbound HTTP utility or request helper, it belongs in `backend/platform/http/`.

