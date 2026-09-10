import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { Textarea } from '@/src/shared/ui';

type Props = {
  isOpen: boolean;
  busy: boolean;
  caseInfoMessage: string;
  onClose: () => void;
  onChangeMessage: (next: string) => void;
  onSend: () => void;
};

export function ClaimsDeskCaseInfoModal({
  isOpen,
  busy,
  caseInfoMessage,
  onClose,
  onChangeMessage,
  onSend,
}: Props) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Request more information"
      actions={(
        <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition"
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={onSend}
            className="w-full sm:w-auto bg-brand-primary text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-brand-secondary transition disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={busy || !caseInfoMessage.trim()}
          >
            {busy ? 'Sending…' : 'Send request'}
          </Button>
        </div>
      )}
    >
      <Textarea
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 min-h-32"
        value={caseInfoMessage}
        onChange={(e) => onChangeMessage(e.target.value)}
        placeholder="Describe what additional information is needed."
      />
    </Modal>
  );
}
