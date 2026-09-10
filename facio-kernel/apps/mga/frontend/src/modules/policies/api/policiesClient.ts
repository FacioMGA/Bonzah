/**
 * policiesClient — Transitional Composition
 *
 * Composes all policy sub-domain API clients into a unified surface
 * that existing consumers can import without changing their call sites.
 *
 * New code should import directly from the sub-domain client it needs:
 *   - policyCrudApiClient
 *   - endorsementsApiClient
 *   - cancellationApiClient
 *   - policyVersionsApiClient
 *   - questionnaireApiClient
 *   - pricingApiClient
 */
import { policyCrudApiClient } from './policyCrudApiClient';
import { endorsementsApiClient } from './endorsementsApiClient';
import { cancellationApiClient } from './cancellationApiClient';
import { policyVersionsApiClient } from './policyVersionsApiClient';
import { questionnaireApiClient } from './questionnaireApiClient';
import { pricingApiClient } from './pricingApiClient';
import { submissionMemoryApiClient } from './submissionMemoryApiClient';

export const policiesClient = {
    ...policyCrudApiClient,
    ...endorsementsApiClient,
    ...cancellationApiClient,
    ...policyVersionsApiClient,
    ...questionnaireApiClient,
    ...pricingApiClient,
    ...submissionMemoryApiClient,
};

export type PoliciesClient = typeof policiesClient;
