import { sendRequestedDocumentsEmail } from '../../../communications/domain/notifications/email.js';
import type { DocumentEmailGatewayPort } from '../../app/read/emailPolicyDocumentsUseCase.js';

export function buildDocumentEmailGateway(): DocumentEmailGatewayPort {
  return {
    sendRequestedDocumentsEmail,
  };
}
