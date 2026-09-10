# Facio Platform

The shared MGA application is in `apps/mga`. It imports the existing Abbeygate application from commit `f85219459e6a888996d3d3af731b6d45a98fde94` and adds organization membership, independently provisioned operating tenants, and configuration authoring. The source quote, underwriting, policy, document, outbox and BullMQ implementations are retained.

The working candidate uses PostgreSQL with pgvector, a restricted runtime database role and forced row policies, Redis/BullMQ, and private Azure Blob storage. SQLite belongs to the earlier scaffold retained under `src/`; it is not the shared MGA database. The [earlier README](docs/architecture/legacy-scaffold-readme.md) is historical and does not describe this application.

**Delivery status:** implementation and live cutover verification are in progress. Check the [delivery evidence](docs/delivery/gen2-multitenant-checkpoint-2026-09-07.md) before treating local results as deployed or accepted.

## Product workflow

1. Open Facio Platform and sign in with an approved organization identity.
2. Create a workspace using its legal/trading name, declared MGA role, contacts, address, logo, colors, supported jurisdiction, currency, locale and time zone. Select a registered starting portfolio.
3. Open the existing back office: submissions, quotes, underwriting, bind/issue, policies, documents and communications belong to the selected operating tenant.
4. Open **Programs → Runtime Settings** to edit the product and workflow definitions imported from Symphony. Save a draft, review it, and publish to explicit binder authorities. Drafts do not alter the active journey; publication changes that tenant's selected programme.

The Cyprus portfolio contains Home, Travel, Health, Motor and configured Commercial. Other registered territory portfolios expose only engines with applicable source data. Starting portfolios are training configurations, with no copied customers, credentials, insurer appointment or enabled live payment/delivery. Existing insurance operations run against those configurations; external provider connections require their actual credentials and accepted authority.

## Configuration interfaces

The existing back-office UI and authenticated HTTP/MCP interfaces call the same configuration application services:

- `GET /api/insurance-configuration/schema`
- `GET /api/insurance-configuration/programs/:programId`
- `PUT /api/insurance-configuration/programs/:programId`
- `POST /api/insurance-configuration/programs/:programId/publish`
- MCP endpoint `/api/v1/mcp/config?workspace=<slug>`, using a workspace key issued in the back office. Tools are `config_insurance_schema`, `config_insurance_read`, `config_insurance_save`, and `config_insurance_publish`.

Publication requires the exact saved definition hash and explicit binder authorities. Backend permissions, membership and row isolation remain authoritative. The workspace URL locates a key namespace; it does not authorize a tenant. Legacy MCP OAuth is unavailable in shared Platform mode; key-based MCP is separate from organization Google sign-in.

## Development and verification

```sh
npm ci
npm --prefix apps/mga ci
npm run dev:platform
npm run check:platform
```

Development uses an explicit private `.local/gen2.env` and disposable PostgreSQL/Redis/Blob services. The launcher does not run `db push`, erase databases or seed customer records. `PLATFORM_TENANT_PG_TEST=1` enables real database isolation tests against the initialized disposable local database; production URLs are rejected by those tests.

`npm run check` and the old browser scripts verify the preserved scaffold. `npm run check:platform` builds the imported application, runs its source architecture guards, checks frontend types, and tests tenant provisioning, identity, configuration and product behavior. The dedicated Platform CI workflow also executes PostgreSQL isolation tests under a non-bypass role.

Deployment files are in `deploy/gen2/`; the application image is built from `apps/mga/infrastructure/docker/Dockerfile.platform`. The existing Platform container/data remain separate until verified cutover. Secrets are never included in Git, image layers or public assets.

The September requirements and dates remain in [the delivery plan](docs/delivery/september-plan.md). This reuse proof does not imply customer acceptance or completion of the Bonzah, UE or VUW scope.
