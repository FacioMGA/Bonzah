/**
 * Canonical list of country names used across product manifests and
 * customer-facing wizard surfaces. Sourced from the canonical Nationality
 * contract in `@facio/validation` so that the nationality dropdown and
 * the address/domicile/destination dropdowns share exactly one allowed
 * set. The consistency guard (`tools/quality/check-contracts-product-
 * consistency.mjs`) verifies set equality at CI time.
 *
 * Originated in `frontend/src/shared/data/countries.ts`; relocated here
 * in Phase 4; in the validation PR the list itself moved to
 * `@facio/validation` (canonical contract) and this file became a thin
 * re-export so existing import sites do not need to change.
 */
import { NATIONALITY_OPTIONS } from '@facio/validation';

export const countries: readonly string[] = NATIONALITY_OPTIONS;
