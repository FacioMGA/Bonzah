/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PremiumActions } from './PremiumActions';

const noop = vi.fn();

function renderActions(
  quoteActionDisabledReason?: string | null,
  options: {
    hidePricingControls?: boolean;
    canSaveQuoteVersion?: boolean;
    forceShowQuoteAction?: boolean;
    canIssue?: boolean;
    canBindAuthority?: boolean;
    quoteActionLabel?: string;
    status?: string;
    viewingRiskTransactionId?: string;
    latestIssuedRiskTransactionId?: string;
    canIssueAuthority?: boolean;
  } = {},
) {
  render(
    <PremiumActions
      selectedPortfolio={{ id: 'pol-1', status: options.status ?? 'QUOTED', quoteResponse: { primaryOption: { annualPremium: 250 }, status: 'quoted' } }}
      issueReadiness={{ canIssue: options.canIssue ?? true, blockers: options.canIssue === false ? [{ code: 'UW_INCOMPLETE', message: 'UW incomplete' }] : [] }}
      canSaveQuoteVersion={options.canSaveQuoteVersion}
      quoteActionLabel={options.quoteActionLabel ?? 'Send to client'}
      quoteActionDisabledReason={quoteActionDisabledReason}
      hidePricingControls={options.hidePricingControls}
      forceShowQuoteAction={options.forceShowQuoteAction}
      canBindAuthority={options.canBindAuthority}
      canIssueAuthority={options.canIssueAuthority}
      viewingRiskTransactionId={options.viewingRiskTransactionId}
      latestIssuedRiskTransactionId={options.latestIssuedRiskTransactionId}
      viewingRiskTransactionSnapshot={options.viewingRiskTransactionId ? {transactionType:'INCEPTION',status:'BOUND'} : null}
      handleReRate={noop}
      handleSaveQuoteVersion={noop}
      handleUnlockBoundMode={noop}
      setEndorsementEffectiveDate={noop}
      setEndorsementReason={noop}
      setShowCreateEndorsementModal={noop}
      handleIssueQuote={noop}
      handleBindCoverage={noop}
      handleIssuePolicyFinal={noop}
      handleBindEndorsementDraft={noop}
      handleIssueEndorsement={noop}
    />,
  );
}

describe('PremiumActions', () => {
  it('disables Send to client when manual proposal guardrails are incomplete', () => {
    renderActions('Add premium for Public liability');

    const button = screen.getByRole('button', { name: /Send to client/i });
    expect(button).toBeDisabled();
    expect(screen.getByText('Add premium for Public liability')).toBeTruthy();
  });

  it('disables Send to client until the policy has a saved product assignment', () => {
    renderActions('Select and save an active binder and program before sending this quote.');

    const button = screen.getByRole('button', { name: /Send to client/i });
    expect(button).toBeDisabled();
    expect(screen.getByText('Select and save an active binder and program before sending this quote.')).toBeTruthy();
  });

  it('hides generic pricing controls for manual proposals while keeping Send to client', () => {
    renderActions(null, { hidePricingControls: true, canSaveQuoteVersion: true });

    expect(screen.queryByRole('button', { name: /Recalculate/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save version/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Send to client/i })).toBeTruthy();
  });

  it('shows Send to client for manual proposals even when generic readiness would hide quote actions', () => {
    renderActions(null, { forceShowQuoteAction: true, canIssue: false });

    expect(screen.getByRole('button', { name: /Send to client/i })).toBeEnabled();
  });

  it('shows Send quote even when bind readiness is blocked (ABY-497)', () => {
    renderActions(null, { canIssue: false, quoteActionLabel: 'Send quote' });

    expect(screen.getByRole('button', { name: /Send quote/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Bind coverage/i })).toBeNull();
  });

  it.each(['CANCELLED', 'EXPIRED', 'ISSUING', 'CANCELLATION_REQUESTED'])('hides Send quote for terminal or post-bind status %s', (status) => {
    renderActions(null, { status, quoteActionLabel: 'Send quote' });

    expect(screen.queryByRole('button', { name: /Send quote/i })).toBeNull();
  });

  it('hides bind coverage when the operator lacks bind authority', () => {
    renderActions(null, { canBindAuthority: false });

    expect(screen.queryByRole('button', { name: /Bind coverage/i })).toBeNull();
  });
});

it('does not pass a DOM click event as quote-data override to recalculation', () => {
  noop.mockClear(); renderActions(); fireEvent.click(screen.getByRole('button', {name: 'Recalculate'})); expect(noop).toHaveBeenCalledWith();
});

it('offers the server-gated issuance action again for retained bound coverage after an issuance failure',()=>{
  renderActions(null,{status:'BOUND'});expect(screen.getByRole('button',{name:'Issue policy'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Bind coverage'})).toBeNull();
});

it.each([['current','current',true,true],['historical','current',true,false],['current','current',false,false]] as const)('only issues current bound inception with permission (%s / %s / %s)', (viewing,latest,permission,visible)=>{
  renderActions(null,{status:'BOUND',viewingRiskTransactionId:viewing,latestIssuedRiskTransactionId:latest,canIssueAuthority:permission});
  expect(Boolean(screen.queryByRole('button',{name:'Issue policy'}))).toBe(visible);
});
