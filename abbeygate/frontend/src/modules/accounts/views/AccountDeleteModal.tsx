/**
 * AccountDeleteModal — Confirmation dialog for account deletion.
 */
import React from 'react';
import { Modal } from '@/src/shared/ui';
import { Button } from '@/src/shared/ui';

interface Props {
    isOpen: boolean;
    accountName?: string;
    onClose: () => void;
    onConfirm: () => void;
}

export function AccountDeleteModal({ isOpen, accountName, onClose, onConfirm }: Props) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Delete Account"
            actions={(
                <>
                    <Button
                        type="button"
                        variant="ghost"
                        size="md"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-bold text-sm transition-colors bg-transparent"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="danger"
                        size="md"
                        onClick={onConfirm}
                        className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-bold text-sm shadow-md shadow-red-500/20 transition-all"
                    >
                        Delete Account
                    </Button>
                </>
            )}
        >
            <div className="space-y-3">
                <p className="text-slate-600">
                    Are you sure you want to delete <span className="font-bold text-slate-900">{accountName}</span>?
                </p>
                <p className="text-sm text-slate-400">
                    This action cannot be undone. All associated data will be removed.
                </p>
            </div>
        </Modal>
    );
}
