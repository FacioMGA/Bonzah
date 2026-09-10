import type { CommunicationChannel, ResolvedRecipient } from './types';

export function recipientsForChannel(
  recipients: ResolvedRecipient[],
  channel: CommunicationChannel,
): ResolvedRecipient[] {
  if (channel === 'NOTE') {
    return recipients.filter((recipient) => recipient.recipientClass === 'INTERNAL');
  }
  return recipients.filter((recipient) => {
    if (channel === 'EMAIL') return recipient.channel === 'EMAIL' && recipient.consent;
    if (channel === 'PHONE_CALL') return recipient.channel === 'SMS' && recipient.consent;
    if (channel === 'SMS') return recipient.channel === 'SMS' && recipient.consent;
    if (channel === 'WHATSAPP') return recipient.channel === 'WHATSAPP' && recipient.consent;
    return false;
  });
}
