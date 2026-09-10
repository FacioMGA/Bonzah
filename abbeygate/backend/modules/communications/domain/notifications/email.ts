/**
 * Email notifications export surface.
 *
 * Canonical launch implementation lives in unifiedEmailNotifications.ts.
 */

export {
  sendInvoiceEmail,
  sendAutoQuoteInviteEmail,
  sendUwQuestionnaireRequestEmail,
  sendFollowUpBatchEmail,
  dispatchQuoteEmail,
  sendQuoteEmail,
  sendPaymentRequestEmail,
  sendEmailVerificationOtpEmail,
  sendPasswordResetOtpEmail,
  sendPasswordResetLinkEmail,
  sendInviteLinkEmail,
  sendPolicyWelcomeEmail,
  sendInternalSaleNotificationEmail,
  sendRequestedDocumentsEmail,
  sendTimelineMessageEmail,
  sendFnolIntakeLinkEmail,
  sendQuoteResumeLinkEmail,
} from './unifiedEmailNotifications.js';
