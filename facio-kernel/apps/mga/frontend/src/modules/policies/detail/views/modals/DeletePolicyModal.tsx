import React from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';

interface DeletePolicyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

export function DeletePolicyModal({
    isOpen,
    onClose,
    onConfirm,
}: DeletePolicyModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Delete Policy?"
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
                        variant="danger"
                        size="md"
                        onClick={onConfirm}
                        className="bg-red-500 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-red-500/20 hover:bg-red-600 transition"
                    >
                        Delete Policy
                    </Button>
                </>
            }
        >
            <div className="p-4 text-center sm:text-left">
                <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10 mb-4">
                    <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                </div>
                <p className="text-slate-500 font-medium">
                    Are you sure you want to permanently delete this policy? This action cannot be undone and all associated data including uploaded files and questionnaires will be removed.
                </p>
            </div>
        </Modal>
    );
}
