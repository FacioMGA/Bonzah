# Source and deployment reconciliation backlog

Baseline: 2026-09-06. This is the M3 inventory seed. No public documentation or customer contract has been changed.

| ID | Evidence / current owner | Required resolution | Status / accountable role |
| --- | --- | --- | --- |
| SOT-01 | This repository's `src/contracts/{configuration,operations,artifacts}.ts` and `src/domain/catalog.ts` | Canonical local schemas, explicit operation descriptors, catalog and generated artifacts. Compare served HTTP/OpenAPI/MCP results against this build; test mismatches. | Local implementation verified; production contract ownership still proposed / Platform |
| SOT-02 | Abbeygate `backend/platform/openapi/openapi.ts`; HTTP docs re-export | Keep current owner and compatibility re-export. Identify contract consumers before extraction, preserve actual customer differences. | Read-only source audit, no retirement / API lead |
| SOT-03 | Attsure platform registry, cited by deployment baseline | Re-query deployed route/auth/webhook/idempotency contract and capture immutable source/build evidence. | Unknown live state / API + Attsure owner |
| SOT-04 | PolarisRe separate legacy registry and HTTP wrapper chain, cited by deployment baseline | Trace active consumers before correcting unrelated customer server metadata or retiring duplicate output. | Not verified in this implementation / PolarisRe owner |
| SOT-05 | Bonzah API requirements contains coverage prose and Insillion repository link | Retrieve/approve the actual current compatibility contract; no drop-in compatibility claim until parity evidence. | Source received, endpoint contract unverified / Bonzah integration owner |
| SOT-06 | Website `llms.txt` generator, separate `llms-full.txt`, developer/docs/MCP links, cited by baseline | Trace hosting, generators, releases, cache/search publication and ownership. Generate version-matched projections after runtime verification. | Not verified / Developer Experience |
| SOT-07 | `deployments/registry.json` | Complete customer × environment × region inventory from authenticated runtime observations. Capture SHA/digest, hashes, storage/key references, backup/restore, owners and recovery objectives. | Eight customers seeded, all live resources explicitly unknown / Platform Operations |
| SOT-08 | CRM commercial ownership and website integration, supplied baseline | Establish account/subscription/tenant/entity mappings; verify database plus upload recovery and one writer for commercial state. | Unverified, no CRM mutations / CRM + Billing owners |
| SOT-09 | Published doc/SDK/explanatory sources | Version released explanatory text and discover all downstream generated copies before enabling documentation publication pipeline. | Not implemented / Developer Experience |

The local manifest distinguishes a canonical MCP contract hash from the permission-filtered discovery hash and also pins the configuration catalog. A reader credential therefore does not trigger false drift against the editor's larger tool set. Planned production promotion remains unavailable; the current mismatch checker is a tested local gate, not an installed deployment monitor.

Unknown means evidence has not been verified. It never means not deployed. Customer migrations require the supplied G0/G1/G2 readiness evidence and retain their own operational lanes and single authoritative writers.
