import React, { useEffect } from 'react';
import { Button } from '@/src/shared/ui';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
  type?: 'success' | 'error' | 'info';
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose, type = 'success', duration = 3000 }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onClose]);

  if (!isVisible) return null;

  const bgColors = {
    success: 'bg-gray-900 border-l-4 border-brand-primary',
    error: 'bg-red-900 border-l-4 border-red-500',
    info: 'bg-blue-900 border-l-4 border-blue-500',
  };

  return (
    <div className={`fixed top-4 right-4 z-50 flex items-center p-4 rounded shadow-lg text-white ${bgColors[type]} transition-all duration-300 transform translate-y-0 opacity-100`}>
      <div className="flex-1 mr-4">
        {type === 'success' && (
          <span className="mr-2 text-emerald-300">
            <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        <span className="font-medium">{message}</span>
      </div>
      <Button onClick={onClose} variant="ghost" size="sm" className="text-gray-400 hover:text-white focus:outline-none p-1">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </Button>
    </div>
  );
};

export default Toast;
