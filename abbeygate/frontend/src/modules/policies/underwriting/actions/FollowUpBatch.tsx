import React from 'react';
import { Button } from '@/src/shared/ui';
import type { PolicyFollowUpItem } from '../../model/policy';

type FollowUpBatchProps = {
  followUpEnabled: boolean;
  lockQuestionnaireOps: boolean;
  requests: PolicyFollowUpItem[];
  showBatchModal: boolean;
  onOpenBatchModal: () => void;
  onCloseBatchModal: () => void;
  onSendBatch: () => void;
  onRemoveRequest: (index: number) => void;
};

export function FollowUpBatch(props: FollowUpBatchProps) {
  const {
    followUpEnabled,
    lockQuestionnaireOps,
    requests,
    showBatchModal,
    onOpenBatchModal,
    onCloseBatchModal,
    onSendBatch,
    onRemoveRequest,
  } = props;

  if (lockQuestionnaireOps || !followUpEnabled) return null;
  return (
    <>
      {requests.length > 0 && (
        <div className="fixed bottom-8 right-8 z-40 animate-in slide-in-from-bottom-10 duration-500">
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={onOpenBatchModal}
            className="bg-slate-900 hover:bg-black text-white px-8 py-4 rounded-full font-bold shadow-2xl flex items-center space-x-4 border-2 border-slate-800 hover:border-slate-700 transition-all transform hover:-translate-y-1"
          >
            <div className="relative">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              <span className="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold border-2 border-slate-900">{requests.length}</span>
            </div>
            <span className="uppercase tracking-widest text-sm">Your Batch</span>
          </Button>
        </div>
      )}

      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl m-4 animate-in zoom-in-95 duration-200">
            <div className="bg-slate-50 p-6 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight">Review Follow-up Batch</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Ready to send to client</p>
              </div>
              <Button type="button" variant="link" size="none" onClick={onCloseBatchModal} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>

            <div className="p-6 max-h-panel overflow-y-auto space-y-4 bg-slate-50/50">
              {requests.map((req, i) => (
                <div key={i} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-4">
                  <div className="bg-amber-100 text-amber-600 w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <h5 className="font-bold text-slate-800 text-sm">{String(req.question || '')}</h5>
                    <p className="text-slate-500 text-sm mt-1 leading-relaxed">"{String(req.note || '')}"</p>
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mt-2">
                      Linked field: {String(req.fieldKey || 'n/a')} • {String(req.type || 'Ask for more detail')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveRequest(i)}
                    className="text-slate-300 hover:text-red-500 bg-transparent !p-0"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </Button>
                </div>
              ))}
            </div>

            <div className="p-6 bg-white border-t border-slate-100 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={onCloseBatchModal}
                className="font-bold text-slate-400 hover:text-slate-600 px-4 bg-transparent"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={onSendBatch}
                className="bg-slate-900 hover:bg-black text-white px-8 py-3 rounded-xl font-bold shadow-lg flex items-center space-x-2 transition-all"
              >
                <span>Send Request via Email</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
