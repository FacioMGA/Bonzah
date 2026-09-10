import type { GuardRegistry } from './types';

export const baseGuardRegistry: GuardRegistry = {
  always: () => true,
  hasQuote: ({ context }) => Boolean(context.quoteReady),
  hasRequiredFields: ({ context }) => !(context.issueReadinessBlocked === true),
  paymentConfirmed: ({ context }) => Boolean(context.paymentConfirmed),
  canGoBack: ({ context }) => context.disableBackNavigation !== true,
};
