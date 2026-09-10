import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';

type Props = {
  isOpen: boolean;
  busy: boolean;
  onClose: () => void;
  onChooseRequest: () => void;
  onChooseManual: () => void;
};

export function ClaimsDeskIntakePathModal({
  isOpen,
  busy,
  onClose,
  onChooseRequest,
  onChooseManual,
}: Props) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Choose intake path"
      actions={(
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition"
            disabled={busy}
          >
            Cancel
          </Button>
        </>
      )}
    >
      <div className="p-2 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-black text-slate-900">Send FNOL to customer</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">Preferred default. We email a secure public FNOL link to the policyholder.</div>
          <Button
            type="button"
            onClick={onChooseRequest}
            className="mt-3 bg-brand-primary text-white px-5 py-2.5 rounded-xl text-sm font-black hover:bg-brand-secondary transition disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Send FNOL link'}
          </Button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-black text-slate-900">Handler enters FNOL now</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">Open the intake form now and continue to an explicit confirm action.</div>
          <Button
            type="button"
            variant="secondary"
            onClick={onChooseManual}
            className="mt-3 border border-slate-300 text-slate-700 px-5 py-2.5 rounded-xl text-sm font-black hover:bg-slate-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={busy}
          >
            Enter intake now
          </Button>
        </div>
      </div>
    </Modal>
  );
}
