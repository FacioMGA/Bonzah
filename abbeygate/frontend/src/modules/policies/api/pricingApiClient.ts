/**
 * Pricing API Client — Sub-Domain (CHAMPS)
 *
 * Display-only / "what-if" pricing for the BO Premium tab. Owns:
 *   - `calculateProductPremium` — POSTs to `/policies/calculate-premium`
 *     (canonical road: `bindingRouter.ts → buildQuoteResponseForProduct
 *     → adapter.buildQuoteResponse`). Returns a `QuoteResponse` for the
 *     given `quoteData` + `overrideExcess` WITHOUT writing to `Policy`.
 *     Used to compute baseline-vs-current excess impact.
 *
 * Does NOT own:
 *   - The actual Premium → Recalculate action that writes
 *     `Policy.quoteResponse`. That is `policyCrudApiClient.rateQuote(...)`
 *     funnelling through `usePolicyLifecycleActions.handleReRate`.
 *   - Questionnaire / UW form submission — that's `questionnaireApiClient`.
 */
import { http } from '@/src/shared/api/http';
import type { UnknownRecord } from '@/src/shared/api/types';

export const pricingApiClient = {
    async calculateProductPremium(quoteData: UnknownRecord, overrideExcess?: number) {
        return http.request('policies/calculate-premium', {
            method: 'POST',
            body: JSON.stringify({ quoteData, overrideExcess }),
        });
    },

    async getQuoteDraft(policyId: string, premiumAmount?: number) {
        const query = premiumAmount ? `?premium=${premiumAmount}` : '';
        return http.request<UnknownRecord>(`policies/${policyId}/quote/draft${query}`);
    },

    async sendQuote(policyId: string) {
        return http.request(`policies/${policyId}/quote/send`, {
            method: 'POST',
        });
    },
};

export type PricingApiClient = typeof pricingApiClient;
