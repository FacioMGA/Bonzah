import React from 'react';
import { Button } from '@/src/shared/ui';
import { Modal } from '@/src/shared/ui';

interface ChangeProductModalProps {
  isOpen: boolean;
  fromProductLabel: string;
  toProductLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal shown when the UW changes binder/program after a questionnaire
 * has already been sent to the customer. Confirming supersedes the active questionnaire
 * and requires a new one to be sent for the updated product.
 */
export function ChangeProductModal({ isOpen, fromProductLabel, toProductLabel, onConfirm, onCancel }: ChangeProductModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Change product?"
      actions={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onCancel}
            className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
          >
            Keep current product
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onConfirm}
            className="bg-amber-600 text-white px-6 py-3 rounded-xl font-black shadow-lg hover:bg-amber-700 transition"
          >
            Change product
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-2">
          <div className="text-sm text-slate-700">
            A questionnaire has already been sent for:
          </div>
          <div className="text-sm font-black text-slate-900">{fromProductLabel}</div>
          <div className="text-sm text-slate-500 mt-1">Changing to:</div>
          <div className="text-sm font-black text-slate-900">{toProductLabel}</div>
        </div>
        <p className="text-sm text-slate-600">
          This will invalidate the previous questionnaire link. Any submitted answers will be
          kept for audit but will not be used for underwriting this product.
        </p>
        <p className="text-xs text-slate-400 font-semibold">
          You will need to send a new questionnaire once the product is changed.
        </p>
      </div>
    </Modal>
  );
}
