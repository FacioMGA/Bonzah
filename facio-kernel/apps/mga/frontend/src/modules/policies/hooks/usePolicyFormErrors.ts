import { useState, useCallback } from 'react';
import {
    validatePolicyField,
    validatePolicyHolderAllFields,
    mapServerValidationDetails,
} from '../model/policyPageHelpers';

type UnknownRecord = Record<string, unknown>;

/**
 * Manages form-level validation error state for the policy page.
 *
 * Wraps the `formErrors` state with domain-aware helpers that delegate
 * to policyPageHelpers for actual validation rules.
 */
export function usePolicyFormErrors() {
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    const validateField = useCallback((field: string, value: string, portfolio: unknown) => {
        setFormErrors((prev) => validatePolicyField(field, value, portfolio, prev));
    }, []);

    const validatePolicyHolderAll = useCallback((portfolio: UnknownRecord) => {
        const errors = validatePolicyHolderAllFields(portfolio);
        setFormErrors(errors);
        return errors;
    }, []);

    const clearFieldError = useCallback((field: string) => {
        setFormErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
        });
    }, []);

    const setFieldError = useCallback((field: string, message: string) => {
        setFormErrors((prev) => ({ ...prev, [field]: message }));
    }, []);

    const mapServerValidationToFieldErrors = useCallback((details: unknown): boolean => {
        const mapped = mapServerValidationDetails(details);
        if (!Object.keys(mapped).length) return false;
        setFormErrors((prev) => ({ ...prev, ...mapped }));
        return true;
    }, []);

    return {
        formErrors,
        validateField,
        validatePolicyHolderAll,
        clearFieldError,
        setFieldError,
        mapServerValidationToFieldErrors,
    };
}
