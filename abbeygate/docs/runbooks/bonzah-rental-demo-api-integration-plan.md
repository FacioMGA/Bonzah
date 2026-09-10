---
title: Bonzah rental demo API integration plan
audience: developer
status: living
owner: product-platform
reviewed: 2026-09-07
binding: false
---

# Bonzah rental-partner demo API integration plan

## Purpose

Build one coherent first demo showing how a rental company can add Bonzah
rental protection to its existing checkout through an API.

The demo has two views of the same integration:

1. Summit Rentals is the customer-facing rental website.
2. The Bonzah API is the insurance service behind that website.

Postman is supporting technical evidence. It is not a second customer
experience and it is not used to build the website.

This plan does not include rebuilding the full Bonzah direct-to-consumer
website. That is a later demo.

## Recommended architecture

Keep the existing Abbiegate Bonzah rental module and extend it. Do not create a
duplicate standalone demo API.

The existing module already provides the correct foundation:

- a canonical rental rating service;
- vehicle and coverage fixtures;
- quote identity, expiry, idempotency, correlation and integrity checks;
- a public adapter used by Summit Rentals;
- a partner adapter used by Postman;
- quote retrieval and simulated bind operations;
- visibly synthetic `DEMO BUILD` and `SIMULATED` statuses.

The important architectural rule is that both website and partner routes must
continue to delegate to the same quote service. A quote created in the browser
must be retrievable through the partner API with the same quote ID, totals,
coverages and rule version.

## End-to-end behavior

The intended flow is:

1. Summit collects the rental dates, location, driver and vehicle selection.
2. The renter selects Bonzah coverages.
3. Summit sends the rental risk and coverage selection to the Bonzah quote API.
4. The API validates the request, applies the demo rating rules and returns a
   quote decision.
5. Summit displays the returned eligibility, price, coverages, warnings and
   quote reference.
6. The renter completes the review form.
7. Summit sends the quote integrity data and simulated payment status to the
   bind endpoint.
8. The API rechecks the quote and returns a simulated confirmation.
9. Summit displays the confirmation.
10. Postman optionally retrieves the same quote and repeats the bind request to
    prove that an external rental partner can use the same API contract.

## API work

### 1. Stabilize the contract

Keep the existing partner endpoints as the core contract:

- `GET /api/v1/bonzah/vehicles`
- `GET /api/v1/bonzah/demo/configuration`
- `POST /api/v1/bonzah/quotes`
- `GET /api/v1/bonzah/quotes/{quoteId}`
- `POST /api/v1/bonzah/quotes/{quoteId}/bind`

Document the request and response examples for the golden RAV4 journey and
the important outcomes:

- quoted vehicle;
- declined Porsche;
- referred high-value vehicle;
- invalid SLI selection without RCLI;
- repeated create and bind calls using the same idempotency key;
- altered total or invalid integrity token rejected at bind time.

### 2. Make the API state understandable

Ensure every response contains enough information for the website and the
meeting narrative:

- quote or confirmation ID;
- status;
- total and currency;
- selected coverages and individual prices;
- rule version and effective date;
- expiration time;
- customer-facing explanation;
- demo/simulation label;
- correlation ID for tracing the journey.

If a lightweight activity view is added, expose a safe, demo-only activity
record containing operation name, timestamp, status, quote ID and correlation
ID. Do not expose secrets, raw authorization headers or internal rule details.

### 3. Preserve demo safeguards

Keep partner bearer authentication, `X-Partner-Id`, idempotency requirements,
quote ownership checks, expiry checks, integrity checks and bind-time rerating.
Keep reset support so each meeting starts from deterministic synthetic data.

Do not represent the demo bind as a real policy, payment, carrier transaction
or certificate issuance. The API should continue to label those outcomes as
simulated.

### 4. Align public and partner behavior

The browser currently uses the public Bonzah adapter while Postman uses the
authenticated partner adapter. This is acceptable and intentional, provided
both call the same application service.

The UI and Postman examples should use equivalent payloads so the audience can
see that the two adapters converge on the same canonical result. Do not add a
second rating implementation to make the paths look similar.

### 5. Improve API proof materials

Update the Postman collection and environment so the presenter can run one
short sequence:

1. Create the golden quote.
2. Retrieve the exact quote.
3. Bind it with the returned integrity token and total.
4. Retry bind to demonstrate idempotency.

Keep the negative examples in a separate folder so they are available for
technical questions without interrupting the primary story.

## Summit website work

### 1. Make the integration visible

The renter should experience a normal rental checkout. The page should not
look like an API test tool.

At the appropriate points, show concise language such as “Bonzah protection”
and “Price provided by Bonzah.” Avoid exposing internal service names or
implementation jargon to normal renters.

### 2. Display returned quote data

After rating, show the data returned by the API:

- coverage selection;
- total price;
- eligibility or referral outcome;
- relevant warnings or requirements;
- quote reference;
- clearly marked illustrative/demo status.

Do not calculate a separate browser total. The displayed total must come from
the canonical API response.

### 3. Complete the review journey

Keep the review form as the final customer step. The Confirm booking button
should remain at the bottom of the form, after all required fields and
acknowledgements, rather than in a sticky bottom bar or before the form is
complete.

On confirmation, show the confirmation ID, quote ID, total and timestamp. Keep
the customer-facing confirmation natural and uncluttered; the technical API
view retains the underlying demo status fields.

### 4. Add a presenter-only API activity view

Add a compact panel or expandable drawer that is available only to the
presenter. It should show the same journey at a high level:

- quote request sent;
- quote returned;
- quote ID stored;
- bind request sent;
- simulated confirmation returned.

The panel should use friendly labels and avoid turning the renter page into a
developer console. Keep the customer-facing checkout clean; the presenter can
open “Integration details” after the customer flow.

### 5. Keep the existing outcome coverage

The main happy path should use the RAV4. The presenter should still be able to
show that the API is making decisions, not only returning a fixed price:

- Corolla produces a lower illustrative price;
- Tesla produces a higher illustrative price;
- Porsche is declined;
- the ambiguous luxury trim is referred;
- SLI cannot be selected without RCLI.

## Data and environment requirements

- Use the existing local PostgreSQL and Redis setup required by Abbiegate.
- Use the existing synthetic tenant, program, fixtures and effective-dated
  demo rules.
- Reset the process-local quote store before a presentation.
- Keep demo bearer credentials local and clearly marked as non-production.
- Ensure the frontend and API base URLs are documented for the presenter.
- Keep all prices, policy language and coverage limits marked as illustrative
  until Bonzah confirms approved wording and values.

## Testing and acceptance criteria

### Automated checks

- API schema tests pass for valid and invalid quote requests.
- Quote creation is idempotent for the same partner and key.
- Reusing a key for a different request is rejected.
- Quote retrieval returns the stored canonical snapshot.
- Bind rejects missing or invalid integrity data.
- Bind rejects changed totals, expired quotes and non-quoted outcomes.
- Bind is idempotent and returns the original confirmation.
- Browser and partner API return matching totals for the golden request.
- Existing frontend build, backend type check and Bonzah unit tests pass.

### Manual acceptance

- A presenter can reset the demo and complete the happy path in a few minutes.
- The price shown in Summit matches the price returned by the API.
- The quote ID shown in Summit can be retrieved in Postman.
- The confirmation shown in Summit matches the API bind response.
- A client can understand which parts are customer UI, API behavior and
  simulated demo behavior without reading source code.

## Client meeting presentation

Present it as one story, in this order:

1. **Set the context:** “This is a rental company that wants to add Bonzah
   protection without rebuilding its checkout.”
2. **Show Summit Rentals:** choose dates, vehicle and protection as a renter.
3. **Point out the result:** explain that the displayed quote and price came
   from Bonzah’s API.
4. **Finish the form:** complete the review fields and confirm at the bottom.
5. **Show the confirmation:** point out the quote ID, confirmation ID and
   returned booking status.
6. **Show the integration proof:** open the API activity view or Postman and
   show the matching quote request, response and bind result.
7. **Show one decision example if time allows:** use the Porsche decline or
   SLI/RCLI dependency to demonstrate that the API applies rules rather than
   returning a hard-coded success.
8. **State the boundary clearly:** this is an embedded rental-partner API
   integration demo with synthetic rating and bind behavior. The full Bonzah
   direct website and production carrier/payment/policy integrations are later
   work.

The business audience should see the customer journey first. Technical
audience members can then see the request, response, authentication and
idempotency details. Do not begin by showing raw JSON or building frontend
code live.

## Decisions to confirm before implementation

### 1. API activity view

**Decision:** include a small presenter-only activity view. It makes the
integration obvious without requiring Postman, while Postman remains available
for technical reviewers.

It should only be available through an “Integration details” control for the
presenter.

### 2. Payment and policy status

**Decision:** keep the current simulated payment and confirmation behavior in
the API. Do not add a simulation label to the normal customer-facing Summit
experience. The API response and Postman output may retain the existing
`DEMO BUILD` and `SIMULATED` fields so the technical output remains accurate.

No real payment, policy issuance or carrier transaction is added at this stage.

### 3. Coverage wording and limits

Bonzah’s current public website describes primary rental insurance through CDW
or LDW, rental-car liability through RCLI, supplemental liability through SLI,
and personal accident/effects protection through PAI/PEI. It also notes that
availability and limits vary by jurisdiction. The current demo already maps to
those four coverage families: `CDW`, `RCLI`, `SLI` and `PAI_PEI`.

**Decision:** use those coverage families in the demo, but keep prices, limits,
exclusions and legal wording illustrative until Bonzah provides an approved
partner-specific table. [Bonzah coverage overview](https://www.bonzah.com/)

### 4. Postman in the meeting

**Decision:** show the API result in JSON during the presentation and prepare a
shareable copy of the JSON output. Postman should come after the customer flow,
so it demonstrates the same quote and confirmation rather than becoming a
separate, disconnected demo.

The presenter can show the request, response, quote ID, total, rule version,
correlation ID and bind response. Headers and authentication can be explained
if technical stakeholders ask for them.

### 5. Demo boundary

**Recommendation:** keep certificates, endorsements, claims/FNOL, reporting,
full policy documents and the rebuilt Bonzah direct website for the next demo.

Based on the learnings available, keep certificates, endorsements, claims/FNOL,
reporting, full policy documents and the rebuilt Bonzah direct website for the
next demo. Add one of these to the first demo only if a meeting requirement
explicitly calls for it.

## Definition of ready to implement

Implementation can begin once the team agrees that the first demo is:

> A Summit Rentals checkout that consumes the existing Bonzah rental API for
> quote and simulated bind, visibly displays the returned results, and can be
> corroborated through an API activity view or Postman.

Anything outside that sentence should be treated as a separate decision or as
scope for the later Bonzah direct-to-consumer demo.
