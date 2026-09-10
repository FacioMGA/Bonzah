/* @vitest-environment happy-dom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  listPolicyDocuments: vi.fn(),
  openClientDocument: vi.fn(async () => undefined),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ policyId: 'policy_1' }),
}));

vi.mock('@/src/shared/ui', () => ({
  PageHeader: () => <div />,
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/src/surfaces/client/api/clientPortalClient', () => ({
  clientPortalClient: { listPolicyDocuments: mocks.listPolicyDocuments },
}));

vi.mock('@/src/surfaces/client/lib/openClientDocument', () => ({
  openClientDocument: mocks.openClientDocument,
}));

import ClientPolicyDocumentsPage from './ClientPolicyDocumentsPage';

describe('ClientPolicyDocumentsPage', () => {
  beforeEach(() => {
    mocks.listPolicyDocuments.mockReset();
    mocks.openClientDocument.mockReset();
    mocks.listPolicyDocuments.mockResolvedValue({
      success: true,
      data: [{ id: 'doc_1', type: 'SCHEDULE_PDF', filename: 'schedule.pdf', storageUri: '/api/documents/schedule.pdf' }],
    });
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'client-token') });
  });

  it('uses a true download action for selected authenticated documents', async () => {
    render(<ClientPolicyDocumentsPage />);
    await screen.findByText('Schedule Pdf');

    fireEvent.click(screen.getByText('Select all'));
    fireEvent.click(screen.getByText('Download selected'));

    await waitFor(() => {
      expect(mocks.openClientDocument).toHaveBeenCalledWith('/api/documents/schedule.pdf', { inline: false });
    });
  });
});
