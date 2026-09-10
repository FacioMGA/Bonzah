import { defineFlow } from '@/src/shared/lib/wizard';

export const homeFlow = defineFlow({
  id: 'home-public-wizard-v1',
  product: 'home',
  initialState: 'policyHolder',
  steps: [
    { id: 'policy-holder', title: 'Your details', routeKey: 'policy-holder', kind: 'form' },
    { id: 'property', title: 'Property', routeKey: 'property', kind: 'form' },
    { id: 'construction-risk', title: 'Construction & risk', routeKey: 'construction-risk', kind: 'form' },
    { id: 'sums-insured', title: 'Sums insured', routeKey: 'sums-insured', kind: 'form' },
    { id: 'security', title: 'Security', routeKey: 'security', kind: 'form' },
    { id: 'your-quote', title: 'Your quote', routeKey: 'your-quote', kind: 'review' },
    { id: 'acceptance', title: 'Acceptance', routeKey: 'acceptance', kind: 'form' },
    { id: 'payment', title: 'Payment', routeKey: 'payment', kind: 'payment' },
    { id: 'success', title: 'Success', routeKey: 'success', kind: 'terminal' },
  ],
  states: {
    policyHolder: {
      stepId: 'policy-holder',
      on: {
        'NAV.NEXT': { target: 'property', commands: [{ type: 'home.session.saveDraft' }] },
      },
    },
    property: {
      stepId: 'property',
      on: {
        'NAV.BACK': { target: 'policyHolder', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'constructionRisk', commands: [{ type: 'home.session.saveDraft' }] },
      },
    },
    constructionRisk: {
      stepId: 'construction-risk',
      on: {
        'NAV.BACK': { target: 'property', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'sumsInsured', commands: [{ type: 'home.session.saveDraft' }] },
      },
    },
    sumsInsured: {
      stepId: 'sums-insured',
      on: {
        'NAV.BACK': { target: 'constructionRisk', guards: ['canGoBack'] },
        // Rating is performed by the controller (it needs the resulting
        // quoteResponse to set local UI state); the engine only records the
        // intent so the trace stays honest.
        'NAV.NEXT': { target: 'security', commands: [{ type: 'engine.noop' }] },
      },
    },
    security: {
      stepId: 'security',
      on: {
        'NAV.BACK': { target: 'sumsInsured', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'quote', commands: [{ type: 'engine.noop' }] },
      },
    },
    quote: {
      stepId: 'your-quote',
      on: {
        'NAV.BACK': { target: 'security', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'acceptance', guards: ['hasQuote'] },
      },
    },
    acceptance: {
      stepId: 'acceptance',
      on: {
        'NAV.BACK': { target: 'quote', guards: ['canGoBack'] },
        'NAV.NEXT': { target: 'payment', guards: ['hasRequiredFields'] },
      },
    },
    payment: {
      stepId: 'payment',
      on: {
        'NAV.BACK': { target: 'acceptance', guards: ['canGoBack'] },
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
