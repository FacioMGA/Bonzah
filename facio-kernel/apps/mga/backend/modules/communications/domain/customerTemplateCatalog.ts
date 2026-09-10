import type { CommunicationChannel } from './types.js';

export type CustomerTemplateKey =
  | 'QUOTE_STANDARD'
  | 'HOME_QUOTE_STANDARD'
  | 'TRAVEL_QUOTE_STANDARD'
  | 'HEALTH_QUOTE_STANDARD'
  | 'QUOTE_BANK_TRANSFER'
  | 'QUOTE_CHASER'
  | 'NEW_BUSINESS_CONFIRMATION'
  | 'HOME_NEW_BUSINESS_CONFIRMATION'
  | 'HOME_RENEWAL_CONFIRMATION'
  | 'TRAVEL_NEW_BUSINESS_CONFIRMATION'
  | 'TRAVEL_RENEWAL_CONFIRMATION'
  | 'HEALTH_NEW_BUSINESS_CONFIRMATION'
  | 'HEALTH_RENEWAL_CONFIRMATION'
  | 'RENEWAL_INVITE'
  | 'HOME_RENEWAL_INVITE'
  | 'TRAVEL_RENEWAL_INVITE'
  | 'HEALTH_RENEWAL_INVITE'
  | 'RENEWAL_CHASER'
  | 'HOME_RENEWAL_CHASER'
  | 'TRAVEL_RENEWAL_CHASER'
  | 'HEALTH_RENEWAL_CHASER'
  | 'HOME_HIGH_VALUE_CONTENTS_NOTICE'
  | 'PAYMENT_REQUEST'
  | 'UW_INFO_REQUEST'
  | 'UW_REFERRAL_NOTIFICATION'
  | 'QUOTE_RESUME_LINK'
  | 'DOCUMENT_RESEND'
  | 'CLAIMS_FNOL_LINK'
  | 'CLAIMS_INFO_REQUEST'
  | 'CLAIMS_INFO_REQUEST_REPLY'
  | 'CLAIMS_DOCUMENT_REQUEST'
  | 'CANCELLATION_CONFIRMED'
  // Internal staff sale notification — a dedicated back-office template, NOT a
  // duplicate of the customer welcome email. Identifies purchaser, product,
  // policy, payment reference, source and correlation id so the sales team can
  // action a genuine new-business placement (ADR-0067 follow-up).
  | 'INTERNAL_SALE_NOTIFICATION'
  // Operator MCP V2 endorsement secure-data-capture link
  // (ADR-0039 / ADR-0036 amendment #3).
  | 'ENDORSEMENT_DATA_CAPTURE'
  | 'AUTH_EMAIL_VERIFICATION_OTP'
  | 'AUTH_PASSWORD_RESET_OTP'
  | 'AUTH_PASSWORD_RESET_LINK'
  | 'AUTH_INVITE_LINK';

export interface CustomerTemplateDefinition {
  key: CustomerTemplateKey;
  name: string;
  channel: CommunicationChannel;
  subjectTemplate: string;
  bodyTemplate: string;
  variablesSchema: Record<string, unknown>;
  approvalRequired?: boolean;
  enabled?: boolean;
  tags?: string[];
  systemOnly?: boolean;
  /** Safe HTML-only anchors; plain-text bodies must still include the URL. */
  inlineLinks?: Array<{ labelVariable: string; urlVariable: string }>;
}

const EMAIL_CHANNEL: CommunicationChannel = 'EMAIL';

export const CUSTOMER_TEMPLATE_DEFINITIONS: CustomerTemplateDefinition[] = [
  {
    key: 'QUOTE_STANDARD',
    name: 'Quote Letter (Standard)',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your {{quote.productLabel}}',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nYour {{quote.productLabel}} is ready for {{policy.vehicleDescription}}.\n\nQuote reference: {{quote.reference}}\nPremium: {{quote.premium}}\nExcess: {{quote.excess}}\n\nPlease review it using the secure link below:\n{{quote.url}}\n\nImportant: cover does not start until payment is completed and confirmation has been issued.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.vehicleDescription': 'required',
      'quote.productLabel': 'required',
      'quote.reference': 'required',
      'quote.premium': 'required',
      'quote.excess': 'required',
      'quote.url': 'required',
    },
    tags: ['quote', 'customer'],
  },
  {
    key: 'HOME_QUOTE_STANDARD',
    name: 'Abbeygate Home Quote Letter',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Home quotation — {{quote.reference}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for giving Abbeygate the opportunity to quote for your home insurance. Your quotation is based on the information you have supplied.\n\nQuote reference: {{quote.reference}}\nProperty: {{policy.vehicleDescription}}\nAnnual premium: {{quote.premium}}\nPolicy excess: {{quote.excess}}\n\nYou can review and proceed with your quotation securely here:\n{{quote.url}}\n\nImportant: this quotation does not provide cover. Cover starts only after we confirm acceptance and payment has been completed.\n\nPlease check that your buildings sum insured represents the full rebuilding cost and that contents are sufficient for new-for-old replacement. If any single item is worth more than €3,000, or you need valuables cover, please contact us before proceeding.\n\nPlease read the attached policy information, including the policy summary and any significant exclusions or limitations, and tell us immediately if any information or your circumstances have changed.',
    variablesSchema: {
      'customer.firstName': 'required',
      'quote.reference': 'required',
      'quote.premium': 'required',
      'quote.excess': 'required',
      'quote.url': 'required',
      'policy.vehicleDescription': 'required',
    },
    tags: ['quote', 'customer', 'home', 'beazley'],
  },
  {
    key: 'TRAVEL_QUOTE_STANDARD',
    name: 'Abbeygate Travel Quotation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Travel quotation — {{quote.reference}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for giving Abbeygate the opportunity to quote for your travel insurance. Your quotation is based on the information you supplied.\n\nQuote reference: {{quote.reference}}\nCover: {{policy.vehicleDescription}}\nInsurance premium: {{quote.premium}}\nExcess / deductible: {{quote.excess}}\n\nYou can review and proceed with your quotation securely here:\n{{quote.url}}\n\nBefore deciding whether to proceed, please read the attached Insurance Product Information Document (IPID) and our Terms of Business. The IPID summarises the insurance; the certificate, schedule and policy wording contain the terms, conditions, definitions and exclusions that apply.\n\nPlease check the information carefully and tell us before proceeding if anything is incorrect or has changed. Cover does not start until we confirm acceptance and payment has been completed.',
    variablesSchema: {
      'customer.firstName': 'required',
      'quote.reference': 'required',
      'policy.vehicleDescription': 'required',
      'quote.premium': 'required',
      'quote.excess': 'required',
      'quote.url': 'required',
    },
    tags: ['quote', 'customer', 'travel', 'brit'],
  },
  {
    key: 'HEALTH_QUOTE_STANDARD',
    name: 'Abbeygate Immigration Medical Quotation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Immigration Medical quotation — {{quote.reference}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for giving Abbeygate the opportunity to quote for your Immigration Medical Insurance. Your quotation is based on the information you supplied.\n\nQuote reference: {{quote.reference}}\nCover: {{policy.vehicleDescription}}\nInsurance premium: {{quote.premium}}\nExcess / deductible: {{quote.excess}}\n\nYou can review and proceed with your quotation securely here:\n{{quote.url}}\n\nBefore deciding whether to proceed, please read the attached Insurance Product Information Document (IPID), policy wording and our Terms of Business. The IPID summarises the insurance; the policy wording contains the terms, conditions, definitions and exclusions that apply.\n\nPlease check the information carefully and tell us before proceeding if anything is incorrect or has changed. Cover does not start until we confirm acceptance and payment has been completed.',
    variablesSchema: {
      'customer.firstName': 'required',
      'quote.reference': 'required',
      'policy.vehicleDescription': 'required',
      'quote.premium': 'required',
      'quote.excess': 'required',
      'quote.url': 'required',
    },
    tags: ['quote', 'customer', 'health', 'immigration-medical', 'brit'],
  },
  {
    key: 'QUOTE_BANK_TRANSFER',
    name: 'Quote Letter (Bank Transfer)',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your motor insurance quote',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nYour quote is ready for {{policy.vehicleDescription}} ({{policy.registration}}).\n\nQuote reference: {{quote.reference}}\nPremium: {{quote.premium}}\n\nTo proceed, payment can be made via bank transfer using the details below:\n{{payment.bankTransferDetails}}\n\nAfter transfer, reply with confirmation so we can issue your documents.\n\nQuote link:\n{{quote.url}}\n\nImportant: cover does not start until payment is completed and confirmation has been issued.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.vehicleDescription': 'required',
      'policy.registration': 'required',
      'quote.reference': 'required',
      'quote.premium': 'required',
      'payment.bankTransferDetails': 'required',
      'quote.url': 'required',
    },
    tags: ['quote', 'customer', 'bank-transfer'],
  },
  {
    // Quote follow-up ("quote sent but not purchased"). Requires only the
    // variables that BOTH producers pass (`sendAutoQuoteInviteEmail` resend
    // and `operator.send_quote_reminder`): the previous mapping to
    // RENEWAL_CHASER required `policy.number` + `renewal.url`, which neither
    // producer fully supplied, so every follow-up dispatch was silently
    // skipped on missing required variables.
    key: 'QUOTE_CHASER',
    name: 'Quote Chaser (Follow-up)',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Reminder: your insurance quote is waiting',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nThis is a reminder that your insurance quote is still waiting for you.\n\nYou can review and complete it using the secure link below:\n{{quote.url}}\n\nImportant: cover does not start until payment is completed and confirmation has been issued.',
    variablesSchema: {
      'customer.firstName': 'required',
      'quote.url': 'required',
    },
    tags: ['quote', 'chaser', 'customer'],
  },
  {
    key: 'NEW_BUSINESS_CONFIRMATION',
    name: 'New Business Confirmation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Policy {{policy.number}} is issued',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nThank you for choosing us.\n\nYour policy {{policy.number}} has been placed and issued.\nBound / contracted date: {{policy.boundDate}}\nCoverage period: {{policy.startDate}} - {{policy.endDate}}\n{{policy.coverSubjectLabel}}: {{policy.vehicleDescription}}\n\nYour documents are attached and also available in your dashboard:\n{{policy.dashboardUrl}}\n\nIf you have questions, contact us at {{support.phone}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.boundDate': 'required',
      'policy.startDate': 'required',
      'policy.endDate': 'required',
      'policy.coverSubjectLabel': 'required',
      'policy.vehicleDescription': 'required',
      'policy.dashboardUrl': 'required',
      'support.phone': 'required',
    },
    tags: ['new-business', 'welcome', 'customer'],
  },
  {
    key: 'HOME_NEW_BUSINESS_CONFIRMATION',
    name: 'Abbeygate Home New Policy Letter',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Home policy {{policy.number}} is issued',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for arranging your home insurance with Abbeygate. We are pleased to confirm that your policy has been placed.\n\nPolicy number: {{policy.number}}\nCover period: {{policy.startDate}} to {{policy.endDate}}\nProperty: {{policy.vehicleDescription}}\n\nYour policy documents are attached and are also available in your dashboard:\n{{policy.dashboardUrl}}\n\nPlease review the schedule, statement of fact, policy wording and IPID carefully. In particular, confirm that the buildings sum insured represents the full rebuilding cost and that contents are sufficient for new-for-old replacement. Underinsurance may reduce a claim settlement under the average clause.\n\nPlease tell us immediately if any detail is incorrect or if your circumstances change. If you have questions, contact us at {{support.phone}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.startDate': 'required',
      'policy.endDate': 'required',
      'policy.vehicleDescription': 'required',
      'policy.dashboardUrl': 'required',
      'support.phone': 'required',
    },
    tags: ['new-business', 'welcome', 'customer', 'home', 'beazley'],
  },
  {
    key: 'HOME_RENEWAL_CONFIRMATION',
    name: 'Abbeygate Home Renewal Confirmation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Home renewal {{policy.number}} is confirmed',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for renewing your home insurance with Abbeygate. Your renewed policy has been placed.\n\nPolicy number: {{policy.number}}\nCover period: {{policy.startDate}} to {{policy.endDate}}\nProperty: {{policy.vehicleDescription}}\n\nYour renewal documents are attached and are also available in your dashboard:\n{{policy.dashboardUrl}}\n\nPlease review the schedule and policy wording immediately. Check that the sums insured remain enough to rebuild the property and replace contents on a new-for-old basis; underinsurance may reduce a claim settlement under the average clause.\n\nPlease tell us immediately if anything is incorrect or your circumstances have changed. If you have questions, contact us at {{support.phone}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.startDate': 'required',
      'policy.endDate': 'required',
      'policy.vehicleDescription': 'required',
      'policy.dashboardUrl': 'required',
      'support.phone': 'required',
    },
    tags: ['renewal', 'confirmation', 'customer', 'home', 'beazley'],
  },
  {
    key: 'TRAVEL_NEW_BUSINESS_CONFIRMATION',
    name: 'Abbeygate Travel New Policy Letter',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Travel policy {{policy.number}} is issued',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for arranging your travel insurance with Abbeygate. We are pleased to confirm that your policy has been placed.\n\nPolicy number: {{policy.number}}\nCover period: {{policy.startDate}} to {{policy.endDate}}\nCover: {{policy.vehicleDescription}}\n\nYour policy documents are attached and are also available in your dashboard:\n{{policy.dashboardUrl}}\n\nPlease read the certificate, schedule, IPID, policy wording and statement of fact carefully. The IPID summarises cover; the policy wording contains the terms, conditions, definitions, exclusions, cancellation information, claims procedures and complaints information.\n\nPlease tell us immediately if any detail is incorrect or has changed. If you have questions, contact us at {{support.phone}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.startDate': 'required',
      'policy.endDate': 'required',
      'policy.vehicleDescription': 'required',
      'policy.dashboardUrl': 'required',
      'support.phone': 'required',
    },
    tags: ['new-business', 'welcome', 'customer', 'travel', 'brit'],
  },
  {
    key: 'TRAVEL_RENEWAL_CONFIRMATION',
    name: 'Abbeygate Travel Renewal Confirmation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Travel renewal {{policy.number}} is confirmed',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for renewing your travel insurance with Abbeygate. Your renewed policy has been placed.\n\nPolicy number: {{policy.number}}\nCover period: {{policy.startDate}} to {{policy.endDate}}\nCover: {{policy.vehicleDescription}}\n\nYour renewal documents are attached and are also available in your dashboard:\n{{policy.dashboardUrl}}\n\nPlease read the certificate, schedule, IPID, policy wording and statement of fact carefully. Please tell us immediately if any information is incorrect or has changed. If you have questions, contact us at {{support.phone}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.startDate': 'required',
      'policy.endDate': 'required',
      'policy.vehicleDescription': 'required',
      'policy.dashboardUrl': 'required',
      'support.phone': 'required',
    },
    tags: ['renewal', 'confirmation', 'customer', 'travel', 'brit'],
  },
  {
    key: 'HEALTH_NEW_BUSINESS_CONFIRMATION',
    name: 'Abbeygate Immigration Medical New Policy Letter',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Immigration Medical policy {{policy.number}} is issued',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for arranging your Immigration Medical Insurance with Abbeygate. We are pleased to confirm that your policy has been placed.\n\nPolicy number: {{policy.number}}\nCover period: {{policy.startDate}} to {{policy.endDate}}\nCover: {{policy.vehicleDescription}}\n\nYour policy documents are attached and are also available in your dashboard:\n{{policy.dashboardUrl}}\n\nPlease read the certificate, IPID, policy wording, statement of fact and Terms of Business carefully. The IPID summarises cover; the policy wording contains the terms, conditions, definitions, exclusions, cancellation information, claims procedures and complaints information.\n\nPlease tell us immediately if any detail is incorrect or has changed. If you have questions, contact us at {{support.phone}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.startDate': 'required',
      'policy.endDate': 'required',
      'policy.vehicleDescription': 'required',
      'policy.dashboardUrl': 'required',
      'support.phone': 'required',
    },
    tags: ['new-business', 'welcome', 'customer', 'health', 'immigration-medical', 'brit'],
  },
  {
    key: 'HEALTH_RENEWAL_CONFIRMATION',
    name: 'Abbeygate Immigration Medical Renewal Confirmation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your Abbeygate Immigration Medical renewal {{policy.number}} is confirmed',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for renewing your Immigration Medical Insurance with Abbeygate. Your renewed policy has been placed.\n\nPolicy number: {{policy.number}}\nCover period: {{policy.startDate}} to {{policy.endDate}}\nCover: {{policy.vehicleDescription}}\n\nYour renewal documents are attached and are also available in your dashboard:\n{{policy.dashboardUrl}}\n\nPlease read the certificate, IPID, policy wording, statement of fact and Terms of Business carefully. Please tell us immediately if any information is incorrect or has changed. If you have questions, contact us at {{support.phone}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.startDate': 'required',
      'policy.endDate': 'required',
      'policy.vehicleDescription': 'required',
      'policy.dashboardUrl': 'required',
      'support.phone': 'required',
    },
    tags: ['renewal', 'confirmation', 'customer', 'health', 'immigration-medical', 'brit'],
  },
  {
    key: 'RENEWAL_INVITE',
    name: 'Renewal Invite',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Renewal invite for policy {{policy.number}}',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nYour policy {{policy.number}} is coming up for renewal on {{policy.renewalDate}}.\n\nPlease review and confirm your renewal details here:\n{{renewal.url}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.renewalDate': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'customer'],
  },
  {
    key: 'HOME_RENEWAL_INVITE',
    name: 'Abbeygate Home Renewal Invite',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Renewal invitation for your Abbeygate Home policy {{policy.number}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nYour Abbeygate Home policy {{policy.number}} is due for renewal on {{policy.renewalDate}}.\n\nPlease review and confirm your renewal details securely here:\n{{renewal.url}}\n\nBefore renewing, please check that the property details and sums insured remain accurate. Buildings cover should reflect the full rebuilding cost and contents should reflect new-for-old replacement. Please declare any item worth more than €3,000 and let us know about any material change to the property, occupancy or claims history.\n\nCover cannot continue beyond the renewal date until your renewal has been confirmed and payment completed.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.renewalDate': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'customer', 'home', 'beazley'],
  },
  {
    key: 'TRAVEL_RENEWAL_INVITE',
    name: 'Abbeygate Travel Renewal Invitation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Renewal invitation for your Abbeygate Travel policy {{policy.number}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nYour Abbeygate Travel policy {{policy.number}} is due for renewal on {{policy.renewalDate}}.\n\nPlease review and confirm your renewal details securely here:\n{{renewal.url}}\n\nBefore renewing, please read the attached IPID, policy wording and Terms of Business, and check that the information we hold remains correct. Please tell us about any change that could affect your cover before renewal.\n\nTo avoid a break in cover, please complete the renewal and payment before the due date.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.renewalDate': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'customer', 'travel', 'brit'],
  },
  {
    key: 'HEALTH_RENEWAL_INVITE',
    name: 'Abbeygate Immigration Medical Renewal Invitation',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Renewal invitation for your Abbeygate Immigration Medical policy {{policy.number}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nYour Abbeygate Immigration Medical policy {{policy.number}} is due for renewal on {{policy.renewalDate}}.\n\nPlease review and confirm your renewal details securely here:\n{{renewal.url}}\n\nBefore renewing, please read the attached IPID, policy wording and Terms of Business, and check that the information we hold remains correct. Please tell us about any change that could affect your cover before renewal.\n\nTo avoid a break in cover, please complete the renewal and payment before the due date.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.renewalDate': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'customer', 'health', 'immigration-medical', 'brit'],
  },
  {
    key: 'RENEWAL_CHASER',
    name: 'Renewal Chaser',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Reminder: renewal pending for policy {{policy.number}}',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nThis is a reminder that your renewal for policy {{policy.number}} is still pending.\n\nPlease action it here:\n{{renewal.url}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'chaser', 'customer'],
  },
  {
    key: 'HOME_RENEWAL_CHASER',
    name: 'Abbeygate Home Renewal Chaser',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Reminder: your Abbeygate Home renewal is pending — {{policy.number}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThis is a reminder that renewal of your Abbeygate Home policy {{policy.number}} is still pending and is due on {{policy.renewalDate}}.\n\nPlease review and action your renewal securely here:\n{{renewal.url}}\n\nIf you need to change your cover, sums insured, occupancy details or declared valuables, please contact us before renewal. Buildings and contents sums insured must remain sufficient for rebuilding and new-for-old replacement.\n\nTo avoid a break in cover, please complete the renewal and payment before the due date.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.renewalDate': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'chaser', 'customer', 'home', 'beazley'],
  },
  {
    key: 'TRAVEL_RENEWAL_CHASER',
    name: 'Abbeygate Travel Renewal Chaser',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Reminder: your Abbeygate Travel renewal is pending — {{policy.number}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThis is a reminder that renewal of your Abbeygate Travel policy {{policy.number}} is still pending and is due on {{policy.renewalDate}}.\n\nPlease review and action your renewal securely here:\n{{renewal.url}}\n\nIf any information has changed, please contact us before renewal. To avoid a break in cover, please complete the renewal and payment before the due date.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.renewalDate': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'chaser', 'customer', 'travel', 'brit'],
  },
  {
    key: 'HEALTH_RENEWAL_CHASER',
    name: 'Abbeygate Immigration Medical Renewal Chaser',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Reminder: your Abbeygate Immigration Medical renewal is pending — {{policy.number}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThis is a reminder that renewal of your Abbeygate Immigration Medical policy {{policy.number}} is still pending and is due on {{policy.renewalDate}}.\n\nPlease review and action your renewal securely here:\n{{renewal.url}}\n\nIf any information has changed, please contact us before renewal. To avoid a break in cover, please complete the renewal and payment before the due date.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.renewalDate': 'required',
      'renewal.url': 'required',
    },
    tags: ['renewal', 'chaser', 'customer', 'health', 'immigration-medical', 'brit'],
  },
  {
    key: 'HOME_HIGH_VALUE_CONTENTS_NOTICE',
    name: 'Abbeygate Home Contents Limits Notice',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Important contents limits for Home policy {{policy.number}}',
    bodyTemplate:
      'Dear {{customer.firstName}},\n\nThank you for entrusting Abbeygate with your home insurance. Your contents sum insured is {{home.contentsSumInsured}}.\n\nPlease review the policy limits carefully. Any individual item worth more than €3,000 must be specified. The valuables limit is 20% of the contents sum insured, and valuables cover is not available for a holiday home.\n\nPlease send us a list of any items that need to be specified, together with receipts or valuations for items above €3,000. Contact us before cover starts if you are unsure whether an item should be declared.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'home.contentsSumInsured': 'required',
    },
    tags: ['contents', 'customer', 'home', 'beazley'],
  },
  {
    key: 'PAYMENT_REQUEST',
    name: 'Payment Request',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Payment request for policy {{policy.number}}',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nPlease complete payment for policy {{policy.number}}.\nAmount due: EUR {{payment.amount}}\nPayment link: {{payment.url}}\nExpires: {{payment.expiresAt}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'payment.amount': 'required',
      'payment.url': 'required',
      'payment.expiresAt': 'required',
    },
    tags: ['payment', 'customer'],
  },
  {
    key: 'UW_INFO_REQUEST',
    name: 'Underwriting Information Request',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Action required: additional information needed',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nTo continue with your policy review we need additional information.\n\n{{uw.message}}\n\nPlease provide details securely using:\n{{uw.url}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'uw.message': 'optional',
      'uw.url': 'required',
    },
    tags: ['underwriting', 'questionnaire', 'customer'],
  },
  {
    // Internal notification to the jurisdiction's underwriting team when a
    // quote lands in REFERRAL. Deliberately separate from UW_INFO_REQUEST:
    // that template is customer-facing and requires a `uw.url` secure-capture
    // link that referral producers cannot supply, so routing referrals through
    // it made every dispatch silently skip on missing required variables.
    key: 'UW_REFERRAL_NOTIFICATION',
    name: 'UW Referral Notification (Internal)',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'UW referral: {{policy.number}} requires underwriter review',
    bodyTemplate:
      'A quote has been referred for underwriting review.\n\nReference: {{policy.number}}\nOpen in the back office: {{uw.adminUrl}}\n\n{{uw.message}}\n\nPlease review the referral in the back office and contact the client.',
    variablesSchema: {
      'policy.number': 'required',
      'uw.adminUrl': 'required',
      'uw.message': 'required',
    },
    inlineLinks: [{ labelVariable: 'policy.number', urlVariable: 'uw.adminUrl' }],
    systemOnly: true,
    tags: ['underwriting', 'referral', 'internal'],
  },
  {
    // Internal sales desk "new business placed" notification. Deliberately a
    // structured operational summary (who bought what, for how much, from
    // where) — never the customer-facing welcome copy. Sent only to the
    // configured internal copy mailbox; system-only so it can never be picked
    // for a customer-facing dispatch.
    key: 'INTERNAL_SALE_NOTIFICATION',
    name: 'Internal Sale Notification (Staff)',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'New sale: {{sale.productLabel}} — {{policy.number}} ({{sale.purchaserName}})',
    bodyTemplate:
      // Source-neutral: this notification fires for online checkout AND for
      // back-office / API / system issuances. The channel is stated on the
      // "Source" line below rather than falsely asserting an online placement.
      'A new policy has been issued.\n\n'
      + 'Purchaser: {{sale.purchaserName}}\n'
      + 'Email: {{sale.purchaserEmail}}\n'
      + 'Product: {{sale.productLabel}}\n'
      + 'Policy number: {{policy.number}}\n'
      + 'Cover: {{sale.coverSummary}}\n'
      + 'Payment reference: {{sale.paymentReference}}\n'
      + 'Source: {{sale.source}}\n'
      + 'Correlation ID: {{sale.correlationId}}\n\n'
      + 'Open in the back office: {{sale.adminUrl}}',
    variablesSchema: {
      'sale.purchaserName': 'required',
      'sale.purchaserEmail': 'required',
      'sale.productLabel': 'required',
      'policy.number': 'required',
      'sale.coverSummary': 'optional',
      'sale.paymentReference': 'optional',
      'sale.source': 'optional',
      'sale.correlationId': 'optional',
      'sale.adminUrl': 'optional',
    },
    systemOnly: true,
    inlineLinks: [{ labelVariable: 'policy.number', urlVariable: 'sale.adminUrl' }],
    tags: ['sales', 'new-business', 'internal', 'system-only'],
  },
  {
    // ABY-259 — quiet "email me a link to resume my quote" template used by
    // the customer wizard footer. Deliberately minimal so it doesn't read as
    // marketing or as a "your quote is ready" notification: the customer
    // hasn't finished the wizard yet, all we promise is "your answers are
    // saved, here's the link back in".
    key: 'QUOTE_RESUME_LINK',
    name: 'Quote Resume Link',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Pick up where you left off',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nYour answers have been saved. You can pick up where you left off using the link below:\n\n{{quote.resumeUrl}}\n\nIf you didn\'t request this email you can safely ignore it — no further action is needed.',
    variablesSchema: {
      'customer.firstName': 'required',
      'quote.resumeUrl': 'required',
    },
    tags: ['quote', 'resume', 'customer'],
  },
  {
    key: 'DOCUMENT_RESEND',
    name: 'Requested Documents',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Requested documents for policy {{policy.number}}',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nAs requested, your documents are attached for policy {{policy.number}}.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
    },
    tags: ['documents', 'customer'],
  },
  {
    key: 'CLAIMS_FNOL_LINK',
    name: 'Claims FNOL Intake Link',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Complete your FNOL form',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nPlease complete your FNOL form using this secure link:\n{{claim.fnolUrl}}\n\nClaim reference: {{claim.reference}}\nPolicy number: {{policy.number}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'claim.fnolUrl': 'required',
      'claim.reference': 'optional',
      'policy.number': 'optional',
    },
    tags: ['claims', 'fnol', 'customer'],
  },
  {
    key: 'CLAIMS_INFO_REQUEST',
    name: 'Claims Information Request',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Additional claim information required',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nTo progress your claim we need the following information:\n{{claim.message}}\n\nPlease respond using:\n{{claim.url}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'claim.message': 'required',
      'claim.url': 'required',
    },
    tags: ['claims', 'info-request', 'customer'],
  },
  {
    key: 'CLAIMS_INFO_REQUEST_REPLY',
    name: 'Claims Information Request (Reply By Email)',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Additional claim information required',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nTo progress your claim we need the following information:\n{{claim.message}}\n\nPlease reply directly to this email with the requested information.\n{{claim.referenceLine}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'claim.message': 'required',
      'claim.referenceLine': 'optional',
    },
    tags: ['claims', 'info-request', 'customer'],
  },
  {
    key: 'CLAIMS_DOCUMENT_REQUEST',
    name: 'Claims Document Request',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Documents required for your claim',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nPlease provide the requested claim documents listed below:\n{{claim.requestedDocuments}}\n\nUpload link:\n{{claim.url}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'claim.requestedDocuments': 'required',
      'claim.url': 'required',
    },
    tags: ['claims', 'documents', 'customer'],
  },
  {
    key: 'CANCELLATION_CONFIRMED',
    name: 'Cancellation Confirmed',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Cancellation confirmed - {{policy.number}}',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nYour cancellation has been confirmed for policy {{policy.number}}.\nEffective date: {{policy.effectiveDate}}\nRefund amount: {{policy.refundAmount}}',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'policy.effectiveDate': 'optional',
      'policy.refundAmount': 'optional',
    },
    tags: ['cancellation', 'customer'],
  },
  {
    // Operator MCP V2 endorsement secure data capture link (ADR-0039 B3).
    // Sent by `operator.send_endorsement_data_capture_link` after the
    // agent creates a DRAFT endorsement; the customer follows the link
    // to enter the changed details (new address / new named driver)
    // and the data flows back into the endorsement workspace for UW
    // review.
    key: 'ENDORSEMENT_DATA_CAPTURE',
    name: 'Endorsement Data Capture (Customer)',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Update your policy details - {{policy.number}}',
    bodyTemplate:
      'Hi {{customer.firstName}},\n\nWe have started an update to your policy {{policy.number}} ({{endorsement.changeType}}).\n\nPlease complete the secure form below so we can finalise the change:\n{{endorsement.captureUrl}}\n\nThis link is unique to you and will expire shortly.\n\nIf you did not request this update, please contact us immediately.',
    variablesSchema: {
      'customer.firstName': 'required',
      'policy.number': 'required',
      'endorsement.captureUrl': 'required',
      'endorsement.changeType': 'required',
    },
    tags: ['endorsement', 'customer', 'data-capture'],
  },
  {
    key: 'AUTH_EMAIL_VERIFICATION_OTP',
    name: 'Auth Email Verification OTP',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Your verification code',
    bodyTemplate:
      'Your email verification code is {{auth.code}}.\n\nThis code expires in {{auth.expiresMinutes}} minutes.\n\nIf you did not request this code, please ignore this email.',
    variablesSchema: {
      'auth.code': 'required',
      'auth.expiresMinutes': 'required',
    },
    tags: ['auth', 'otp', 'system-only'],
    systemOnly: true,
  },
  {
    key: 'AUTH_PASSWORD_RESET_OTP',
    name: 'Auth Password Reset OTP',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Reset your password',
    bodyTemplate:
      'Your password reset code is {{auth.code}}.\n\nThis code expires in {{auth.expiresMinutes}} minutes.\n\nIf you did not request this reset, please ignore this email.',
    variablesSchema: {
      'auth.code': 'required',
      'auth.expiresMinutes': 'required',
    },
    tags: ['auth', 'otp', 'system-only'],
    systemOnly: true,
  },
  {
    key: 'AUTH_PASSWORD_RESET_LINK',
    name: 'Auth Password Reset Link',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'Reset your password',
    bodyTemplate:
      'A password reset was requested for your account.\n\nClick the secure link below to choose a new password. The link expires in {{auth.expiresHours}} hours and can be used once.\n\n{{auth.url}}\n\nIf you did not request this reset, you can safely ignore this email — your password will not change.',
    variablesSchema: {
      'auth.url': 'required',
      'auth.expiresHours': 'required',
    },
    tags: ['auth', 'magic-link', 'system-only'],
    systemOnly: true,
  },
  {
    key: 'AUTH_INVITE_LINK',
    name: 'Auth Invite Link',
    channel: EMAIL_CHANNEL,
    subjectTemplate: 'You\'ve been invited to {{auth.platformName}}',
    bodyTemplate:
      'Hi {{auth.firstName}},\n\nYou\'ve been invited to join {{auth.platformName}}{{auth.invitedBySuffix}}.\n\nClick the secure link below to set your password and activate your account. The link expires in {{auth.expiresHours}} hours and can be used once.\n\n{{auth.url}}\n\nIf you weren\'t expecting this invitation, you can safely ignore this email.',
    variablesSchema: {
      'auth.url': 'required',
      'auth.firstName': 'required',
      'auth.platformName': 'required',
      'auth.expiresHours': 'required',
      'auth.invitedBySuffix': 'optional',
    },
    tags: ['auth', 'invite', 'magic-link', 'system-only'],
    systemOnly: true,
  },
];

export function getCustomerTemplateDefinitionByKey(
  key: CustomerTemplateKey
): CustomerTemplateDefinition | null {
  return CUSTOMER_TEMPLATE_DEFINITIONS.find((tpl) => tpl.key === key) || null;
}
