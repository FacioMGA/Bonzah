import React from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';
import { IssuingDocumentsIllustration } from '../../../illustrations/views/IssuingDocumentsIllustration';

const dotStyle = (delay: string): React.CSSProperties => ({
    animation: 'policyDotPulse 1.2s infinite',
    animationDelay: delay,
});

interface BindEndorsementWorkflowModalProps {
    isOpen: boolean;
    onClose: () => void;
    isIssuingEndorsement: boolean;
    isBindingEndorsementDraft: boolean;
    isCancellationDraft: boolean;
    onBindDraft: () => Promise<void>;
    onIssueEndorsement: () => void;
}

export function BindEndorsementWorkflowModal({
    isOpen,
    onClose,
    isIssuingEndorsement,
    isBindingEndorsementDraft,
    isCancellationDraft,
    onBindDraft,
    onIssueEndorsement,
}: BindEndorsementWorkflowModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isCancellationDraft ? 'Bind cancellation' : 'Bind endorsement'}
            actions={
                isIssuingEndorsement ? (
                    <>
                        <Button
                            type="button"
                            variant="primary"
                            size="md"
                            className="bg-brand-primary/90 text-white px-8 py-3 rounded-xl font-black shadow-lg cursor-wait opacity-90"
                            disabled
                        >
                            Issuing endorsement
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            type="button"
                            variant="ghost"
                            size="md"
                            onClick={onClose}
                            className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
                        >
                            Close
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="md"
                            onClick={async () => {
                                await onBindDraft();
                                onClose();
                            }}
                            className="px-8 py-3 rounded-xl font-black border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                            disabled={isBindingEndorsementDraft || isIssuingEndorsement}
                        >
                            {isBindingEndorsementDraft ? 'Binding…' : 'Bind draft'}
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="md"
                            onClick={onIssueEndorsement}
                            className={`${isCancellationDraft ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-primary hover:bg-brand-secondary'} text-white px-8 py-3 rounded-xl font-black shadow-lg transition disabled:opacity-60 disabled:cursor-not-allowed`}
                            disabled={isIssuingEndorsement || isBindingEndorsementDraft}
                        >
                            {isCancellationDraft ? 'Bind cancellation' : 'Issue endorsement'}
                        </Button>
                    </>
                )
            }
        >
            {isIssuingEndorsement ? (
                <div className="p-4">
                    <div className="mx-auto max-w-contentNarrow">
                        <div className="rounded-2xl overflow-hidden ring-1 ring-slate-200/70 bg-white shadow-sm">
                            <IssuingDocumentsIllustration className="w-full h-auto" />
                        </div>
                        <div className="mt-4 text-center">
                            <div className="text-slate-900 font-black text-lg tracking-tight">Minting the endorsement pack</div>
                            <div className="mt-1 text-sm text-slate-600 font-medium">Freezing the endorsement snapshot and sealing the smart policy.</div>
                        </div>
                        <div className="mt-4 flex items-center justify-center gap-2 text-xs font-black tracking-widest uppercase text-slate-500">
                            <span className="inline-flex items-center gap-1.5">
                                Document factory online
                                <span className="inline-flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/80" style={dotStyle('0ms')} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" style={dotStyle('150ms')} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500/40" style={dotStyle('300ms')} />
                                </span>
                            </span>
                        </div>
                        <style>{`
              @keyframes policyDotPulse {
                0%, 100% { transform: translateY(0); opacity: 0.55; }
                50% { transform: translateY(-3px); opacity: 1; }
              }
            `}</style>
                    </div>
                </div>
            ) : (
                <div className="p-4 text-center sm:text-left space-y-3">
                    {isCancellationDraft ? (
                        <>
                            <p className="text-slate-700 font-medium">
                                This will issue a cancellation endorsement and create a billing credit.
                            </p>
                            <p className="text-xs text-slate-500">
                                Refund is manual in Billing. Continue only if you want to finalize this cancellation now.
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-slate-600 font-medium">
                                You're about to bind an endorsement. Would you like to bind it as a draft, or issue it now and generate the endorsement documents?
                            </p>
                            <p className="text-xs text-slate-500">
                                Issuing will generate the endorsement pack against this endorsement version and make it available under Documents.
                            </p>
                        </>
                    )}
                </div>
            )}
        </Modal>
    );
}
