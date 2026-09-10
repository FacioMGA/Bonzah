import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Input } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';
import type { Worksheet } from '@/src/modules/claims/case/model/worksheetTypes';
import { resolveMotorMissingFields } from '@/src/modules/claims/intake/motor/motorGateFieldMap';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  worksheet: Worksheet;
  busy: boolean;
  onRequest: (fieldsRequested: string[], message: string) => void;
};

export function FnolClarificationDrawer({ isOpen, onClose, worksheet, busy, onRequest }: Props) {
  const snapshot = useMemo(
    () => (worksheet.intake?.fnol || {}) as Record<string, unknown>,
    [worksheet.intake?.fnol],
  );
  const missingFields = useMemo(
    () => resolveMotorMissingFields({ gates: worksheet.intake?.gates || [], snapshot }),
    [worksheet.intake?.gates, snapshot],
  );
  const checklist = useMemo(() => Array.from(new Set(missingFields.map((item) => item.label).filter(Boolean))), [missingFields]);
  const [selected, setSelected] = useState<string[]>(checklist);
  const [message, setMessage] = useState('Please provide the missing incident details so we can continue handling your claim.');

  useEffect(() => {
    if (isOpen) {
      setSelected(checklist);
      setMessage('Please provide the missing incident details so we can continue handling your claim.');
    }
  }, [isOpen, checklist]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Request missing information"
      maxWidth="max-w-2xl"
      actions={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onRequest(selected, message)} disabled={selected.length === 0} isLoading={busy}>
            Send
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="text-sm font-semibold text-slate-700">What information do we need?</div>
        <div className="space-y-2">
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">Missing items</div>
          {checklist.map((label) => {
            return (
              <label key={label} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Input
                  type="checkbox"
                  checked={selected.includes(label)}
                  onChange={(e) => {
                    if (e.target.checked) setSelected((prev) => Array.from(new Set([...prev, label])));
                    else setSelected((prev) => prev.filter((value) => value !== label));
                  }}
                />
                {label}
              </label>
            );
          })}
        </div>
        <label className="space-y-1 block">
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">Message</div>
          <Textarea
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 min-h-28"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

