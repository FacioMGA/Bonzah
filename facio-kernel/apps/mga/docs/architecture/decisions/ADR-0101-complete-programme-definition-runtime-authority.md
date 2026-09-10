---
title: ADR-0101 Complete programme definition runtime authority
audience: architect
status: draft
owner: platform-eng
reviewed: 2026-09-05
binding: true
amends:
  - ADR-0038
  - ADR-0098
  - ADR-0100
---

# ADR-0101: Versioned programme definition is the complete runtime authority

## Decision

1. A versioned `ProgrammeDefinition` is the sole runtime authority for one
   product programme. It has typed, product-owned components for pricing,
   underwriting, cover and endorsement catalogue, questionnaire sections,
   labels, field types, options, visibility and requiredness (including the
   claims contract), workflow and explicit `questions`, `quote` and `payment`
   channel permissions, and
   document-pack selection.
2. A published definition is explicitly mapped to one active
   `BinderProductAuthority`. The mapping, authority window and definition
   version are resolved once before quote, endorsement, bind, issue or document
   generation; the resolved immutable context is passed through the product
   adapter spine and recorded in the decision trace.
3. Product code owns only its semantic schema and generic calculation,
   decision and rendering operators. Insurer, programme, territory, monetary,
   threshold, discount, excess, wording, question and workflow values live in
   the definition components, never in product code or a surface. An
   automated pricing component also owns an ordered, typed executable
   pipeline: every enabled step names one product-owned operator and its
   configured table/input. The engine validates and executes that stored order
   and records the executed steps in the rating trace; a display-only or
   drag-only pipeline is forbidden.
4. Jurisdiction-only law, tax, regulatory, locale and statutory document
   requirements remain in `JurisdictionProductConfig`. A programme definition
   selects an approved jurisdiction configuration; it cannot duplicate or
   override jurisdiction values.
5. Manual products are explicit `pricing.mode: manual` definitions. They still
   have versioned underwriting, cover, questionnaire, workflow, channel and
   document components; absence of an automated price is not permission to use
   static product defaults.
6. Missing, unpublished, invalid, unauthorised or incomplete components fail
   with a named configuration error. There is no filesystem, metadata, prior
   version, country or product-default fallback after cutover.
   External-insurer issuance is a workflow component of that definition; a
   product adapter may not enable it with a static product flag.
7. ADR-0038's `Program.metadata` configuration slots are superseded for
   runtime behaviour. They may be retained only as one-time migration evidence
   while a reviewed draft definition is materialised; no BO, API or product
   runtime may read, write or initialise them after the relevant cutover.
8. ADR-0046's tenant-product channel switches are retired as runtime authority.
   Their historical rows may remain only until an approved retention migration;
   public and BO consumers resolve the mapped definition's explicit channel
   permissions, never a table, UI cache or public projection.
9. Each product supplies a typed, versioned configuration-editor descriptor for
   its own definition components and pricing pipeline. The BO renders that
   descriptor generically; it must provide editable matrices, factors and
   pipeline steps with validation, draft diff and quote simulation. It must not
   expose raw JSON as the primary authoring path or hard-code
   insurer/programme values in a surface.
10. `ProgrammeDefinition.documents` explicitly maps every selectable document
    type to one product-owned `sourceId` and `sourceVersion`. Product code owns
    only the rendering capability registry for those versioned sources; the
    mapped definition selects the source. Quote and policy decision snapshots
    persist the resolved definition id, version, binder authority and document
    component. Document generation consumes that immutable snapshot only; it
    must fail closed for a missing, duplicate or unsupported source and must
    not resolve the current definition, a static default, or a prior version.

## Delivery

1. Introduce the versioned definition and binder mapping, typed product
   component validators, BO editor/diff/publish/rollback, and decision trace.
2. Migrate pricing from `ProgramRatingModel` as the first component, then
   underwriting, cover/options, questionnaire/claims (including every rendered
   question and option), workflow/channel and
   document selection for Motor, Home, Travel, Health, Business and Open
   Market.
3. Materialise existing approved settings as immutable draft definitions,
   validate golden scenarios, publish only explicitly reviewed mappings, then
   delete the former runtime sources. Existing JSON is seed/test evidence only.
4. Retire the legacy underwriting and MBE configuration endpoints and BO
   panels. Operators edit the complete definition draft and publish it to the
   selected active binder-product authorities; a request that lacks that
   authority context is rejected rather than inferred.
   Retire legacy product-channel routes, editor and client projection with the
   channel component cutover.
5. Config MCP launch drafts may publish only the same complete definition and
   explicit binder mapping; their legacy metadata overlay writer is not a
   runtime configuration path.
6. Deliver a descriptor-driven BO editor for all components and products,
   including editable rating matrices and executable pipeline steps, draft
   diff, validation feedback, quote simulation and explicit binder mapping.

## Consequences

- Configuration changes alter behaviour without a code deployment, while code
  changes cannot silently alter an approved programme.
- The model adopts Coopr's programme + mapped-model composition, but rejects
  its legacy/default fallbacks: Abbeygate fails closed and retains an exact
  historical configuration version for every decision.
- Claims resolves its programme-specific contract from the published
  questionnaire component through the mapped authority. Product defaults and
  `Program.metadata.claimsConfig` are not runtime sources.
- Operators edit validated business fields rather than unstructured JSON; the
  same product-owned descriptor evolves without a BO product/country branch.
- ADR-0100 remains the pricing-component migration; it is not release-complete
  until the complete definition cutover above is complete.

## Links

- [Product engine authority](../contracts/product-engine-authority.md)
- [Jurisdiction product configuration](../contracts/jurisdiction-product-config.md)
- [Canonical ownership](../contracts/canonical-ownership.md)
