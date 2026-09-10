/* @vitest-environment happy-dom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TimelineEventCard } from './TimelineEventCard';
import type { CommunicationTimelineItem } from '../model/types';

const { openSecureDocument, openSecureDocumentPopup } = vi.hoisted(() => ({
  openSecureDocument: vi.fn(async () => undefined),
  openSecureDocumentPopup: vi.fn(),
}));
vi.mock('@/src/modules/policies/documents/openSecureDocument', () => ({
  openSecureDocument,
  openSecureDocumentPopup,
}));

const item: CommunicationTimelineItem = {
  id: 'msg_1',
  kind: 'MESSAGE_OUTBOUND',
  occurredAt: '2026-08-18T10:00:00.000Z',
  threadId: 'thr_1',
  messageId: 'msg_1',
  title: 'Your policy documents',
  body: 'Pack attached.',
  status: 'SENT',
  channel: 'EMAIL',
  fromActor: 'system',
  toRecipients: ['customer@example.com'],
  attachments: [
    {
      filename: 'PolicySchedule.pdf',
      storageUri: '/api/documents/schedule-abc.pdf',
      url: '/api/documents/schedule-abc.pdf',
    },
  ],
};

describe('TimelineEventCard sent documents (ABY-433)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    openSecureDocument.mockReset();
  });

  it('makes already-sent document packs obvious and downloadable', () => {
    render(<TimelineEventCard item={item} users={[]} />);
    expect(screen.getByTestId('documents-sent')).toHaveTextContent('Documents sent');
    const link = screen.getByRole('link', { name: 'PolicySchedule.pdf' });
    expect(link).toHaveAttribute('href', '/api/documents/schedule-abc.pdf');
  });

  it('opens sent documents through the authenticated binary path (ABY-452)', () => {
    const popup = window;
    openSecureDocumentPopup.mockReturnValue(popup);
    render(<TimelineEventCard item={item} users={[]} />);
    fireEvent.click(screen.getByRole('link', { name: 'PolicySchedule.pdf' }));
    expect(openSecureDocument).toHaveBeenCalledWith('/api/documents/schedule-abc.pdf', {
      inline: true,
      popup,
    });
    expect(openSecureDocumentPopup).toHaveBeenCalledTimes(1);
  });
});
