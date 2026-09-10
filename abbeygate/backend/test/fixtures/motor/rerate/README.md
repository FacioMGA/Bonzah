# Motor re-rate synthetic fixtures

Synthetic Cyprus motor quote-data inputs that exercise the
post-ADR-0023 rating ladder. None of these fixtures contain real
customer PII (no real NIFs, registrations, names, or addresses).

Each `*.fixture.ts` exports a `QuoteData` literal plus a
`SchemeOptions` map (the second argument to `resolveCoverageV1` /
`calculateAutoInsuranceQuoteResponse`). The matching expected total
in `scheme-alignment-staging-rerate.test.ts` is the value the current
motor engine emits for that input, pinned to the cent.

## Generation steps

1. Construct a synthetic `QuoteData` covering a representative band of
   the rating ladder (proposer age, NCB, vehicle value, vehicle use,
   driver restriction).
2. Run `npx vitest run backend/products/motor/pricing/__tests__/scheme-alignment-staging-rerate.test.ts`
   once with the expected total set to a placeholder; copy the actual
   total Vitest reports back into the test as the new pinned value.
3. Document the band each fixture exercises (small-car / mid-saloon /
   larger / SUV / mature-driver) inline in the fixture file.

## Changing a fixture

If the rating engine changes intentionally (ADR-amended), update the
pinned total to the new engine output. Reference the ADR in the diff.
