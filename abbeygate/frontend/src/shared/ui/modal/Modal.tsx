import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/src/shared/ui';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: string;
  seamless?: boolean;
  allowOverflow?: boolean;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, actions, maxWidth = 'max-w-lg', seamless = false, allowOverflow = false }) => {
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>
      <div className="fixed inset-0 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full items-start justify-center p-2 sm:p-4 sm:items-center">
        <div className={`relative ${seamless ? 'bg-[#003366]' : 'bg-white'} rounded-xl sm:rounded-2xl border border-slate-200/70 shadow-[0_20px_60px_rgba(15,23,42,0.18)] w-full ${maxWidth} transform transition-all flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden`}>
        {!seamless && (
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/70">
            <h3 className="text-lg sm:text-xl font-bold text-slate-800">{title}</h3>
            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-full"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>
        )}

        {seamless && (
          <Button
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="absolute top-4 right-4 z-10 text-white/80 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        )}

          <div className={`flex-1 min-h-0 ${seamless ? 'p-0' : 'p-4 sm:p-6'} ${allowOverflow ? 'overflow-y-auto overflow-x-visible' : 'overflow-y-auto'}`}>
          {children}
        </div>

        {actions && (
          <div className="shrink-0 px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 bg-slate-50/70 flex items-stretch sm:items-center">
            {actions}
          </div>
        )}
        </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
