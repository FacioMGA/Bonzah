/* @vitest-environment happy-dom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Documents } from './DocumentsTab';

const mocks = vi.hoisted(() => ({
  requestBinary: vi.fn(),
  emailPolicyDocuments: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/src/shared/api/http', () => ({
  http: { requestBinary: mocks.requestBinary },
}));

vi.mock('@/src/modules/policies/api/documentsApiClient', () => ({
  documentsApiClient: { emailPolicyDocuments: mocks.emailPolicyDocuments },
}));

vi.mock('@/src/shared/lib/logger', () => ({
  logger: { error: mocks.loggerError },
}));

vi.mock('@/src/shared/ui', () => ({
  IconButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

describe('DocumentsTab view/download flow', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => (key === 'auth_token' ? 'test-token' : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    mocks.requestBinary.mockResolvedValue(
      new Response(new Blob(['pdf-bytes'], { type: 'application/pdf' })),
    );
    mocks.emailPolicyDocuments.mockResolvedValue({
      success: true,
      data: { sent: true, toEmail: 'client@example.com', count: 1 },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-pdf');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderTab() {
    render(
      <Documents
        policyId="pol_1"
        docs={[
          {
            id: 'doc_1',
            type: 'MOTOR_SCHEDULE_PDF',
            status: 'GENERATED',
            createdAt: '2026-04-03T00:00:00.000Z',
            url: '/api/documents/file-1.pdf',
          },
        ]}
        policyVersions={[
          {
            status: 'BOUND',
            transactionType: 'INCEPTION',
            transactionNumber: 1,
            riskTransactionId: 'rt-1',
            effectiveDate: '2026-04-03T00:00:00.000Z',
          },
        ]}
      />,
    );
  }

  it('opens View in a separate popup tab with authenticated binary fetch', async () => {
    const popup = { location: { href: '' }, close: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup);

    renderTab();
    fireEvent.click(screen.getByText('View'));

    await waitFor(() => {
      expect(mocks.requestBinary).toHaveBeenCalledWith('documents/file-1.pdf?inline=1');
    });
    expect(openSpy).toHaveBeenCalled();
    expect(popup.location.href).toBe('blob:test-pdf');
  });

  it('uses non-inline endpoint for direct download action', async () => {
    const popup = { location: { href: '' }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);

    renderTab();
    fireEvent.click(screen.getByTitle('Download Policy Schedule'));

    await waitFor(() => {
      expect(mocks.requestBinary).toHaveBeenCalledWith('documents/file-1.pdf');
    });
  });

  it('falls back to current-tab inline navigation when popup is blocked', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    renderTab();
    fireEvent.click(screen.getByText('View'));

    await waitFor(() => {
      expect(mocks.requestBinary).toHaveBeenCalledWith('documents/file-1.pdf?inline=1');
    });
    await waitFor(() => {
      expect(window.location.href).toContain('blob:test-pdf');
    });
    expect(openSpy).toHaveBeenCalled();
  });

  it('shows View for staff with documents.view but hides Download without documents.download', () => {
    render(
      <Documents
        policyId="pol_1"
        canViewDocuments
        canDownloadDocuments={false}
        docs={[
          {
            id: 'doc_1',
            type: 'MOTOR_SCHEDULE_PDF',
            status: 'GENERATED',
            createdAt: '2026-04-03T00:00:00.000Z',
            url: '/api/documents/file-1.pdf',
          },
        ]}
        policyVersions={[
          {
            status: 'BOUND',
            transactionType: 'INCEPTION',
            transactionNumber: 1,
            riskTransactionId: 'rt-1',
            effectiveDate: '2026-04-03T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByText('View')).toBeTruthy();
    expect(screen.queryByTitle('Download Policy Schedule')).toBeNull();
  });
});

