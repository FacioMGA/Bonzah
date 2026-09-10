import { useState, useCallback } from 'react';

export type PolicyToastType = 'success' | 'error' | 'info';

/**
 * Simple toast state hook.
 *
 * Encapsulates `showToast`, `toastMessage`, and `toastType` so callers
 * can `toast('message', 'error')` instead of juggling three setters.
 *
 * The `toastType` is forwarded to the `<Toast />` UI primitive so failure
 * messages render in the error styling — without this, lifecycle
 * failures (bind / send-quote / save-version) used to render with the
 * green success treatment, which contributed to the "system lying"
 * impression reported in ABY-88 ("bind failed but no visible blocker").
 */
export function usePolicyToast() {
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [toastType, setToastType] = useState<PolicyToastType>('success');

    const toast = useCallback((message: string, type: PolicyToastType = 'success') => {
        setToastMessage(message);
        setToastType(type);
        setShowToast(true);
    }, []);

    const dismissToast = useCallback(() => {
        setShowToast(false);
    }, []);

    return {
        showToast,
        toastMessage,
        toastType,
        toast,
        dismissToast,
        // Backwards-compatible setters for hooks that take individual setters
        setShowToast,
        setToastMessage,
        setToastType,
    };
}
