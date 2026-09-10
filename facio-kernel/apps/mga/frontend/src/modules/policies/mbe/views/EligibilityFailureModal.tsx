import React from 'react';
import { createPortal } from 'react-dom';
import { Modal, Button } from '@/src/shared/ui';
import { asRecord } from '@/src/shared/lib/record';

export type EligibilityFailure = {
  code: string;
  title: string;
  message: string;
};

export function normalizeFailureMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error && String(error.message || '').trim()) return String(error.message).trim();
  const rec = asRecord(error);
  const message = rec.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  const nestedError = rec.error;
  if (typeof nestedError === 'string' && nestedError.trim()) return nestedError.trim();
  const nestedRecord = asRecord(nestedError);
  const nestedMessage = nestedRecord.message;
  if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage.trim();
  return fallback;
}

export function EligibilityFailureModal({
  failure,
  onClose,
}: {
  failure: EligibilityFailure | null;
  onClose: () => void;
}) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <Modal
      isOpen={Boolean(failure)}
      onClose={onClose}
      title="Coverage Not Eligible"
      actions={(
        <Button
          type="button"
          onClick={onClose}
          variant="primary"
          size="md"
          className="bg-brand-primary text-white px-5 py-2 rounded-xl font-black hover:bg-brand-secondary transition"
        >
          Understood
        </Button>
      )}
    >
      <div className="space-y-3">
        <div className="text-sm text-slate-500 uppercase tracking-widest font-black">Endorsement</div>
        <div className="text-base font-black text-slate-900">
          {failure?.title || failure?.code || 'Unknown endorsement'}
        </div>
        <div className="text-sm text-slate-700">
          {failure?.message || 'This endorsement is not eligible for the current quote.'}
        </div>
        <div className="text-xs text-slate-500">
          The option was unchecked automatically to keep the policy state valid.
        </div>
      </div>
    </Modal>,
    document.body
  );
}
