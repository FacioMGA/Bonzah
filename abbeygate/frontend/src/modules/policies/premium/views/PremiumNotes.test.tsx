/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PremiumNotes } from './PremiumNotes';

describe('PremiumNotes sanctions blockers', () => {
  it('renders sanctions blocker evidence details', () => {
    render(
      <PremiumNotes
        selectedPortfolio={{ id: 'pol-1' }}
        issueReadiness={{
          blockers: [
            {
              code: 'SANCTIONS_BLOCKED',
              group: 'UNDERWRITING',
              message: 'Sanctions screening returned a potential match.',
              details: { providerSearchId: 'cs-9012', providerRiskRating: '87' },
            },
          ],
        }}
        issueReadinessLoading={false}
        handleReRate={vi.fn()}
        handleSendQuestionnaire={vi.fn()}
        reloadCurrentPolicy={vi.fn(async () => undefined)}
        refreshIssueReadiness={vi.fn(async () => undefined)}
        openQuoteWizard={vi.fn()}
      />
    );

    expect(screen.getByText('Sanctions screening returned a potential match.')).toBeTruthy();
    expect(screen.getByText('Ref cs-9012 · Score 87')).toBeTruthy();
  });

  it('renders sanctions first-hit row with PDF link when blocker carries firstHit + reportFilename', () => {
    render(
      <PremiumNotes
        selectedPortfolio={{ id: 'pol-1' }}
        issueReadiness={{
          blockers: [
            {
              code: 'SANCTIONS_BLOCKED',
              group: 'UNDERWRITING',
              message: 'Sanctions screening returned a potential match.',
              details: {
                providerSearchId: 'd5c1943a-1d18-4988-a9fe-bb9301c391dc',
                providerRiskRating: '100',
                reportFilename: 'creditsafe-report.pdf',
                firstHit: {
                  matchScore: 100,
                  name: 'Saud Al-Qahtani',
                  country: 'SA',
                  dateOfBirth: '1978-07-07',
                  gender: 'Male',
                  pepTier: 'PepTier1',
                  reasonsListed: 'PEP-CURRENT, AM, SAN-CURRENT',
                  hitId: '2903697c-6d6c-493c-bc75-393a095e1152',
                },
              },
            },
          ],
        }}
        issueReadinessLoading={false}
        handleReRate={vi.fn()}
        handleSendQuestionnaire={vi.fn()}
        reloadCurrentPolicy={vi.fn(async () => undefined)}
        refreshIssueReadiness={vi.fn(async () => undefined)}
        openQuoteWizard={vi.fn()}
      />
    );

    expect(screen.getByText('Saud Al-Qahtani')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('PEP-CURRENT, AM, SAN-CURRENT')).toBeTruthy();
    expect(screen.getByText('2903697c-6d6c-493c-bc75-393a095e1152')).toBeTruthy();
    const pdfLink = screen.getByRole('link', { name: /download full report/i }) as HTMLAnchorElement;
    expect(pdfLink.getAttribute('href')).toBe('/api/documents/creditsafe-report.pdf?inline=1');
  });

  it('surfaces missing sanctions search evidence explicitly', () => {
    render(
      <PremiumNotes
        selectedPortfolio={{ id: 'pol-1' }}
        issueReadiness={{
          blockers: [
            {
              code: 'SANCTIONS_EVIDENCE_MISSING',
              group: 'UNDERWRITING',
              message: 'Sanctions screening evidence is incomplete.',
              details: {},
            },
          ],
        }}
        issueReadinessLoading={false}
        handleReRate={vi.fn()}
        handleSendQuestionnaire={vi.fn()}
        reloadCurrentPolicy={vi.fn(async () => undefined)}
        refreshIssueReadiness={vi.fn(async () => undefined)}
        openQuoteWizard={vi.fn()}
      />
    );

    expect(screen.getByText('Missing search ref · Missing score')).toBeTruthy();
  });

  it('keeps blocker actions disabled in historical quote version view', () => {
    render(
      <PremiumNotes
        selectedPortfolio={{ id: 'pol-1' }}
        viewingVersionId="v1"
        issueReadiness={{
          blockers: [
            {
              code: 'DOCUMENT_FIELDS_MISSING',
              group: 'DOCUMENTS',
              message: 'Missing fields',
              actions: [{ label: 'Fix now', actionId: 'BO.RECALC_PREMIUM' }],
            },
          ],
        }}
        issueReadinessLoading={false}
        handleReRate={vi.fn()}
        handleSendQuestionnaire={vi.fn()}
        reloadCurrentPolicy={vi.fn(async () => undefined)}
        refreshIssueReadiness={vi.fn(async () => undefined)}
        openQuoteWizard={vi.fn()}
      />
    );

    const actionButton = screen.getByRole('button', { name: 'Fix now' }) as HTMLButtonElement;
    expect(actionButton.disabled).toBe(true);
    fireEvent.click(actionButton);
  });
});
