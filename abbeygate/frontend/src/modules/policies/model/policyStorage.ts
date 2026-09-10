const APP_NAMESPACE = 'facio:policies';

export const policyQuestionnaireLastSentKey = (policyId: string): string =>
  `${APP_NAMESPACE}:questionnaire:last-sent:${policyId}`;

export const policyQuestionnaireOpenedKey = (policyId: string): string =>
  `${APP_NAMESPACE}:questionnaire:opened:${policyId}`;

export const policyFirstPolicyholderSaveKey = (policyId: string): string =>
  `${APP_NAMESPACE}:policyholder:first-save:${policyId}`;

export const policyAutoCoverageAccordionKey = (policyId: string): string =>
  `${APP_NAMESPACE}:auto:coverage-accordion:${policyId}`;

export const policyFollowUpsSentKey = (policyId: string): string =>
  `${APP_NAMESPACE}:followups:sent:${policyId}`;
