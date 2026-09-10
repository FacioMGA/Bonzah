/* @vitest-environment happy-dom */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Documents } from './DocumentsTab';

const mocks = vi.hoisted(() => ({
  requestBinary: vi.fn(),
  retryIssuedPack: vi.fn(),
  emailPolicyDocuments: vi.fn(),
  getExternalIssuanceRequirements: vi.fn(),
  completeExternalIssuance: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/src/shared/api/http', () => ({
  http: { requestBinary: mocks.requestBinary },
}));

vi.mock('@/src/modules/policies/api/documentsApiClient', () => ({
  documentsApiClient: { emailPolicyDocuments: mocks.emailPolicyDocuments, retryIssuedPack:mocks.retryIssuedPack },
}));

vi.mock('@/src/modules/policies/api/policyCrudApiClient', () => ({
  policyCrudApiClient: {
    getExternalIssuanceRequirements: mocks.getExternalIssuanceRequirements,
    completeExternalIssuance: mocks.completeExternalIssuance,
  },
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
    mocks.getExternalIssuanceRequirements.mockResolvedValue({ success: true, data: { canComplete: false, documentTypes: [] } });
    mocks.completeExternalIssuance.mockResolvedValue({ success: true, data: {} });
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
            pack:'ISSUED_POLICY_PACK', riskTransactionId:'rt-1',
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
            pack:'ISSUED_POLICY_PACK', riskTransactionId:'rt-1',
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

  it('submits only the adapter-declared external issued-document pack', async () => {
    mocks.getExternalIssuanceRequirements.mockResolvedValueOnce({
      success: true,
      data: { canComplete: true, requiresUpload: true, documentTypes: ['OPEN_MARKET_EXTERNAL_CERTIFICATE_PDF'] },
    });
    renderTab();

    const fileInput = await screen.findByLabelText('Certificate');
    const file = new File(['issued'], 'insurer-certificate.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByText('Activate policy and email documents'));

    await waitFor(() => {
      expect(mocks.completeExternalIssuance).toHaveBeenCalledWith('pol_1', [
        { type: 'OPEN_MARKET_EXTERNAL_CERTIFICATE_PDF', file },
      ]);
    });
  });

  it('shows only declared external issued documents and excludes sanctions evidence', async () => {
    mocks.getExternalIssuanceRequirements.mockResolvedValueOnce({
      success: true,
      data: { canComplete: false, documentTypes: ['OPEN_MARKET_EXTERNAL_CERTIFICATE_PDF'] },
    });
    render(
      <Documents
        policyId="pol_1"
        docs={[
          { id: 'external-doc', type: 'OPEN_MARKET_EXTERNAL_CERTIFICATE_PDF', pack: 'ISSUED_POLICY_PACK', status: 'GENERATED', url: '/api/documents/external.pdf' },
          { id: 'sanctions-doc', type: 'CREDITSAFE_SANCTIONS_REPORT_PDF', pack: 'ISSUED_POLICY_PACK', status: 'GENERATED', url: '/api/documents/sanctions.pdf' },
        ]}
        policyVersions={[]}
      />,
    );

    expect(await screen.findByText('Certificate')).toBeTruthy();
    expect(screen.queryByText('Creditsafe Sanctions Report Pdf')).toBeNull();
    expect(screen.queryByLabelText('Select Creditsafe Sanctions Report Pdf')).toBeNull();
  });

  it('resumes activation without a duplicate upload when the external pack is already recorded', async () => {
    mocks.getExternalIssuanceRequirements.mockResolvedValueOnce({
      success: true,
      data: { canComplete: true, requiresUpload: false, documentTypes: ['OPEN_MARKET_EXTERNAL_CERTIFICATE_PDF'] },
    });
    renderTab();

    fireEvent.click(await screen.findByText('Resume activation and email documents'));

    await waitFor(() => {
      expect(mocks.completeExternalIssuance).toHaveBeenCalledWith('pol_1', []);
    });
  });
});

describe('issued pack recovery',()=>{
  const versions=[{status:'BOUND',transactionType:'INCEPTION',transactionNumber:1,riskTransactionId:'rt-current'}];
  it('offers authorized recovery through the canonical command and does not call queued output generated',async()=>{
    mocks.getExternalIssuanceRequirements.mockResolvedValue({success:true,data:{canComplete:false,documentTypes:[]}});
    mocks.retryIssuedPack.mockResolvedValue({success:true,data:{status:'queued',eventId:'event-a'}});
    const refresh=vi.fn();
    render(<Documents policyId="policy-a" docs={[]} policyVersions={versions} canGenerateDocuments onRefreshDocuments={refresh}/>);
    fireEvent.click(screen.getByRole('button',{name:'Retry issued document pack'}));
    await waitFor(()=>expect(mocks.retryIssuedPack).toHaveBeenCalledWith('policy-a'));
    expect(await screen.findByText(/Issued document request queued/)).toBeTruthy();
    expect(screen.getByText('No documents yet.')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });
  it('does not expose recovery mutation without the generated-document permission',()=>{
    render(<Documents policyId="policy-a" docs={[]} policyVersions={versions} onRefreshDocuments={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'Retry issued document pack'})).toBeNull();
  });
});
