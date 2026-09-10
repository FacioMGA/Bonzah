import React from 'react';
import { Button } from '@/src/shared/ui';

type UwSelfAssignCardProps = {
  visible: boolean;
  currentAssigneeLabel: string;
  assignmentError: string | null;
  assignmentMessage: string | null;
  assigning: boolean;
  onAssign: () => void;
};

export function UwSelfAssignCard(props: UwSelfAssignCardProps) {
  if (!props.visible) return null;
  return (
    <div className="ui-card ui-card-pad flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="text-lg font-black text-slate-900">UW review</div>
        <div className="text-xs text-slate-500 mt-1">
          Assign this review to yourself. CY referral emails still go to Danny only.
        </div>
        {props.currentAssigneeLabel && (
          <div className="mt-2 text-xs font-semibold text-slate-500">Current: {props.currentAssigneeLabel}</div>
        )}
        {props.assignmentError && <div className="mt-2 text-sm font-semibold text-red-600">{props.assignmentError}</div>}
        {props.assignmentMessage && <div className="mt-2 text-sm font-semibold text-emerald-600">{props.assignmentMessage}</div>}
      </div>
      <Button
        type="button"
        variant="primary"
        size="md"
        disabled={props.assigning}
        onClick={props.onAssign}
      >
        {props.assigning ? 'Assigning…' : 'Assign this review to me'}
      </Button>
    </div>
  );
}
