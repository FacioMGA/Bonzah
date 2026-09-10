import { defineFlow } from '@/src/shared/lib/wizard';

export const motorFlow = defineFlow({
  id: 'motor-public-wizard-v1',
  product: 'motor',
  initialState: 'policyHolder',
  steps: [
    { id: 'policy-holder', title: 'Policy Holder', routeKey: 'policy-holder', kind: 'form' },
    { id: 'vehicle-cover', title: 'Vehicle & Cover', routeKey: 'vehicle-cover', kind: 'form' },
    { id: 'driving-history', title: 'Driving History', routeKey: 'driving-history', kind: 'form' },
    { id: 'your-quote', title: 'Your Quote', routeKey: 'your-quote', kind: 'review' },
    { id: 'issue-details', title: 'Issue Details', routeKey: 'issue-details', kind: 'form' },
    { id: 'payment', title: 'Payment', routeKey: 'payment', kind: 'payment' },
    { id: 'success', title: 'Success', routeKey: 'success', kind: 'terminal' },
  ],
  states: {
    policyHolder: {
      stepId: 'policy-holder',
      on: {
        'NAV.NEXT': { target: 'vehicleCover' },
      },
    },
    vehicleCover: {
      stepId: 'vehicle-cover',
      on: {
        'NAV.BACK': { target: 'policyHolder', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'drivingHistory' },
      },
    },
    drivingHistory: {
      stepId: 'driving-history',
      on: {
        'NAV.BACK': { target: 'vehicleCover', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'quote' },
      },
    },
    quote: {
      stepId: 'your-quote',
      on: {
        'NAV.BACK': { target: 'drivingHistory', guards: ['canGoBack'] },
        'NAV.NEXT': [
          {
            target: 'payment',
            guards: ['hasQuote', 'hasRequiredFields'],
          },
          {
            target: 'issueDetails',
            guards: ['hasQuote'],
          },
        ],
      },
    },
    issueDetails: {
      stepId: 'issue-details',
      on: {
        'NAV.BACK': { target: 'quote', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'payment', guards: ['hasRequiredFields'] },
      },
    },
    payment: {
      stepId: 'payment',
      on: {
        'NAV.BACK': { target: 'quote', guards: ['canGoBack'] },
        'FLOW.SUBMIT': {
          target: 'success',
          guards: ['paymentConfirmed'],
        },
      },
    },
    success: {
      stepId: 'success',
      on: {
        'FLOW.CANCEL': { target: 'policyHolder' },
      },
    },
  },
});
