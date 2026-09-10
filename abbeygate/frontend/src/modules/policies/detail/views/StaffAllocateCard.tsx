import React from 'react';
import { Button } from '@/src/shared/ui';
import type { UserRecord } from '@/src/modules/accessControl/model/types';

type StaffAllocateCardProps = {
  canAllocate: boolean;
  currentAssigneeLabel: string;
  assigneeSearch: string;
  selectedAssigneeId: string;
  assigneeOptions: UserRecord[];
  assigneeLoading: boolean;
  assigning: boolean;
  assignmentError: string | null;
  assignmentMessage: string | null;
  selectedAssignee: UserRecord | null;
  onSearchChange: (value: string) => void;
  onSelectAssignee: (id: string, label: string) => void;
  onAssign: () => void;
};

export function StaffAllocateCard(props: StaffAllocateCardProps) {
  return (
    <div className="ui-card ui-card-pad space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-lg font-black text-slate-900">Assigned staff member</div>
          <div className="text-xs text-slate-500 mt-1">
            Assign this policy to the staff member responsible for servicing it.
          </div>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-slate-500">
          {props.currentAssigneeLabel ? `Current: ${props.currentAssigneeLabel}` : 'Unassigned'}
        </div>
      </div>
      {props.canAllocate && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Search staff
              </label>
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-brand-primary/30"
                value={props.assigneeSearch}
                placeholder="Type a staff name or email..."
                onChange={(event) => props.onSearchChange(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!props.selectedAssigneeId || props.assigning}
              onClick={props.onAssign}
            >
              {props.assigning ? 'Assigning...' : 'Assign staff'}
            </Button>
          </div>
          {props.assigneeSearch.trim().length >= 2 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2">
              {props.assigneeLoading ? (
                <div className="px-3 py-2 text-sm font-semibold text-slate-500">Searching staff...</div>
              ) : props.assigneeOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm font-semibold text-slate-500">
                  No active staff found.
                </div>
              ) : (
                <div className="space-y-1">
                  {props.assigneeOptions.map((option) => {
                    const label = [option.firstName, option.lastName].filter(Boolean).join(' ') || option.name || option.email;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => props.onSelectAssignee(option.id, label)}
                        className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                          props.selectedAssigneeId === option.id ? 'bg-brand-primary text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="font-bold">{label}</span>
                        <span className="ml-2 text-xs opacity-75">{option.email}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {props.selectedAssignee && (
            <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
              Ready to assign to {[props.selectedAssignee.firstName, props.selectedAssignee.lastName].filter(Boolean).join(' ') || props.selectedAssignee.name || props.selectedAssignee.email}.
            </div>
          )}
        </>
      )}
      {props.assignmentMessage && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{props.assignmentMessage}</div>}
      {props.assignmentError && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{props.assignmentError}</div>}
    </div>
  );
}
