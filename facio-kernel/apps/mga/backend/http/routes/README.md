## API Routes Ownership Policy

Routes under `backend/http/routes` are **transport composition adapters**.

### Canonical owner

Business route behavior is owned by `backend/modules/*/http`.

### Expectations for files in this folder

- Thin delegation (re-export or adapter wiring)
- No direct business orchestration
- No direct domain/infra logic

### Allowed exceptions

Small set of route orchestrators (auth/public/bo/client/v1 roots) may compose
multiple module routers intentionally.

This policy is enforced by `tools/quality/check-backend-module-delegation.mjs`.

