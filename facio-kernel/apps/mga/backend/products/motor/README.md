# Motor Product

Motor rating, documents, Green Card output, and BDX migration must use the jurisdiction-aware product configuration layer.

Canonical architecture doc:

- [`docs/architecture/jurisdiction-product-config.md`](../../../docs/architecture/jurisdiction-product-config.md)

## Jurisdiction Rules

Motor behavior must be resolved through:

```ts
resolveJurisdictionProductConfig({
  productCode,
  program,
  binder,
  tenant,
  source,
})
```

Do not infer country from quote fields inside pricing, documents, Green Card generation, or BDX mapping. The effective jurisdiction key is product + binder + country, optionally refined by Program and source.

## Tax Profiles

All Motor tax calculation goes through `calculateMotorTaxes()` and a named tax profile.

Current profiles:

- `CY_MOTOR_ABBEYGATE_CURRENT`
- `PT_MOTOR_VOLANTE_BDX_12_9_CONVERGENCE`

The PT profile implements the Volante Portugal BDX convergence method:

- Green Card Fee is excluded from the tax base.
- Tax Value converges to 12.9% of Net Premium.
- FGA is a balancing figure.
- Tax rows are emitted as structured `TaxBreakdown` with explicit rounding metadata.

Do not add country branches next to the tax engine. Add or update a profile instead.

## Documents And Green Card

Motor templates and view models must not hardcode jurisdiction wording. Use:

- `documentConfig` for premium display, wording reference, location, and assistance labels.
- `greenCardConfig` for bureau name, country code, code prefix, insurer code, and territory wording.

CY output must remain stable because the CY config encodes current behavior. PT output must come from PT config.

## No Parallel Truths

- Do not add country-based conditionals such as `if country === ...`.
- Do not duplicate tax or document logic.
- Do not keep old CY helper paths as runtime fallbacks.
- Missing config must fail with `ProductConfigurationError`.

## Adding A New Country

1. Add Motor jurisdiction config.
2. Add a named tax profile or explicitly mark tax unsupported.
3. Add document and Green Card config.
4. Add BDX import/export config.
5. Add golden BDX reconciliation tests.
6. Confirm core pricing/document/BDX logic did not need country-specific edits.
