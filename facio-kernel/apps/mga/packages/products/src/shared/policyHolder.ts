/**
 * Canonical PolicyHolderProfile type.
 *
 * Phase 6k (2026-04-28): every product's `quoteData.proposer.*` (Travel,
 * Home, Motor) is shaped against this profile. Optional sub-fields are
 * driven by the product profile + the `<PolicyHolderStep />` `include`
 * flags; the type lists every possible field so that consumers (BO
 * underwriting tab, contract-artifact generator, schema validators) can
 * type-narrow on the canonical shape.
 *
 * No product duplicates this shape. No "policyholder fallback" or
 * canonical-shape preprocessor needs it. The Phase 7c
 * `check-architecture-locks.mjs` guard rejects re-introduction of any
 * flat-shape alias.
 */

export interface PolicyHolderAddress {
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postcode?: string;
  country?: string;
}

export interface PolicyHolderProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  /** Travel + Home use this for the cross-field email-match rule. */
  confirmEmail?: string;
  phone?: string;
  dateOfBirth?: string;
  nationality?: string;
  domicileCountry?: string;
  nif?: string;
  occupation?: string;
  /** Motor's "Where did you hear about us?" question. */
  whereDidYouHear?: string;
  marketingConsent?: boolean;
  /** Motor-style explicit privacy-policy acknowledgement checkbox. */
  privacyPolicyAccepted?: boolean;
  /** Best time to call (motor's contact-preferences declaration). */
  bestTimeToCall?: string;
  /** Travel-style identification block. */
  idType?: string;
  idNumber?: string;
  address?: PolicyHolderAddress;
}

/**
 * Multi-policyholder mixin (Framing A — Wave 3C, 2026-05-04).
 *
 * Products that allow more than one named policyholder (Travel groups,
 * Home joint owners) MUST extend their `quoteData` shape with
 * `PolicyHolderCollection`. The primary holder is still `proposer`
 * (canonical name kept to avoid a JSON migration); secondary holders
 * live under `policyHolders` and reuse `PolicyHolderProfile` so
 * downstream consumers (BDX export, claims prefill, doc rendering)
 * never branch on shape.
 *
 * Consumers MUST read these fields directly. There is no
 * `policyHoldersFromQuoteData` helper — the canonical-ownership guard
 * blocks any re-introduction.
 */
export interface PolicyHolderCollection {
  proposer: PolicyHolderProfile;
  /** Optional list of secondary policyholders. */
  policyHolders?: PolicyHolderProfile[];
}
