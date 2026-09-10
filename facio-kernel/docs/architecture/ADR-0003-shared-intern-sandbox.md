# ADR 0003: one hosted sandbox and a durable tenant control plane

Accepted for the September 2026 intern pilot. This is a sandbox architecture decision, not production or customer acceptance.

The immediate objective is that interns independently create and configure separate tenants on the same running Kernel build. A new tenant must not require a branch, copy of the application, deployment or fixture edit. The user-provided intern proposal supplies acceptance requirements; its suggestions and headings do not assert that capabilities already exist.

## Product and address naming

The user selected **Facio Platform** as the product and `platform.facio.io` as its main entry point. **Studio**, at `/studio`, is the tenant/product/workflow configuration experience inside it. The Kernel remains the shared architecture beneath that product. The Platform hub currently exposes authorized customer workspaces and Studio; subscriptions, ACTUIT and other product access remain the broader vision, not features this release claims to deliver.

| Address | Role and current decision |
| --- | --- |
| `https://platform.facio.io` | Canonical Platform sign-in and workspace entry |
| `https://platform.facio.io/studio` | Studio, with explicit authorized tenant selection |
| `https://platform.facio.io/api/*` | Current compatible browser-session API routes |
| `https://platform.facio.io/mcp` | Current OAuth-protected MCP resource |
| `https://api.facio.io` | Proposed public versioned API address; no existing service is repointed by this decision |
| `https://mcp.facio.io` | Proposed dedicated MCP address; introduction requires resource/audience and existing-client compatibility checks |

Legacy root links containing an explicit tenant remain usable. Neither proposed dedicated address changes current API paths or OAuth grants. Organization sign-in redirects use the canonical Platform `/auth/callback` URL.

## Deployment boundary

One isolated Azure VM runs one Node process behind Caddy HTTPS. SQLite uses a dedicated managed block disk, with WAL, atomic commands and off-host database backups. Neither Azure Files nor another network filesystem is the live database. Deployment stops the prior writer before starting the new build. This keeps the current synchronous transaction boundary intact during the September deadline window. Managed PostgreSQL and horizontal scaling remain production work; placing SQLite in a replicated service would not provide that behavior.

West Europe is the actual sandbox region. Region is checked during provisioning, not accepted as an arbitrary configuration claim. Tenant configuration may describe a residency requirement, but that cannot relocate this deployment. The environment accepts synthetic or explicitly approved sandbox material only. Regional production resources and existing customer systems are separate.

## Authority and identity

Google Workspace and Microsoft Entra are independent OIDC providers for the same control plane. Signature, issuer, audience, expiry, nonce and authorization-code PKCE are verified. Entra identities use the specific tenant and immutable directory object ID. Google identities require a verified Workspace domain and email; a pre-authorized email invitation binds once to the verified issuer and subject. Thereafter email is display data. Provider identities are not merged by matching email.

Accounts/workspaces, tenants, environments, operating entities and actors have distinct durable IDs. An account builder can create a sandbox and access owned or explicitly assigned tenants. Administrators inherit account tenant access. Every UI/API/MCP operation rechecks membership. The explicit tenant target travels in each request, so separate tabs and conversations cannot retarget one another through a shared session variable. Revoked rows remain revoked after bootstrap/redeployment.

The browser has a Secure HttpOnly cookie, an eight-hour session limit and CSRF protection. MCP uses the official SDK OAuth endpoints, explicit consent, exact registered redirects, PKCE S256 and a resource-bound grant. Access tokens expire after fifteen minutes; refresh tokens rotate and their replay revokes the grant. Opaque token digests and server-side state persist in a separate auth database. A user can disconnect MCP grants. Organization login is not replaced by a development bearer token.

## Configuration and execution

Requirements attachment, configuration draft and executable policy draft are persisted and versioned. Retained profile hashes prove the stored package bytes; supplied source-document checksums remain unverified until independently captured and checked.

Sandbox activation creates one immutable bundle containing all three exact versions, their hashes, the build and a compatibility identifier. The runtime resolves that bundle. Draft changes have no runtime effect until another validated activation. Existing insurance records retain the original release and policy references across later activation or rollback. Rollback changes the active release pointer and does not restore or erase transaction data.

This build executes only the declared manual external-quote journey and exact money calculations. Unsupported payment, approval, provider adapters and customer-specific capabilities block activation or execution. Product/process metadata is not evidence that a workflow engine implements it.

## Readiness and evidence

Infrastructure provisioning, completed tenant setup and journey acceptance are different observations. An accessible tenant awaiting requirements stays in provisioning/setup pending. A requirements-attached tenant can be provisioned Ready while the activation candidate still exposes missing configuration. An active manual journey remains unaccepted until exercised and reviewed. No status substitutes for the twenty-four checks in the intern acceptance matrix.

The first handover requires two individual intern accounts using differently configured tenants on the same hosted build, a real ChatGPT OAuth connection, cross-access denial, persistence/recovery evidence and an independent walkthrough. Automated mock-identity tests are recorded separately from organization sign-in and actual ChatGPT evidence.

## References

- [Google OIDC identity and validation](https://developers.google.com/identity/openid-connect/openid-connect)
- [Microsoft ID-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [SQLite WAL constraints](https://sqlite.org/wal.html)
