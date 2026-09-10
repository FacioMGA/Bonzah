# Shared Kernel sandbox operations

This environment is for synthetic intern test data. Local, hosted, stakeholder acceptance and customer production status remain separate. The shared runtime uses one Azure VM and one attached managed data disk. This provides persistence through process restart and image replacement; it is not a highly available deployment.

## Resource ownership and access

- Subscription: `29490482-d492-49af-bcd0-45ed6409413b` (Facio Microsoft Azure Sponsorship).
- Dedicated resource group: `rg-facio-kernel-sandbox-weu`; actual region: `westeurope`.
- VM: `vm-kernel-sandbox`, `Standard_D2als_v6` (2 vCPU, 4 GiB).
- Canonical HTTPS host: `platform.facio.io`.
- Azure infrastructure hostname: `facio-kernel-sandbox-294904.westeurope.cloudapp.azure.com`; this redirects to the canonical host and does not serve an alternate authentication origin.
- Storage account: `stkernelsandbox294904`; private `backups` and `releases` containers. Shared account keys and anonymous blobs are disabled.
- Facio Platform entry URL is `https://platform.facio.io`; the configuration Studio is `https://platform.facio.io/studio`. API paths remain under `https://platform.facio.io/api/` and MCP is `https://platform.facio.io/mcp`. Proposed separate `api.facio.io` and `mcp.facio.io` hosts are not provisioned in this sprint. Only the new `platform` CNAME was added to the Facio DNS zone; existing domain records and customer services remain unchanged.

Live SKU discovery on 2026-09-06 found cheap legacy B-series sizes restricted and new B-series quotas at zero in the checked regions. The selected SKU had available quota and no restriction. The Azure retail compute price was USD 0.0972/hour (USD 70.96 for 730 hours), plus disks, public IP, backup storage, operations, logs and traffic. Sponsorship credits/billing can differ from retail estimates. Pricing was checked through the [Azure retail prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

## Runtime configuration

`Dockerfile` pins the Node 22.23.2 base image digest, and CI uses that same Node release. `deploy/activate.sh` accepts a full verified Git SHA, downloads a private release bundle, checks its archive checksum and image revision label, backs up existing databases, and replaces exactly one container. It preserves both databases; a failed health check attempts a previous-image restart without reverting transactions.

Only Caddy listens publicly on ports 80/443. Docker exposes the application to `127.0.0.1:4310` on the VM. Inside the container the application listens on `0.0.0.0`. Local health probes must set the public `Host` header because the hosted server rejects other hosts. Caddy manages HTTPS and sets HSTS.

Caddy runtime logs omit request URIs and headers, including upstream-failure logs, so callback authorization codes and browser credentials do not enter proxy logs. Normal access logging is disabled. The filter was verified with an intentional synthetic callback failure before the application was activated; see [Caddy log filtering](https://caddyserver.com/docs/caddyfile/directives/log#filter).

The GoDaddy DNS record is `CNAME platform → facio-kernel-sandbox-294904.westeurope.cloudapp.azure.com`, TTL 600 seconds. The cloud-init template uses `__KERNEL_HOST__=platform.facio.io` and `__KERNEL_AZURE_HOST__=facio-kernel-sandbox-294904.westeurope.cloudapp.azure.com`. Keep the DNS target as the Azure hostname; Caddy performs the HTTP redirect from that infrastructure hostname to the canonical origin. Sign-in registrations, OAuth issuer metadata, the host environment and the GitHub `KERNEL_PUBLIC_URL` variable must all use the canonical origin.

The data disk is mounted at `/srv/facio-kernel/data`, mode 0750, owned by application UID 1000, and mapped to `/data`. On the provisioned D2als_v6 VM, Azure LUN0 resolves through `/dev/disk/azure/data/by-lun/0` to `/dev/nvme0n2`; the OS disk is `/dev/nvme0n1`. The cloud-init helper supports both Azure NVMe and SCSI LUN links and formats only this new dedicated LUN when no filesystem exists. Docker has a mount dependency and refuses startup without the mounted data disk. SQLite WAL is kept on this local ext4 filesystem. Do not move it to Azure Files or a shared network filesystem and do not run multiple replicas against it. See [SQLite WAL filesystem requirements](https://sqlite.org/wal.html).

`/srv/facio-kernel/secrets/hosted.env` is root-owned mode 0600. It contains:

```text
NODE_ENV=production
PORT=4310
KERNEL_PUBLIC_URL=https://platform.facio.io
KERNEL_REGION=westeurope
KERNEL_DB_PATH=/data/kernel.sqlite
KERNEL_AUTH_DB_PATH=/data/auth.sqlite
KERNEL_BOOTSTRAP_FILE=/run/secrets/bootstrap.json
KERNEL_WORKSPACE_DOMAIN=facio.io
KERNEL_OIDC_TENANT_ID=<Facio tenant ID>
KERNEL_OIDC_CLIENT_ID=<dedicated Kernel app ID>
KERNEL_OIDC_CLIENT_SECRET=<secret; never put in Git or logs>
KERNEL_GOOGLE_CLIENT_ID=<dedicated Kernel Google client ID>
KERNEL_GOOGLE_CLIENT_SECRET=<secret; never put in Git or logs>
```

The deploy runner sets `KERNEL_BUILD_SHA` separately to the verified SHA. `NODE_ENV=production` enables the normal secure Node runtime; the application's actual environment remains `sandbox`, and business production scope is forbidden.

`bootstrap.json` is owned by UID 1000, mode 0400, under the root-only secrets directory and mounted as an individual read-only file so the container can read it. Invitations identify the six approved Workspace emails and become stable issuer/subject memberships only after successful verified identity login. Entra principals use validated tenant plus directory object ID. Re-running bootstrap must not restore revoked access. Neither a Google email address nor a tool-supplied tenant ID is runtime authority.

## Identity registrations

The dedicated Entra app `Facio Kernel Sandbox` is single tenant, requires app assignments, uses authorization code flow, and redirects only to `https://platform.facio.io/auth/callback`. Existing customer identity applications are unchanged. Its initial 90-day credential expires 2026-12-05; rotate it before expiry using a staged new credential, update the root-only environment file, verify login, then remove the retired credential.

Google registration was created on 2026-09-06 in dedicated project `facio-kernel-sandbox-2026` under the Facio organization. The enabled Web application is named `Facio Kernel Sandbox`, uses Internal organization audience, has `https://platform.facio.io` as its sole JavaScript origin and `https://platform.facio.io/auth/callback` as its sole redirect URI. Both provider callbacks were read back after the canonical-domain update. Credentials are stored only in the private host environment and the operator's ignored directory. Registration does not establish that an actual user login passed; that requires hosted verification.

## Deploy a verified revision

The `Deploy shared Kernel sandbox` GitHub Actions workflow runs manually from `main`, repeats checks and browser workflows, builds `facio-kernel:<SHA>`, uploads a checksum-protected release bundle and invokes the host runner. Its dedicated Azure workload identity is federated to the exact observed immutable subject `repo:FacioMGA@261678800/facio-kernel@1359176242:ref:refs/heads/main`, issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`. No Azure client secret belongs in GitHub. New repositories use GitHub's ID-qualified subject format; see the [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc) and [Microsoft immutable-subject migration guidance](https://learn.microsoft.com/en-us/entra/workload-id/workload-identities-github-immutable-subjects). The original name-only trust failed with `AADSTS700213` and was replaced with this exact repository-and-main subject.

Repository variables: `KERNEL_AZURE_DEPLOY_CLIENT_ID`, `KERNEL_AZURE_TENANT_ID`, `KERNEL_AZURE_SUBSCRIPTION_ID`, `KERNEL_STORAGE_ACCOUNT`, `KERNEL_PUBLIC_URL`. Runtime identity secrets live only in the host configuration and the operator's ignored `.local` directory.

After deployment check the public `/health` for the exact build SHA and `environment: sandbox`, verify sign-in and permission revocation, inspect the same draft/release through Studio and MCP, and run the accepted scenario. Health alone is not release acceptance.

## Backup and restore

`deploy/backup.py` uses SQLite's online backup API independently for `kernel.sqlite` and `auth.sqlite`, checks SQLite integrity and records SHA-256 hashes. It uploads both files and a manifest to a timestamped private blob prefix with overwrite disabled. Backups contain sensitive auth state and must never be made public. The two databases are not a single cross-database transaction snapshot; code must not depend on cross-database atomicity.

The hourly systemd timer runs the backup as root with the VM's managed identity. A process lock serializes timer and deployment backups. After a complete successful upload, only the newest local snapshot is retained; private off-host snapshots retain history, with blob versioning and 30-day soft deletion enabled. The VM uses Azure IMDS tokens in memory; neither account keys nor SAS URLs are required. Verify timer failures and periodically rehearse recovery. The timer was enabled after both databases initialized and representative recovery passed on 2026-09-06.

To rehearse an existing backup without touching live data:

```sh
sudo bash -c 'set -a; source /srv/facio-kernel/deploy/storage.env; set +a; python3 /srv/facio-kernel/deploy/rehearse-restore.py <exact-snapshot-id>'
```

The rehearsal downloads the off-host copy to a new directory, checks both hashes and SQLite integrity, and emits `restore-evidence.json`. Before claiming full recovery, start a compatible pinned application against that restored copy on an isolated loopback port and verify representative records/releases. Never overwrite live data automatically during a code rollback.

Deployment and restore evidence must record date, source SHA, image digest, backup prefix, database checks and actual user workflow results. A workflow file or provisioned VM alone is not a successful hosted handover.

## Provisioning verification — 2026-09-06

The isolated VM, networking, managed disk, private containers, Entra registration, Google registration and GitHub workload federation exist. Caddy returned publicly trusted HTTPS with HSTS; `/health` returned the expected 502 while no application was running. The VM's managed identity uploaded and downloaded `backups/provisioning-20260906/storage-probe.json`, with an exact byte comparison. That file contains only a synthetic provisioning probe, not application data.

The empty VM was rebooted at 15:20 UTC: its dedicated ext4 disk remounted and Docker/Caddy started successfully. The `platform` CNAME was then added at the user's request and read back from both authoritative nameservers. Cloudflare's public resolver returned the correct CNAME and Azure IP. Let's Encrypt issued the canonical-domain certificate at approximately 15:27 UTC; hostname and trust verification passed, and the Azure hostname returned a 301 redirect to `https://platform.facio.io`. Other resolvers can retain their earlier negative answers until DNS cache expiry.

Host configuration permissions and the ext4 data mount were checked. At this initial provisioning checkpoint the backup timer was disabled and application verification had not started. The later hosted and recovery results below supersede that checkpoint.

## Hosted release and recovery verification — 2026-09-06

The deployed source revision is `55e155977df60b4d67ef7fa0710869f9d6bf1fe9`. Public HTTPS health, `/studio`, served JavaScript/CSS and OAuth metadata were checked against that revision. The running image is identified by Docker image-config digest `sha256:26e659653e9a78cafaeb5e20871377ad745bfad0d9598bf3f996e24a562b56db`; the uploaded release archive has SHA-256 `d53d5f99424c653e132fd7bc856a762d196717681d3089a8b8944489d6c16f22`. This image excludes compiled customer fixtures and development entry points.

An actual Google organization administrator signed in. Alpha and Beta synthetic tenants were created through Studio with distinct server-assigned identities. Alpha's explicitly synthetic requirements, configuration and policy were activated as release `b513a5eb-ae03-4df0-9d72-13414c5d8da1`. Its manual quote was created and bound as record `ecda8573-e89f-49df-b90d-ada3f3cb2edf`, retaining Quoted v1 and Bound v2: GBP 1,000.00 premium, 7% commission (GBP 70.00), and 100% capacity allocation. Beta remains awaiting requirements with no release. These are synthetic administrator checks; fresh intern sign-in, a ChatGPT connector action, customer golden journeys and customer acceptance require separate evidence.

Off-host snapshot `20260906T155716.227959Z` was downloaded into a separate recovery directory. Both database checksums and SQLite integrity passed. The same pinned image started against those copies on loopback port 4311, reported the exact SHA, and retained authentication requirements. Existing compiled Store read methods verified Alpha's exact release, record, financial amounts, immutable history and event hash chain; reading Alpha's record through Beta's scope failed. The original live container and data were not replaced by the recovery copy. The drill reused the existing private provider configuration and bootstrap; total VM-loss and credential reprovisioning were not rehearsed.

An ordinary live-container restart at 16:01 UTC preserved the same managed-disk database files, active release and Bound record hash. The actual Google browser session also survived without signing in again; the Alpha Insurance workspace still showed the bound record, pinned release, financial amounts and both history versions. The hourly backup timer is enabled and active. Its systemd service passed a manual run at 16:02:29 UTC, uploading snapshot `20260906T160229.371535Z`; the first scheduled firing had not yet occurred when evidence was captured (next scheduled at 17:00:11 UTC).

Sanitized evidence: [public release](evidence/2026-09-06-public-release.json), [running host/image](evidence/2026-09-06-host-runtime.json), [initial browser provisioning](evidence/2026-09-06-live-browser.json), [Alpha UI journey](evidence/2026-09-06-alpha-ui-journey.json), and [recovery, restart and timer](evidence/2026-09-06-recovery.json). Credentials, session values and source-quote payloads are excluded from these receipts.

## Insurance definition upgrade (business schema 5)

The configured insurance decision release adds optional versioned insurance definitions and retained decision evidence. It advances the business database marker from 4 to 5 without rewriting historical configuration, releases, records or event hashes. Auth storage remains schema 1. Existing manual quotes and policies continue to use their pinned releases.

A schema-4 image must refuse an upgraded schema-5 database. Consequently, the previously deployed image is not a compatible rollback target after this upgrade. The activation script still preserves both databases and attempts an earlier image only if it can start; an incompatible image requires an operator to deploy a compatible corrective build. Never restore an older database automatically to make an old image start: that can erase subsequent transactions. Retain the pre-upgrade off-host backup, verify the old Alpha record hash and history after upgrade, and rehearse restored schema-5 data with the exact new image before accepting recovery for this release.

Structured product configuration lives at Studio → Product definitions. A rich product has one insurance definition under its product version; legacy metadata fields are empty for that product. Source references are declarations, not approvals. Save the definition, review its operating policy and requirements in Sandbox setup, then activate the exact candidate. Insurance workspace evaluates the active definition. A draft save alone does not change quote behavior. Unsupported approval, payment or provider prerequisites continue to prevent binding.

The schema-5 upgrade was deployed at SHA `58d391d0e2388a80733552835e96c59acb2a23d1` and its [read-only baseline](evidence/2026-09-06-insurance-upgrade.json) verifies both database integrity checks, exact image/archive identity, Alpha historical hashes and Beta isolation. The [live training journey](evidence/2026-09-06-insurance-ui-journey.json) adds a separately configured product, invalid/referral/eligible evaluation and retained GBP 100 bound record. Snapshot `20260906T173100.438840Z` was captured immediately before activation. [Pre-upgrade evidence](evidence/2026-09-06-insurance-preupgrade.json) also confirms the first scheduled backup fired successfully at 17:00:12 UTC.

[Schema-5 recovery receipt](evidence/2026-09-06-insurance-recovery.json): snapshot `20260906T174434.656503Z` was fetched from private off-host storage, verified and booted on the exact `58d391d` image at isolated loopback port 4311. Compiled Store reads reproduced Alpha/Gamma record and history hashes, recomputed both configured decisions and verified Beta isolation. Immediate pre-upgrade schema-4 snapshot hashes were checked separately. The isolated container was removed; live databases/container were not replaced or restarted. A bounded cleanup retry handled Docker asynchronous removal. Existing identity/bootstrap configuration was reused; full VM-loss or credential recovery and restored browser/ChatGPT execution were not tested.

The final setup-copy build `fa874bbe7fa2b114698d89f84f9ffae97c28ce35` is deployed on the same schema 5/1. Its [runtime receipt](evidence/2026-09-06-insurance-final-runtime.json) pins image/archive identities and unchanged Alpha/Gamma records. The [final-image drill](evidence/2026-09-06-insurance-final-recovery.json) re-downloads the verified 17:44:34 backup and boots the final image with copied databases; exact records, decisions and isolation pass. The prior `58d391d` image now shares schema 5 and the same backend code, but a failed-deployment rollback exercise is still separate evidence. No old schema-4 image should be used against schema 5. [Browser reload evidence](evidence/2026-09-06-insurance-final-browser.json) confirms the existing Google session reopened Gamma’s bound record and immutable decision trace after the final upgrade.

## Independent review and provider execution upgrade (business schema 6)

The deployed schema-6 release adds independent review revisions, immutable approvals and a durable provider queue. Migration is additive: existing configurations, activated releases, quotes, allocations, history and outbox rows retain their values and hashes. Local migration coverage reconstructs the schema-5 layout and compares every retained table after upgrade. The release requires a pre-upgrade off-host backup and exact-image recovery proof before its deployed status is accepted.

A schema-5 image refuses schema 6 before changing database bytes. After this migration, use a compatible corrective build for recovery; never automatically replace current data with an older snapshot to make an earlier image start. Restore rehearsals use separate copied databases on loopback port 4311 and must not replace the active writer. The authentication database remains at schema 1.

Hosted startup registers only `synthetic_quote_evidence` and starts a single durable worker in the existing application process. The adapter returns explicitly synthetic evidence derived from an already retained configured quote. It does not contact an insurer, change the quote's price or satisfy bind, payment or screening prerequisites. Independent review resolves only the retained supported referral or routine approval gate; bind independently rechecks the exact quote, approval, expiry and remaining gates. Review mutations require browser authentication and CSRF; the canonical MCP surface exposes their reads only. Builders request reviews; account owners/admins decide, with server-enforced separation from the original creator, current quote author and requester.

Registered live adapters can receive exact JSON bytes at `POST /provider-callbacks/:adapterId/:requestId`. Callback scope is derived from the immutable server request. The HMAC verifier authenticates `timestamp + '.' + nonce + '.' + exactBody` using SHA-256, a minimum 32-byte privately registered secret and timing-safe comparison. Headers are `x-provider-timestamp` (canonical Unix seconds), `x-provider-nonce` and `x-provider-signature` (lowercase hex). Freshness, nonce replay, request correlation, outbound idempotency, quote/risk identity and response ordering are checked before retaining evidence. The request body limit is 1 MiB. Public synthetic callbacks are rejected. No live adapter, provider secret or customer endpoint is configured by this release.

The worker claims within short database transactions and performs adapter I/O outside them. Timeout or an expired execution lease creates an ambiguous outcome requiring reconciliation; it does not blindly send the same business request again. Attempts, deadlines, failures and accepted receipts are durable. Duplicate authenticated callbacks return the original receipt; superseded replies remain historical evidence and cannot consume a newer request's active response sequence. Failed callback authentication is rejected without writing attacker-controlled workflow revisions. These controls establish adapter infrastructure; live customer mapping, reconciliation endpoints and customer conformance evidence are separate acceptance work.

## Verified review/provider release — 2026-09-06

[PR #25](https://github.com/FacioMGA/facio-kernel/pull/25) delivers the review and provider workflow; [PR #26](https://github.com/FacioMGA/facio-kernel/pull/26) clarifies retained product evaluation versus current human review. The verified application build for that increment was `b5f38d4fa1850f28458babe70b6e0714481a2f3d`, image-config digest `sha256:88b5b5847b4ed6acb6dd1028454a4c08f993c78cbd15f5b94a654c203760281f`, release archive SHA-256 `e35cff0328018dd6cdbdcae34c9e79b7ab610822e8d19a556667ee67885936c4`. [Main CI](https://github.com/FacioMGA/facio-kernel/actions/runs/34053126098) and [deployment](https://github.com/FacioMGA/facio-kernel/actions/runs/34053131692) passed 123 tests and all seven browser suites. [Public verification](evidence/2026-09-06-review-provider-public.json) matches 12 served assets to that source and denies six anonymous protected surfaces.

The [actual Google-session journey](evidence/2026-09-06-review-provider-browser.json) retained a separate synthetic GBP 100 referral in Gamma, requested independent review, verified binding rejection and self-review denial, and observed one completed synthetic provider receipt. Final browser reload retained the quote, pending review and receipt without changing the price or version. The requester has not been replaced by a fabricated reviewer; a second actual administrator still needs to decide this training case. Existing Alpha/Gamma bound records and Beta isolation are unchanged in the [final runtime receipt](evidence/2026-09-06-review-provider-runtime.json).

[Exact-image recovery](evidence/2026-09-06-review-provider-recovery.json) downloaded and verified both private off-host snapshots: pre-upgrade schema 5 `20260906T183402.689170Z` and schema 6 workflow snapshot `20260906T184858.117152Z`. The final image booted against each isolated copy, migrating only the schema-5 recovery copy. These containers used network isolation with no host ports; health and anonymous-denial probes ran inside each container over loopback. Compiled repositories reproduced historical records, decisions and tenant isolation; the schema-6 restore also reproduced the exact pending review, completed provider receipt and audit chain. The prior schema-5 image rejected the actually migrated copy with `STORAGE_SCHEMA_TOO_NEW` before changing bytes. Both isolated containers were removed. Live data and the active container remained untouched by the drill.

This completes bounded recovery evidence for this application image. The drill reused existing private identity/bootstrap configuration; independent intern sign-in, restored browser/ChatGPT execution, failed-deployment recovery, total VM/credential loss and customer-provider acceptance remain separate work. Documentation-only reconciliation commits may advance `main` without changing the explicitly recorded serving application SHA.

## Sprint 5 transactions and required Rust core (business schema 7)

Sprint 5 advances business storage to schema 7 and retains auth schema 1. New tables retain document attempts/artifacts, finance journals/receipts/applications and loss-notice revisions; linked renewal identity is unique within scope. Earlier policy, decision, review/provider and outbox histories remain intact. A schema-6 image cannot restart against schema 7. Recovery must use a compatible corrective build; the activation script never replaces current transaction data with an old snapshot.

The deployment workflow runs `deploy/run-preflight.py --sha <full-verified-SHA>` after uploading the immutable image and before activation. On the host, the reviewed runner checks the archive and image identity, takes independent read-only SQLite backups and replays only disposable copies using the exact image ID with networking disabled. The authentication mount contains schema/version markers and zero authentication data rows. Original table counts and record heads, all retained releases/requirements, decisions, approvals, provider receipts, documents, loss notices, finance and outbox lineage are checked. Azure provisioning status alone cannot authorize activation: a bounded exact success receipt is required. Replay failures preserve the existing live writer.

The canonical allocation and commission core requires the pinned Rust/WASM artifact and manifest. Hosted startup verifies them before opening storage; an absent, corrupt or incompatible module stops startup. Inspect `/health.moneyEngine` alongside the exact release SHA and compare its module fingerprint with the built artifact. No silent TypeScript fallback exists. Local and CI allocator benchmarks do not establish actual cloud-bill savings.

Hosted document generation uses an explicitly synthetic registered pack and a single durable worker. Loss notices are internal synthetic intake and acknowledgement; no public claim link or external claims route is available. Finance writes require an account owner/admin; builders can inspect finance and use authorized document/intake commands. Synthetic receipts do not verify a payment or execute a transfer. Dated report CSV is not customer BDX acceptance.

For final recovery, pin the off-host snapshot manifest and both database hashes, restore into an isolated directory, replay its retained histories with the exact deployed image and then verify actual hosted startup and anonymous-session denial without publishing ports. Preserve snapshot bytes and live writer identity throughout. Existing private identity/bootstrap material may be reused only within that isolated check and must be stated in the receipt; this is not full VM/credential-loss recovery. Customer acceptance, independent intern/reviewer and actual ChatGPT acceptance remain separate.

## Verified Sprint 5 release — 2026-09-07

[PR #28](https://github.com/FacioMGA/facio-kernel/pull/28) and the conditional-question correction in [PR #29](https://github.com/FacioMGA/facio-kernel/pull/29) are deployed as `5287a070713a2ec3bff628fc7d7620813cf4d5b8`, image-config digest `sha256:48a31c2e85e40652913fcd4727669f05056a309554e6e2a2719fad2b0f44c134`, archive SHA-256 `962bb364883d676f52b0a73dbdc98c9843e542a6c83fb41dfb95ba3416f11383`. The [release overview](evidence/2026-09-07-sprint5-release.json) links exact CI, public assets, actual Google-session workflow, downloaded PDF/CSV and recovery evidence. Documentation-only reconciliation commits can advance `main` without changing this serving application SHA.

The existing backup service produced private off-host snapshot `20260907T074651.855869Z`, manifest SHA-256 `50e5ca0c392ee9c8da28873382a65027cdcae71155cb4432ab3a7d98765531f4`. [Final recovery](evidence/2026-09-07-sprint5-final-recovery.json) verifies both database hashes/integrity and schema 7/1, exact business replay before and after isolated hosted startup, required Rust fingerprint and anonymous-session denial. Five insurance records, four completed packs/16 artifacts, the internal notice, finance, prior review/provider and outbox histories match the preflight evidence. Original snapshots and the live container were preserved. The isolated containers were removed.

The first recovery attempt failed its cleanup assertion because Docker's automatic removal had not completed immediately after stop. A read-only inspection found no remaining drill container and a healthy unchanged live writer. The verifier was corrected to allow bounded cleanup, rechecking exact drill name, ownership label and container ID before any removal; 12 mock cases and three disposable Docker cases passed. The complete recovery was then repeated successfully. This was a verifier timing defect, not an application rollback or overwrite of live data.

This is same-VM recovery using existing private identity/bootstrap configuration. Independent cross-database atomicity, restored authenticated browser/ChatGPT use, failed-deployment recovery, total VM/credential loss, independent intern/reviewer and customer acceptance are not established by this drill.
