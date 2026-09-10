import type { CustomerTemplateKey } from '../domain/customerTemplateCatalog.js';

export type CustomerEmailTriggerKey =
  | 'QUOTE_SENT'
  | 'HOME_HIGH_VALUE_CONTENTS_NOTICE'
  | 'QUOTE_FOLLOW_UP'
  | 'UW_INFO_REQUESTED'
  | 'UW_REFERRAL_RAISED'
  | 'QUOTE_RESUME_LINK_REQUESTED'
  | 'PAYMENT_REQUESTED'
  | 'NEW_BUSINESS_PLACED'
  | 'RENEWAL_INVITE'
  | 'RENEWAL_CHASER'
  | 'CANCELLATION_CONFIRMED'
  | 'INTERNAL_SALE_NOTIFICATION'
  | 'DOCUMENTS_RESEND'
  | 'CLAIMS_FNOL_LINK'
  | 'CLAIMS_INFO_REQUEST'
  | 'CLAIMS_INFO_REQUEST_UNLINKED'
  | 'CLAIMS_DOCUMENT_REQUEST'
  | 'ENDORSEMENT_DATA_CAPTURE_REQUESTED'
  | 'AUTH_EMAIL_VERIFICATION_OTP'
  | 'AUTH_PASSWORD_RESET_OTP'
  | 'AUTH_PASSWORD_RESET_LINK'
  | 'AUTH_INVITE_LINK';

export interface CustomerEmailTriggerMapping {
  trigger: CustomerEmailTriggerKey;
  templateKey: CustomerTemplateKey;
  systemOnly?: boolean;
  /** Product-conditioned variants remain entries in the canonical trigger registry. */
  productCode?: string;
  /** Distinguishes a renewal-issued policy confirmation from new business. */
  isRenewal?: boolean;
}

export const CUSTOMER_EMAIL_TRIGGER_REGISTRY: CustomerEmailTriggerMapping[] = [
  { trigger: 'QUOTE_SENT', templateKey: 'QUOTE_STANDARD' },
  { trigger: 'QUOTE_SENT', templateKey: 'HOME_QUOTE_STANDARD', productCode: 'HOME' },
  { trigger: 'QUOTE_SENT', templateKey: 'TRAVEL_QUOTE_STANDARD', productCode: 'TRAVEL' },
  { trigger: 'QUOTE_SENT', templateKey: 'HEALTH_QUOTE_STANDARD', productCode: 'HEALTH' },
  { trigger: 'HOME_HIGH_VALUE_CONTENTS_NOTICE', templateKey: 'HOME_HIGH_VALUE_CONTENTS_NOTICE' },
  { trigger: 'QUOTE_FOLLOW_UP', templateKey: 'QUOTE_CHASER' },
  { trigger: 'UW_INFO_REQUESTED', templateKey: 'UW_INFO_REQUEST' },
  { trigger: 'UW_REFERRAL_RAISED', templateKey: 'UW_REFERRAL_NOTIFICATION', systemOnly: true },
  { trigger: 'QUOTE_RESUME_LINK_REQUESTED', templateKey: 'QUOTE_RESUME_LINK' },
  { trigger: 'PAYMENT_REQUESTED', templateKey: 'PAYMENT_REQUEST' },
  { trigger: 'NEW_BUSINESS_PLACED', templateKey: 'NEW_BUSINESS_CONFIRMATION' },
  { trigger: 'NEW_BUSINESS_PLACED', templateKey: 'HOME_RENEWAL_CONFIRMATION', productCode: 'HOME', isRenewal: true },
  { trigger: 'NEW_BUSINESS_PLACED', templateKey: 'HOME_NEW_BUSINESS_CONFIRMATION', productCode: 'HOME' },
  { trigger: 'NEW_BUSINESS_PLACED', templateKey: 'TRAVEL_RENEWAL_CONFIRMATION', productCode: 'TRAVEL', isRenewal: true },
  { trigger: 'NEW_BUSINESS_PLACED', templateKey: 'TRAVEL_NEW_BUSINESS_CONFIRMATION', productCode: 'TRAVEL' },
  { trigger: 'NEW_BUSINESS_PLACED', templateKey: 'HEALTH_RENEWAL_CONFIRMATION', productCode: 'HEALTH', isRenewal: true },
  { trigger: 'NEW_BUSINESS_PLACED', templateKey: 'HEALTH_NEW_BUSINESS_CONFIRMATION', productCode: 'HEALTH' },
  { trigger: 'RENEWAL_INVITE', templateKey: 'RENEWAL_INVITE' },
  { trigger: 'RENEWAL_INVITE', templateKey: 'HOME_RENEWAL_INVITE', productCode: 'HOME' },
  { trigger: 'RENEWAL_INVITE', templateKey: 'TRAVEL_RENEWAL_INVITE', productCode: 'TRAVEL' },
  { trigger: 'RENEWAL_INVITE', templateKey: 'HEALTH_RENEWAL_INVITE', productCode: 'HEALTH' },
  { trigger: 'RENEWAL_CHASER', templateKey: 'RENEWAL_CHASER' },
  { trigger: 'RENEWAL_CHASER', templateKey: 'HOME_RENEWAL_CHASER', productCode: 'HOME' },
  { trigger: 'RENEWAL_CHASER', templateKey: 'TRAVEL_RENEWAL_CHASER', productCode: 'TRAVEL' },
  { trigger: 'RENEWAL_CHASER', templateKey: 'HEALTH_RENEWAL_CHASER', productCode: 'HEALTH' },
  { trigger: 'CANCELLATION_CONFIRMED', templateKey: 'CANCELLATION_CONFIRMED' },
  { trigger: 'INTERNAL_SALE_NOTIFICATION', templateKey: 'INTERNAL_SALE_NOTIFICATION', systemOnly: true },
  { trigger: 'DOCUMENTS_RESEND', templateKey: 'DOCUMENT_RESEND' },
  { trigger: 'CLAIMS_FNOL_LINK', templateKey: 'CLAIMS_FNOL_LINK' },
  { trigger: 'CLAIMS_INFO_REQUEST', templateKey: 'CLAIMS_INFO_REQUEST' },
  { trigger: 'CLAIMS_INFO_REQUEST_UNLINKED', templateKey: 'CLAIMS_INFO_REQUEST_REPLY' },
  { trigger: 'CLAIMS_DOCUMENT_REQUEST', templateKey: 'CLAIMS_DOCUMENT_REQUEST' },
  { trigger: 'ENDORSEMENT_DATA_CAPTURE_REQUESTED', templateKey: 'ENDORSEMENT_DATA_CAPTURE' },
  { trigger: 'AUTH_EMAIL_VERIFICATION_OTP', templateKey: 'AUTH_EMAIL_VERIFICATION_OTP', systemOnly: true },
  { trigger: 'AUTH_PASSWORD_RESET_OTP', templateKey: 'AUTH_PASSWORD_RESET_OTP', systemOnly: true },
  { trigger: 'AUTH_PASSWORD_RESET_LINK', templateKey: 'AUTH_PASSWORD_RESET_LINK', systemOnly: true },
  { trigger: 'AUTH_INVITE_LINK', templateKey: 'AUTH_INVITE_LINK', systemOnly: true },
];

export function resolveTemplateForTrigger(
  trigger: CustomerEmailTriggerKey,
  options?: { productCode?: string; isRenewal?: boolean },
): CustomerTemplateKey | null {
  const productCode = String(options?.productCode || '').trim().toUpperCase();
  const productVariants = CUSTOMER_EMAIL_TRIGGER_REGISTRY.filter(
    (entry) => entry.trigger === trigger && entry.productCode === productCode,
  );
  const exactVariant = productVariants.find((entry) => entry.isRenewal === options?.isRenewal);
  const defaultVariant = productVariants.find((entry) => entry.isRenewal === undefined);
  return exactVariant?.templateKey
    || defaultVariant?.templateKey
    || CUSTOMER_EMAIL_TRIGGER_REGISTRY.find((entry) => entry.trigger === trigger && !entry.productCode)?.templateKey
    || null;
}
