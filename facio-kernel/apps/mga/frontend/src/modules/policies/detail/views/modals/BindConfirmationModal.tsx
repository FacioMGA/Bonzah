import React from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';

interface BindConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

export function BindConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
}: BindConfirmationModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Confirm Policy Binding"
            actions={
                <>
                    <Button
                        type="button"
                        variant="ghost"
                        size="md"
                        onClick={onClose}
                        className="px-6 py-3 text-slate-500 font-bold hover:bg-slate-100 rounded-xl transition bg-transparent"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={onConfirm}
                        className="bg-slate-900 text-white px-8 py-3 rounded-xl font-black shadow-lg hover:bg-black transition flex items-center"
                    >
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Confirm Bind
                    </Button>
                </>
            }
        >
            <div className="p-4 text-center sm:text-left">
                <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10 mb-4">
                    <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="text-lg font-medium leading-6 text-slate-900 mb-2">Legal Action Required</h3>
                <p className="text-slate-500 font-medium">
                    Are you sure you want to <strong>BIND</strong> this policy?
                    <br />
                    This is a binding legal action that will activate coverage for the selected portfolio.
                </p>
            </div>
        </Modal>
    );
}
