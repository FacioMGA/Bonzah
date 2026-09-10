import { AnimatePresence, motion } from 'framer-motion';
import { WizardButton as Button } from '@/src/shared/ui';

type Props = {
  isOpen: boolean;
  unlockingForEdit: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function QuoteWizardEditWarningModal({ isOpen, unlockingForEdit, onCancel, onConfirm }: Props) {
  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <div className="flex items-center gap-3 text-amber-600 mb-4">
              <div className="p-2 bg-amber-100 rounded-full">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M6.938 4h10.124c1.48 0 2.404 1.602 1.664 2.884L13.664 16.94c-.74 1.282-2.588 1.282-3.328 0L5.274 6.884C4.534 5.602 5.458 4 6.938 4z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">Edit Quote Details?</h3>
            </div>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Changing your details may affect your <strong>calculated premium</strong>.
              <br /><br />
              If you proceed, this current quote will be recalculated based on your new information.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button variant="primary" onClick={onConfirm} disabled={unlockingForEdit}>
                {unlockingForEdit ? 'Preparing edit…' : 'Edit & Recalculate'}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
