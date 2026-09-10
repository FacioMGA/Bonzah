import { defineFlow } from '@/src/shared/lib/wizard';

/**
 * Business public quote wizard flow.
 *
 * Unlike Home/Motor/Travel, Business is a manual-referral product
 * (`buildManualReferralRuntimeConfig`): there is no automated rating and no
 * payment. The flow therefore ends at "Review & submit"; the controller turns
 * the final action into a manual-review submission (sessionAdapter.rate) and
 * renders a confirmation screen instead of a price + payment step.
 */
export const businessFlow = defineFlow({
  id: 'business-public-wizard-v1',
  product: 'business',
  initialState: 'proposer',
  steps: [
    { id: 'proposer', title: 'Your details', routeKey: 'proposer', kind: 'form' },
    { id: 'business-details', title: 'Business details', routeKey: 'business-details', kind: 'form' },
    { id: 'review-submit', title: 'Review', routeKey: 'review-submit', kind: 'review' },
  ],
  states: {
    proposer: {
      stepId: 'proposer',
      on: {
        'NAV.NEXT': { target: 'businessDetails', commands: [{ type: 'engine.noop' }] },
      },
    },
    businessDetails: {
      stepId: 'business-details',
      on: {
        'NAV.BACK': { target: 'proposer', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'reviewSubmit', commands: [{ type: 'engine.noop' }] },
      },
    },
    reviewSubmit: {
      stepId: 'review-submit',
      on: {
        'NAV.BACK': { target: 'businessDetails', guards: ['canGoBack'] },
      },
    },
  },
});
