# ADR-0103: Shared MGA application with PostgreSQL tenant provisioning

Status: implementation in progress; authorized by Uriel on 7 September 2026.

The executable baseline is Abbeygate commit
`f85219459e6a888996d3d3af731b6d45a98fde94`, imported intact into `apps/mga`
of Facio Kernel. Its existing React journeys, product modules, Prisma models,
event outbox, BullMQ workers and document pipeline remain canonical. The prior
Kernel SQLite runtime is not part of this application's deployment.

One deployment serves multiple independently configured MGAs. A platform
organization owns operating tenants; its membership is distinct from the
existing policyholder Account/AccountUser axis. This explicitly activates
Tenant.parentOrganizationId, superseding the reserved-field prohibition in
the tenancy contract. No existing customer data or memberships are inferred.

Platform identity authenticates before tenant selection. A selected session
binds the operating tenant; every protected request checks active database
membership and tenant status. A header is a selector, never authorization.
Tenant-local roles constrain permissions; global legacy access assignments
cannot expand them. Existing global user-administration routes are unavailable
in shared mode until they enforce platform ownership. PostgreSQL row policies,
transaction-local tenant context, workers and object access must enforce the
same operating tenant. Account.id remains a separate policyholder scope.
Returning to workspace selection clears the operating session across browser tabs
while retaining organization sign-in. Explicit sign-out and inactivity expiry
continue to revoke the durable organization session.

Provisioning is transactional and idempotent, using an explicitly registered,
versioned insurance template and supplied customer identity. It creates no
copy of another tenant's policies, people, documents, credentials or jobs.
Customer names, contacts, branding, jurisdiction defaults and legal material
belong to template/configuration data, never shared fallbacks. Tenant settings
use one typed projector for HTTP and jobs. Unsupported or incomplete settings
fail validation. Template products reuse their existing insurance engines.

The initial acceptance environment is synthetic: normal existing quote,
policy and document workflows must function without external issuance,
payments or customer communications. This does not grant live underwriting
authority. Two independently configured tenants and a third created through
the application must work without a code change or deployment. Acceptance
also requires restart persistence, denied cross-tenant access and scoped
worker/document behavior using a non-bypass PostgreSQL application role.

The candidate has isolated database, queues, object storage and credentials.
Existing customer repositories and deployments are unchanged. Local checks,
working user journeys, deployed state and customer acceptance are reported
separately. No platform completeness claim follows from importing code.

Shared-mode quote/policy references use a compact twelve-character tenant-slug
prefix, country, product, kind and a globally atomic sequence. The sequence
prevents collisions even for tenants with the same truncated prefix. Certificates
and Green Card serials also use global counters, initialized by migration above
retained numeric references and legacy reservations; runtime never bypasses RLS
to scan other tenants. Issuance locks the scoped policy and reuses its committed
identifiers on retry. Existing issued/imported references are not renumbered.
A missing counter fails closed. This supersedes customer-branded numbering only
for newly allocated references in shared platform mode.

Fresh initialization retains only the four exact, unused migration counter rows;
changed, missing or foreign counters prevent cleanup. Workspace validation and
product packages must be built before the initializer loads their runtime exports.

The shared sandbox explicitly uses `KERNEL_OBSERVABILITY_MODE=structured_logs`
with redacted Pino JSON, correlated outbox/job failures, bounded Docker log
retention, and application/database health probes. No customer Sentry project
or DSN is inherited. Other production deployments retain the Sentry-required
startup contract unless they explicitly select this Platform mode. Dedicated
Sentry can be configured later without changing business code; its absence
remains visible in integration health.

Shared batch handlers inherit the tenant admitted from the durable job envelope;
legacy deployment defaults cannot replace that context. Organization sign-in uses
verified Google Workspace invitation claims or explicitly directory-verified Entra
issuer/oid mappings. Entra email claims cannot choose an invited local user. Session
and quote-signing secrets must be distinct and present before shared startup.

Customer FNOL submission, signed FNOL context/submission, authenticated document
download and cancellation requests enforce the policy's server-resolved published
journey capabilities after existing token/ownership checks. Claim and cancellation
retain the source portal prerequisite; authenticated document access requires both
documents and portal from one definition. Disabled or inactive products deny access;
a missing published mapping fails closed. Staff review keeps its separate existing
permissions. Signed public quote document access is a distinct route and is not
reclassified as customer portal access. Advanced agent commission modes, hierarchy
and cancellation commission preferences remain configuration only; these controls
do not implement agent settlement or override policyholder refund calculations.
