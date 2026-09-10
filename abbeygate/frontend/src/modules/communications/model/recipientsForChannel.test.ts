import { describe, expect, it } from 'vitest';
import { recipientsForChannel } from './recipientsForChannel';
import type { ResolvedRecipient } from './types';

const recipients: ResolvedRecipient[] = [
  {
    participantId: 'cust_1',
    contactName: 'Ada Customer',
    role: 'POLICYHOLDER',
    channel: 'EMAIL',
    address: 'ada@example.com',
    consent: true,
    recipientClass: 'EXTERNAL',
    groupLabel: 'Customer',
    isPrimary: true,
  },
  {
    participantId: 'user:staff_1',
    contactName: 'Sam Staff',
    role: 'UNDERWRITER',
    channel: 'EMAIL',
    address: 'sam@abbeygate.cy',
    consent: true,
    recipientClass: 'INTERNAL',
    groupLabel: 'Internal team',
  },
];

describe('recipientsForChannel (ABY-448)', () => {
  it('keeps customer emails on the EMAIL channel', () => {
    expect(recipientsForChannel(recipients, 'EMAIL').map((recipient) => recipient.address))
      .toEqual(['ada@example.com', 'sam@abbeygate.cy']);
  });

  it('keeps only staff for Internal Note', () => {
    expect(recipientsForChannel(recipients, 'NOTE')).toEqual([
      expect.objectContaining({
        address: 'sam@abbeygate.cy',
        recipientClass: 'INTERNAL',
      }),
    ]);
  });
});
