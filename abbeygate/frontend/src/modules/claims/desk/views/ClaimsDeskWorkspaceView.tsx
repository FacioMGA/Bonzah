import React from 'react';
import type { Location, NavigateFunction } from 'react-router-dom';
import { ClaimsDeskTabsView } from '@/src/modules/claims/desk/views/ClaimsDeskTabsView';
import { ClaimsDeskModalsView } from '@/src/modules/claims/desk/views/ClaimsDeskModalsView';
import { ClaimsDeskControllerProvider } from '@/src/modules/claims/desk/views/ClaimsDeskControllerContext';
import { useClaimsDeskController } from '@/src/modules/claims/desk/controller/useClaimsDeskController';
import { Button } from '@/src/shared/ui';

type ClaimsDeskController = ReturnType<typeof useClaimsDeskController>;

type ClaimsDeskWorkspaceViewProps = {
  ctrl: ClaimsDeskController;
  location: Location;
  navigate: NavigateFunction;
};

type Blocker = {
  id: string;
  title: string;
  detail: string;
};

function toBlockers(message: string): Blocker[] {
  const normalized = String(message || '').toLowerCase();
  if (normalized.includes('cannot be closed while outstanding reserve or expected recovery remains')
    || normalized.includes('cannot close while')) {
    return [
      {
        id: 'closure-reserve',
        title: 'Outstanding reserve still exists.',
        detail: 'Release reserve before applying closure.',
      },
      {
        id: 'closure-recovery',
        title: 'Expected recovery is still open.',
        detail: 'Resolve expected recovery before applying closure.',
      },
    ];
  }
  if (normalized.includes('referral approval required') || normalized.includes('authority')) {
    return [{
      id: 'authority',
      title: 'Movement exceeds handler authority.',
      detail: 'Underwriter approval is required before applying this change.',
    }];
  }
  if (normalized.includes('cannot deny claim') || normalized.includes('denial_invariant_failed')) {
    const blockers: Blocker[] = [];
    if (normalized.includes('paid')) {
      blockers.push({
        id: 'deny-paid',
        title: 'Paid amounts already exist.',
        detail: 'A denied decision cannot be applied after payment has been issued.',
      });
    }
    if (normalized.includes('outstanding')) {
      blockers.push({
        id: 'deny-outstanding',
        title: 'Outstanding reserve still exists.',
        detail: 'Release reserve before applying denial.',
      });
    }
    return blockers.length > 0
      ? blockers
      : [{
          id: 'deny-general',
          title: 'This claim is not eligible for denial right now.',
          detail: 'Resolve financial constraints before applying denial.',
        }];
  }
  if (normalized.includes('payment exceeds available reserve') || normalized.includes('payment exceeds outstanding')) {
    return [{
      id: 'payment-reserve',
      title: 'Payment exceeds available reserve.',
      detail: 'Increase reserve before issuing payment.',
    }];
  }
  if (normalized.includes('only allowed when claim is closed')
    || normalized.includes('only closed claims can be reopened')
    || normalized.includes('action_not_allowed_in_state')) {
    return [{
      id: 'state-closed',
      title: 'This claim is closed.',
      detail: 'Reopen the claim before applying new actions.',
    }];
  }
  return [{
    id: 'generic',
    title: 'This action cannot be applied yet.',
    detail: String(message || 'Resolve the listed condition and try again.'),
  }];
}

export function ClaimsDeskWorkspaceView(props: ClaimsDeskWorkspaceViewProps) {
  const { ctrl, location, navigate } = props;
  const { local, actions } = ctrl;
  const blockers = local.error ? toBlockers(local.error) : [];

  return (
    <ClaimsDeskControllerProvider controller={ctrl}>
      <div className="space-y-6">
        <ClaimsDeskTabsView location={location} navigate={navigate} />
        <ClaimsDeskModalsView />
        {local.error ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] px-4">
            <div className="w-full max-w-2xl rounded-3xl border border-amber-200/80 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.20)]">
              <div className="px-6 py-5 border-b border-amber-100/80">
                <div className="flex items-center gap-2 text-amber-700">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.59c.75 1.334-.213 2.99-1.742 2.99H3.48c-1.53 0-2.492-1.656-1.742-2.99l6.518-11.59zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-6a1 1 0 00-.993.883L9 8v3a1 1 0 001.993.117L11 11V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm font-black tracking-wide uppercase">Please review</div>
                </div>
                <div className="mt-1 text-xl font-black text-slate-900">Action cannot be applied</div>
                <div className="mt-2 text-sm font-medium text-slate-600">
                  This action cannot be applied because the following conditions must be resolved first.
                </div>
              </div>
              <div className="p-6 space-y-3">
                {blockers.map((blocker) => (
                  <div key={blocker.id} className="rounded-2xl border border-amber-100 bg-amber-50/40 px-4 py-4">
                    <div className="text-sm font-black text-slate-800">{blocker.title}</div>
                    <div className="mt-1 text-sm font-medium text-slate-600">{blocker.detail}</div>
                  </div>
                ))}
                <div className="pt-2 flex items-center justify-end">
                  <Button
                    className="h-11 px-6 text-sm font-black tracking-tight rounded-xl"
                    onClick={actions.dismissError}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ClaimsDeskControllerProvider>
  );
}
