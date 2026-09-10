/* @vitest-environment happy-dom */

/**
 * PR-1D — pending-issuance UX contract.
 *
 * The post-payment cluster (ABY-27/28/33/34) all share the same root
 * symptom: the customer pays, the wizard silently auto-advances to the
 * "issued" step, but documents and welcome email never arrive because
 * the doc-pack worker hasn't drained yet. The PaymentStep no longer
 * auto-advances when issue-readiness fails to resolve in time — it
 * surfaces a distinct `pending_issuance` phase with explicit copy,
 * blockers, and two actions: re-check now, or continue to dashboard.
 *
 * This test pins the visual + behavioural contract that the rest of
 * the wizard depends on:
 *
 *   - badge clearly says "Pending issuance" (not "Attention" / "In
 *     progress") so the user can distinguish from a hard failure
 *   - the explanation panel uses the amber/pending tone, not red/error
 *   - readiness blockers are listed verbatim
 *   - "Re-check now" and "Continue to my dashboard" buttons render and
 *     call their handlers
 *   - the re-check button shows a busy state when `recheckBusy` is true
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaymentProcessingCard } from './PaymentProcessingCard';

describe('PaymentProcessingCard — pending_issuance phase (PR-1D)', () => {
  it('renders the explicit "Pending issuance" badge instead of error/in-progress', () => {
    render(
      <PaymentProcessingCard
        phase="pending_issuance"
        message="Your card was charged successfully. Documents are still being prepared."
      />,
    );
    expect(screen.getByTestId('payment-pending-badge')).toHaveTextContent(/pending issuance/i);
    expect(screen.queryByText(/in progress/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attention/i)).not.toBeInTheDocument();
  });

  it('uses the pending headline (not the error headline)', () => {
    render(
      <PaymentProcessingCard
        phase="pending_issuance"
        message="msg"
      />,
    );
    expect(screen.getByText(/payment received — your policy is being issued/i)).toBeInTheDocument();
    expect(screen.queryByText(/we hit a snag/i)).not.toBeInTheDocument();
  });

  it('renders the readiness blockers when provided', () => {
    render(
      <PaymentProcessingCard
        phase="pending_issuance"
        message="msg"
        readinessBlockers={[
          { code: 'WELCOME_EMAIL_PENDING', message: 'Welcome email is still queued.' },
          { code: 'ISSUED_PACK_PENDING', message: 'Document pack generation is in progress.' },
        ]}
      />,
    );
    const list = screen.getByTestId('payment-pending-blockers');
    expect(list).toHaveTextContent(/welcome email is still queued/i);
    expect(list).toHaveTextContent(/document pack generation is in progress/i);
  });

  it('falls back to blocker code when message is missing', () => {
    render(
      <PaymentProcessingCard
        phase="pending_issuance"
        message="msg"
        readinessBlockers={[{ code: 'UNKNOWN_BLOCKER', message: '' }]}
      />,
    );
    expect(screen.getByTestId('payment-pending-blockers')).toHaveTextContent(/unknown_blocker/i);
  });

  it('wires the re-check and continue actions and surfaces the busy state', () => {
    const onRecheckReadiness = vi.fn();
    const onContinueToDashboard = vi.fn();
    const { rerender } = render(
      <PaymentProcessingCard
        phase="pending_issuance"
        message="msg"
        onRecheckReadiness={onRecheckReadiness}
        onContinueToDashboard={onContinueToDashboard}
      />,
    );
    const recheck = screen.getByTestId('payment-pending-recheck');
    const cont = screen.getByTestId('payment-pending-continue');
    expect(recheck).toBeEnabled();
    fireEvent.click(recheck);
    fireEvent.click(cont);
    expect(onRecheckReadiness).toHaveBeenCalledTimes(1);
    expect(onContinueToDashboard).toHaveBeenCalledTimes(1);

    // PR-1D — must visibly disable the re-check button while a probe is in flight
    rerender(
      <PaymentProcessingCard
        phase="pending_issuance"
        message="msg"
        onRecheckReadiness={onRecheckReadiness}
        onContinueToDashboard={onContinueToDashboard}
        recheckBusy
      />,
    );
    const busyBtn = screen.getByTestId('payment-pending-recheck');
    expect(busyBtn).toBeDisabled();
    expect(busyBtn).toHaveTextContent(/checking/i);
  });

  it('does not render pending-only UI on the regular error phase', () => {
    render(
      <PaymentProcessingCard
        phase="error"
        error="Payment failed"
        onRetry={vi.fn()}
        onStartOver={vi.fn()}
        readinessBlockers={[{ code: 'X', message: 'x' }]}
      />,
    );
    expect(screen.queryByTestId('payment-pending-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-pending-blockers')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-pending-recheck')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-pending-continue')).not.toBeInTheDocument();
  });
});

/**
 * ADR-0017 — `documents_failed` terminal phase contract.
 *
 * The bug this surface fixes (ABY-97 + ABY-98 + 8 duplicates):
 *
 *   When the doc-pack worker permanently failed, the wizard had no
 *   distinct UI for "we know it's broken, please contact us" — it
 *   either kept showing the amber `pending_issuance` card forever
 *   (lying to the user that work was still happening) or silently
 *   collapsed back to the bare payment widget (ABY-98 "status falsely
 *   jumps back to payment stage with no clear understanding of what's
 *   going on"). This contract pins the new red-treatment recovery
 *   surface that backs `customerOutcome: 'failed'`.
 */
describe('PaymentProcessingCard — documents_failed phase (ADR-0017)', () => {
  it('renders the explicit "Documents failed" badge instead of pending/in-progress', () => {
    render(
      <PaymentProcessingCard
        phase="documents_failed"
        message="We could not generate your policy documents automatically."
      />,
    );
    expect(screen.getByTestId('payment-documents-failed-badge')).toHaveTextContent(/documents failed/i);
    expect(screen.queryByTestId('payment-pending-badge')).not.toBeInTheDocument();
    expect(screen.queryByText(/in progress/i)).not.toBeInTheDocument();
  });

  it('uses the failed headline (not pending/error/in-progress)', () => {
    render(<PaymentProcessingCard phase="documents_failed" message="msg" />);
    // The phrase appears twice (headline + message-panel title) — both
    // valid surfaces for the same intent. Pin presence rather than
    // uniqueness here, and assert the wrong-phase headlines are absent.
    expect(screen.getAllByText(/document generation needs our help/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/your policy is being issued/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/we hit a snag/i)).not.toBeInTheDocument();
  });

  it('renders the failure blockers in the dedicated documents-failed section', () => {
    render(
      <PaymentProcessingCard
        phase="documents_failed"
        message="msg"
        readinessBlockers={[
          { code: 'DOCUMENTS_GENERATION_FAILED', message: 'Template not found: HOME_CERTIFICATE.' },
        ]}
      />,
    );
    const details = screen.getByTestId('payment-documents-failed-details');
    expect(details).toHaveTextContent(/template not found: home_certificate/i);
    // Distinct from the amber pending list.
    expect(screen.queryByTestId('payment-pending-blockers')).not.toBeInTheDocument();
  });

  it('renders the contact CTA when supportContactHref is provided, and the continue CTA when handler is provided', () => {
    const onContinueToDashboard = vi.fn();
    render(
      <PaymentProcessingCard
        phase="documents_failed"
        message="msg"
        supportContactHref="mailto:support@facio.io"
        onContinueToDashboard={onContinueToDashboard}
      />,
    );
    const contact = screen.getByTestId('payment-documents-failed-contact');
    expect(contact).toHaveAttribute('href', 'mailto:support@facio.io');
    const cont = screen.getByTestId('payment-documents-failed-continue');
    fireEvent.click(cont);
    expect(onContinueToDashboard).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the pending-issuance recheck/continue buttons (they are mutually exclusive)', () => {
    render(
      <PaymentProcessingCard
        phase="documents_failed"
        message="msg"
        onRecheckReadiness={vi.fn()}
        onContinueToDashboard={vi.fn()}
        supportContactHref="mailto:support@facio.io"
      />,
    );
    expect(screen.queryByTestId('payment-pending-recheck')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payment-pending-continue')).not.toBeInTheDocument();
  });

  it('paints the active step (generating documents) red instead of blue', () => {
    render(<PaymentProcessingCard phase="documents_failed" message="msg" />);
    // The "Generating documents" step exists in both pending and failed
    // phases — what differs is the visual state. We assert the failed
    // step copy "Needs our team" is rendered (an inferable observable
    // signal of the red state without coupling to Tailwind classes).
    expect(screen.getByText(/needs our team/i)).toBeInTheDocument();
  });
});
