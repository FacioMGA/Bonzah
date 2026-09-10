# Bonzah demo evidence checklist

Updated 9 September 2026. This distinguishes completed local implementation from hosted evidence still required before the 10 September demo.

## Fixed identifiers and routes

| Item | Value |
| --- | --- |
| Workspace ID | `fd24a745-736e-4e70-9ffc-3c75438246e0` |
| Workspace slug | `bonzah-demo-fd24a745736e4e709ffc3c75438246e0` |
| Draft programme ID | `2cf34559-0bc5-440f-9cf9-a45adc5d9ef6` |
| Programme code | `bonzah-rental` |
| Canonical DTC entry | `https://platform.facio.io/quote/rental-car/new` with `workspace` query parameter |
| Summit partner entry | `/summit-rentals` |
| Public discovery endpoint | `POST /api/public/rental/coverages` |
| Public retained-quote lifecycle | `POST /api/public/rental/session`, then `POST /api/public/rental/session/:token/rate` |

## Local implementation evidence

- [x] RENTAL registered in the kernel product manifest and public runtime.
- [x] Pre-quote discovery works without a vehicle and returns eligibility, available coverages, dependencies, limits and reasons.
- [x] Discovery with a vehicle returns prices and fees from the same calculator used by quote rating.
- [x] Canonical `/quote/rental-car/new` route is declared; `/quote/rental/new` redirects while preserving query parameters.
- [x] RENTAL wizard invites resolve the `rental-search` first step for a US tenant.
- [x] US tenant, timezone, currency and US/RENTAL jurisdiction resolution are implemented.
- [x] Four coverage certificate document types render through the shared PDF/storage pipeline.
- [x] Summit calls discovery before vehicle selection, then retains a quote and stops without payment or bind.
- [x] Bonzah start page hands off to the canonical hosted rental route.
- [x] Browser pages use a same-origin public API proxy; no admin key, eligibility rule or local rate table is sent to the browser.

## Verification performed

| Scope | Result |
| --- | --- |
| Kernel focused tests | 67 passing across configuration, tenant time, invite, rental calculator/discovery and route compatibility (66 backend + 1 frontend) |
| Kernel type check | Passing |
| Kernel product-engine contract guard | Passing |
| Kernel Docker asset parity guard | Passing |
| Certificate focused tests and render smoke test | Passing; single-page A4 specimen visually inspected |
| Abbeygate focused tests | 2 passing (`demoApi`, kernel handoff) |
| Abbeygate TypeScript check | Passing |
| Abbeygate production frontend build | Passing |
| Abbeygate API entry import | Passing |
| Changed-file lint | No errors; one pre-existing exhaustive-deps warning in Summit vehicle loading |

## Hosted evidence still required

- [ ] Confirm with the platform owner whether the intended hosted execution contract is the current configurable adapter or the dedicated `RENTAL` runtime; do not infer recreation from the editor label alone.
- [ ] Deploy the kernel branch containing RENTAL public runtime, discovery, route and certificate changes.
- [ ] Create and activate a binder that authorises RENTAL in the Bonzah workspace.
- [ ] Resolve all eight programme publish blockers: four Ready product lines, Ready pricing, and numeric limit/deductible data for RCLI, SLI and PAI/PEI.
- [ ] Map the four rental certificate sources into the immutable programme document configuration.
- [ ] Publish the programme and read it back from the workspace.
- [ ] Deploy the Abbeygate branch and confirm both public URLs use the hosted workspace.
- [ ] Capture one eligible and one ineligible discovery response.
- [ ] Capture one Summit retained quote: public token, workspace policy ID, price, fees and rule version.
- [ ] Retrieve that retained record in Back Office and prove the same amount and identifiers.
- [ ] Run a DTC bind only after the programme/binder is active; download and inspect its selected certificates.
- [ ] Rehearse reset, DTC, Summit retained quote, Back Office lookup and certificate download.

## Current hard blocker

The Bonzah MCP connection is live and supports reads and drafts. A draft rating model was created and read back successfully. The automated programme cannot link/save against it until that rating model is published, and rating publication requires an eligible binder product authority. The workspace has no binder/product authority, and the exposed MCP surface can save a binder shell but cannot create per-product authority. The existing programme definition remains unchanged at version 2 after the rejected, atomic save attempts. Consequently, no hosted retained quote, bind or certificate can truthfully be claimed yet. The Feedback connection was repaired, but its status endpoint still returns an internal service error.

## Repository handling

Both implementation branches are committed locally. GitHub pushing is not part of the current plan and will occur only if Amit explicitly requests review or deployment.

## Demo disclosure

Rates, limits and regulatory metadata in this build are synthetic demonstration configuration and are not carrier-approved or production-ready. Summit retains a quote only; it does not take payment or bind coverage. The DTC path must not be presented as operational until the hosted binder/programme configuration and end-to-end evidence above are complete.
