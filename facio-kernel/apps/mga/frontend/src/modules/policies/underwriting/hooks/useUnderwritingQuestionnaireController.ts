import React from 'react';
import { policiesClient as api } from '../../api/policiesClient';
import { policyCrudApiClient } from '../../api/policyCrudApiClient';
import { vehicleApi, youngestAgeFromDrivers } from '@/src/products/motor/public';
import type { VehicleVariantOption } from '@/src/products/motor/public';
import { logger } from '@/src/shared/lib/logger';
import { formatMoneyUI, type CurrencyCode } from '@/src/shared/lib/format';
import { validateQuoteData, type NormalizedFieldError } from '../../services/public';
import { CountryName, ValidationRegistry } from '@facio/validation/frontend';
import type { LifecycleStageId } from '@facio/validation';
import { coerceMotorQuestionnaireFieldValue } from '@facio/products';

import type { PolicyRecord, PolicyStateSetter } from '../../model/policy';
import { normalizeAdditionalDrivers, type UnknownRecord } from '../model/questionnaireHelpers';
import { asRecord } from '@/src/shared/lib/record';
import { deepMergePlain } from '@/src/shared/lib/deepMerge';
import {
  applyVariantEnrichmentToQuoteData,
  persistSelectedVariantIdInQuoteData,
  readSelectedVariantId,
} from '../model/variantSelection';

type QuestionType = 'date' | 'boolean' | 'number' | 'currency' | 'textarea' | 'select' | 'multiselect' | 'text' | 'percentage' | 'list';

function setAtPath(source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.').filter(Boolean);
  if (parts.length <= 1) return { ...source, [path]: value };
  const next: Record<string, unknown> = { ...source };
  let cursor = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    const existing = cursor[part];
    const child = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    cursor[part] = child;
    cursor = child;
  });
  return next;
}

function flattenChangedFields(value: unknown, prefix = ''): Array<[string, unknown]> {
  const record = asRecord(value);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(record).length === 0) {
    return prefix ? [[prefix, value]] : [];
  }
  return Object.entries(record).flatMap(([key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    return flattenChangedFields(child, nextKey);
  });
}

function validateChangedFieldAtoms(dirtyFields: Record<string, unknown>): Array<[string, NormalizedFieldError]> {
  return flattenChangedFields(dirtyFields).flatMap(([key, value]) => {
    if (!key.toLowerCase().includes('country')) return [];
    const text = String(value ?? '').trim();
    if (!text) return [];
    const parsed = CountryName.safeParse(text);
    if (parsed.success) return [];
    return [[key, { message: parsed.error.issues[0]?.message || 'Please select a valid country', severity: 'error' }]];
  });
}

function asCurrencyCode(value: unknown): CurrencyCode | undefined {
  const code = String(value || '').trim().toUpperCase();
  return code === 'USD' || code === 'GBP' || code === 'EUR' ? code : undefined;
}

type Args = {
  selectedPortfolio: PolicyRecord | null;
  productType: string;
  quoteData: Record<string, unknown>;
  underwritingStage: LifecycleStageId;
  selectedProgramId: string;
  editMode: 'preBind' | 'readOnly' | 'endorsementDraft';
  endorsementDraftRiskTransactionId?: string | null;
  inlineEditEnabled: boolean;
  setSelectedPortfolio: PolicyStateSetter;
  loadPolicyDetails: () => Promise<void>;
  loadPolicies: () => Promise<void>;
  setToastMessage: (message: string) => void;
  setShowToast: (show: boolean) => void;
  setIsEditing: (editing: boolean) => void;
  refreshIssueReadiness: () => Promise<void>;
};

export function useUnderwritingQuestionnaireController(args: Args) {
  const {
    selectedPortfolio,
    productType,
    quoteData,
    underwritingStage,
    selectedProgramId,
    editMode,
    endorsementDraftRiskTransactionId,
    inlineEditEnabled,
    setSelectedPortfolio,
    loadPolicyDetails,
    loadPolicies,
    setToastMessage,
    setShowToast,
    setIsEditing,
    refreshIssueReadiness,
  } = args;

  const [isSavingChanges, setIsSavingChanges] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveErrorEntries, setSaveErrorEntries] = React.useState<Array<{ field: string; message: string; label?: string }>>([]);
  const [dirtyFields, setDirtyFields] = React.useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [makeOptions, setMakeOptions] = React.useState<Array<{ value: string; label: string }>>([]);
  const [modelOptions, setModelOptions] = React.useState<Array<{ value: string; label: string }>>([]);
  const [makeOptionsLoading, setMakeOptionsLoading] = React.useState(false);
  const [modelOptionsLoading, setModelOptionsLoading] = React.useState(false);
  const [variantOptions, setVariantOptions] = React.useState<VehicleVariantOption[]>([]);
  const [variantOptionsLoading, setVariantOptionsLoading] = React.useState(false);
  const [activeVariantId, setActiveVariantId] = React.useState('');
  const dirtyFieldsRef = React.useRef(dirtyFields);
  const quoteDataRef = React.useRef(quoteData);
  const fieldDisabled = isSavingChanges || !inlineEditEnabled;
  const currencyCode = asCurrencyCode(
    asRecord(selectedPortfolio).currency
    || quoteData.currency
    || asRecord(asRecord(selectedPortfolio).product).currency
  ) ?? 'EUR';
  const activeMake = String(dirtyFields.make ?? quoteData.make ?? '').trim();
  const activeModel = String(dirtyFields.model ?? quoteData.model ?? '').trim();
  const activeYear = Number(dirtyFields.year ?? quoteData.year ?? 0);
  const persistedVariantId = React.useMemo(() => {
    const dirtyPersisted = readSelectedVariantId(dirtyFields);
    if (dirtyPersisted) return dirtyPersisted;
    return readSelectedVariantId(quoteData);
  }, [dirtyFields, quoteData]);

  React.useEffect(() => {
    dirtyFieldsRef.current = dirtyFields;
  }, [dirtyFields]);

  React.useEffect(() => {
    quoteDataRef.current = quoteData;
  }, [quoteData]);

  React.useEffect(() => {
    const controller = new AbortController();
    const loadMakes = async () => {
      if (productType !== 'MOTOR') { setMakeOptions([]); return; }
      setMakeOptionsLoading(true);
      try {
        const options = await vehicleApi.getAllMakeOptions({ signal: controller.signal });
        setMakeOptions(options);
      } finally {
        setMakeOptionsLoading(false);
      }
    };
    void loadMakes();
    return () => controller.abort();
  }, [productType]);

  React.useEffect(() => {
    const controller = new AbortController();
    const loadModels = async () => {
      if (!activeMake) {
        setModelOptions([]);
        return;
      }
      setModelOptionsLoading(true);
      try {
        const options = await vehicleApi.getModelOptionsForMake(activeMake, { signal: controller.signal });
        setModelOptions(options);
      } finally {
        setModelOptionsLoading(false);
      }
    };
    void loadModels();
    return () => controller.abort();
  }, [activeMake]);

  React.useEffect(() => {
    const controller = new AbortController();
    const loadVariants = async () => {
      if (!activeMake || !activeModel || !activeYear || activeYear < 1970 || activeYear > new Date().getFullYear() + 1) {
        setVariantOptions([]);
        setActiveVariantId('');
        return;
      }
      setVariantOptionsLoading(true);
      try {
        const options = await vehicleApi.getVariantOptions(
          { make: activeMake, model: activeModel, year: activeYear },
          { signal: controller.signal }
        );
        setVariantOptions(options);
      } catch {
        setVariantOptions([]);
      } finally {
        setVariantOptionsLoading(false);
      }
    };
    void loadVariants();
    return () => controller.abort();
  }, [activeMake, activeModel, activeYear]);
  React.useEffect(() => {
    if (!persistedVariantId) return;
    if (activeVariantId === persistedVariantId) return;
    setActiveVariantId(persistedVariantId);
  }, [activeVariantId, persistedVariantId]);
  React.useEffect(() => {
    if (variantOptionsLoading) return;
    if (!activeVariantId) return;
    if (variantOptions.some((option) => String(option.variantId || '').trim() === activeVariantId)) return;
    setActiveVariantId('');
  }, [activeVariantId, variantOptions, variantOptionsLoading]);

  const updateQuestionField = React.useCallback((key: string, type: QuestionType | undefined, rawValue: unknown) => {
    if (key === 'additionalDrivers') {
      const normalizedDrivers = normalizeAdditionalDrivers(rawValue);
      const hasDrivers = normalizedDrivers.length > 0;
      const youngest = youngestAgeFromDrivers(normalizedDrivers);
      const nextDirty = {
        ...dirtyFieldsRef.current,
        additionalDrivers: normalizedDrivers,
        hasAdditionalDrivers: hasDrivers,
        youngestDriverAge: youngest ?? '',
      };
      dirtyFieldsRef.current = nextDirty;
      setDirtyFields(nextDirty);
      setSelectedPortfolio((prev) => {
        const p = asRecord(prev);
        const qd = asRecord(p.quoteData);
        return {
          ...(prev || {}),
          quoteData: {
            ...qd,
            additionalDrivers: normalizedDrivers,
            hasAdditionalDrivers: hasDrivers,
            youngestDriverAge: youngest ?? '',
          },
        };
      });
      return;
    }

    let normalized: unknown = rawValue;
    if (type === 'boolean') {
      const raw = String(rawValue ?? '').trim().toLowerCase();
      if (!raw) normalized = '';
      else normalized = rawValue === true || raw === 'true';
    } else if (type === 'number' || type === 'currency') {
      const text = String(rawValue ?? '').trim();
      const parsed = Number(text);
      normalized = text && Number.isFinite(parsed) ? parsed : '';
    } else if (type === 'list') {
      normalized = Array.isArray(rawValue) ? structuredClone(rawValue) : [];
    } else if (type === 'multiselect') {
      normalized = Array.isArray(rawValue) ? rawValue.map((v) => String(v || '')).filter(Boolean) : [];
    } else {
      normalized = String(rawValue ?? '');
    }
    normalized = coerceMotorQuestionnaireFieldValue(key, normalized);
    const shouldResetVariantSelection = key === 'make' || key === 'model' || key === 'year';
    const baseDirty = shouldResetVariantSelection
      ? persistSelectedVariantIdInQuoteData(dirtyFieldsRef.current, '')
      : dirtyFieldsRef.current;
    // ABY-232 / ADR-0025: when `driverRestriction` moves away from
    // `NAMED_DRIVERS`, the named-drivers list and downstream
    // other-drivers fields must be cleared so pricing, documents and
    // claims read one consistent coverage basis. The wizard performs
    // the same cascade — BO mirrors it.
    const isDriverRestrictionCascadeClear =
      key === 'driverRestriction'
      && typeof normalized === 'string'
      && normalized !== 'NAMED_DRIVERS'
      && normalized !== '';
    const nextDirty = key === 'hasAdditionalDrivers' && normalized === false
      ? {
          ...baseDirty,
          hasAdditionalDrivers: false,
          additionalDrivers: [],
          youngestDriverAge: '',
        }
      : isDriverRestrictionCascadeClear
        ? {
            ...baseDirty,
            driverRestriction: normalized,
            hasAdditionalDrivers: false,
            additionalDrivers: [],
            youngestDriverAge: '',
            otherDriversClaims: false,
            otherDriversClaimsDetails: '',
            otherDriversConvictions: false,
            otherDriversConvictionsDetails: '',
          }
        : setAtPath(baseDirty, key, normalized);
    dirtyFieldsRef.current = nextDirty;
    setDirtyFields(nextDirty);
    setSelectedPortfolio((prev) => {
      const p = asRecord(prev);
      const qd = asRecord(p.quoteData);
      const nextQuoteDataBase = shouldResetVariantSelection ? persistSelectedVariantIdInQuoteData(qd, '') : qd;
      if (key === 'hasAdditionalDrivers' && normalized === false) {
        return {
          ...(prev || {}),
          quoteData: {
            ...nextQuoteDataBase,
            hasAdditionalDrivers: false,
            additionalDrivers: [],
            youngestDriverAge: '',
          },
        };
      }
      if (isDriverRestrictionCascadeClear) {
        return {
          ...(prev || {}),
          quoteData: {
            ...nextQuoteDataBase,
            driverRestriction: normalized,
            hasAdditionalDrivers: false,
            additionalDrivers: [],
            youngestDriverAge: '',
            otherDriversClaims: false,
            otherDriversClaimsDetails: '',
            otherDriversConvictions: false,
            otherDriversConvictionsDetails: '',
          },
        };
      }
      const nextQuoteData = setAtPath(nextQuoteDataBase, key, normalized);
      return {
        ...(prev || {}),
        quoteData: nextQuoteData,
      };
    });
    if (shouldResetVariantSelection) setActiveVariantId('');
  }, [setSelectedPortfolio]);

  const mapValidationMessages = (errors: Record<string, NormalizedFieldError>): Record<string, string> => {
    return Object.fromEntries(
      Object.entries(errors).map(([key, value]) => [key, value.message])
    );
  };

  const runQuoteValidation = React.useCallback((
    data: Record<string, unknown>,
    mode: 'blur' | 'save' | 'submit',
    focusField?: string
  ) => {
    const boValidation = validateQuoteData({
      data,
      productType: String(selectedPortfolio?.productType || ''),
      actor: 'underwriter',
      stage: underwritingStage === 'issuance' ? 'issue' : underwritingStage,
      mode,
      programId: String(selectedProgramId || ''),
      focusField,
    });

    return boValidation;
  }, [selectedPortfolio?.productType, selectedProgramId, underwritingStage]);

  const validateFieldOnBlur = React.useCallback((fieldPath: string) => {
    const key = String(fieldPath || '').trim();
    if (!key) return;
    const nextQuoteData: Record<string, unknown> = deepMergePlain(quoteDataRef.current, dirtyFieldsRef.current);
    const validation = runQuoteValidation(nextQuoteData, 'blur', key);
    const allErrors = mapValidationMessages(validation.fieldErrors);
    const nextFieldErrors: Record<string, string> = {};
    if (allErrors[key]) nextFieldErrors[key] = allErrors[key];

    if (key === 'hasAdditionalDrivers' && allErrors.additionalDrivers) {
      nextFieldErrors.additionalDrivers = allErrors.additionalDrivers;
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      if (key === 'hasAdditionalDrivers') delete next.additionalDrivers;
      for (const [k, message] of Object.entries(nextFieldErrors)) next[k] = message;
      return next;
    });
  }, [runQuoteValidation]);

  const saveUnderwritingChanges = React.useCallback(async (opts?: { exitEditMode?: boolean }) => {
    if (!selectedPortfolio?.id) return { success: false as const };
    const changedFieldKeys = Object.keys(dirtyFields || {});
    const currentQuoteData: Record<string, unknown> = deepMergePlain(quoteData, dirtyFields);
    const validation = runQuoteValidation(currentQuoteData, 'save');
    const isRelatedToChangedFields = (errorKey: string) => {
      const topLevel = String(errorKey || '').split('.')[0];
      if (changedFieldKeys.includes(topLevel)) return true;
      if (topLevel === 'additionalDrivers' && changedFieldKeys.includes('hasAdditionalDrivers')) return true;
      if (topLevel === 'youngestDriverAge' && changedFieldKeys.includes('additionalDrivers')) return true;
      return false;
    };
    const allBlockingErrors = [
      ...Object.entries(validation.fieldErrors as Record<string, NormalizedFieldError>),
      ...validateChangedFieldAtoms(dirtyFields),
    ]
      .filter(([key, err]) => err.severity === 'error' && isRelatedToChangedFields(key));
    if (allBlockingErrors.length > 0) {
      const displayErrors = Object.fromEntries(allBlockingErrors.map(([key, err]) => [key, err.message]));
      setFieldErrors((prev) => ({ ...prev, ...displayErrors }));
      const saveProductType = String(productType || selectedPortfolio?.productType || '').toUpperCase();
      const validationProfile = ValidationRegistry.get(saveProductType);
      const entries = allBlockingErrors.map(([field, err]) => ({
        field,
        message: err.message,
        label: validationProfile?.fields[field]?.label,
      }));
      setSaveErrorEntries(entries);
      setSaveError('Please fix validation errors before saving.');
      const firstField = String(entries[0]?.field ?? '');
      if (firstField && typeof document !== 'undefined') {
        setTimeout(() => {
          const el =
            document.getElementById(`uw-field-${firstField}`) ??
            document.getElementById(`uw-field-${firstField.split('.')[0]}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
      return { success: false as const, nextQuoteData: currentQuoteData };
    }
    if (!changedFieldKeys.length) {
      setToastMessage('No underwriting changes to save.');
      setShowToast(true);
      if (opts?.exitEditMode) setIsEditing(false);
      return { success: false as const };
    }
    const nextQuoteData: Record<string, unknown> = deepMergePlain(quoteData, dirtyFields);
    setSaveError(null);
    setSaveErrorEntries([]);
    setIsSavingChanges(true);
    try {
      const changedFields = changedFieldKeys.map((fieldKey) => ({
        fieldKey,
        before: quoteData[fieldKey],
        after: nextQuoteData[fieldKey],
      }));
      const resp = await api.submitUWForm(String(selectedPortfolio.id), {
        quoteDataUpdates: nextQuoteData,
        riskTransactionId: editMode === 'endorsementDraft' ? String(endorsementDraftRiskTransactionId || '') : undefined,
        changedFields,
        endorsementMeta: editMode === 'endorsementDraft' ? { changeType: 'UW_UNIFIED_UPDATE' } : undefined,
      });
      if (!resp?.success) throw new Error(resp?.error?.message || 'Failed to save underwriting changes');
      await loadPolicyDetails();
      await refreshIssueReadiness();
      await loadPolicies();
      setDirtyFields({});
      setFieldErrors({});
      setSaveErrorEntries([]);
      setToastMessage('Underwriting updates saved.');
      setShowToast(true);
      if (opts?.exitEditMode) setIsEditing(false);
      // Trigger one-time coverage-selection initialisation using the backend MBE engine.
      // The endpoint is idempotent: it no-ops if already initialised, preserving UW opt-outs.
      void policyCrudApiClient.initCoverageSelection(String(selectedPortfolio.id)).catch(() => {
        // best-effort; coverage defaults will apply on next UW save
      });
      return { success: true as const, nextQuoteData };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save underwriting updates';
      setSaveError(message);
      setToastMessage(message);
      setShowToast(true);
      return { success: false as const, nextQuoteData };
    } finally {
      setIsSavingChanges(false);
    }
  }, [
    dirtyFields,
    editMode,
    endorsementDraftRiskTransactionId,
    loadPolicies,
    loadPolicyDetails,
    productType,
    quoteData,
    refreshIssueReadiness,
    runQuoteValidation,
    selectedPortfolio?.id,
    selectedPortfolio?.productType,
    setIsEditing,
    setShowToast,
    setToastMessage,
  ]);

  const formatCurrencyDisplay = React.useCallback((value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return formatMoneyUI(n, currencyCode);
  }, [currencyCode]);
  const formatCurrencyInputValue = React.useCallback((value: unknown): string => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return formatMoneyUI(n, currencyCode).replace(/^[^\d-]+/, '');
  }, [currencyCode]);

  const selectVariant = React.useCallback(async (variantId: string) => {
    setActiveVariantId(variantId);
    if (!variantId) {
      setDirtyFields((prev) => persistSelectedVariantIdInQuoteData(prev, ''));
      setSelectedPortfolio((prev) => {
        const p = asRecord(prev);
        const qd = asRecord(p.quoteData);
        return { ...(prev || {}), quoteData: persistSelectedVariantIdInQuoteData(qd, '') };
      });
      return;
    }
    try {
      const enrichment = await vehicleApi.getVariantEnrichment(variantId);
      setDirtyFields((prev) => applyVariantEnrichmentToQuoteData({ source: prev, variantId, enrichment }));
      setSelectedPortfolio((prev) => {
        const p = asRecord(prev);
        const qd = asRecord(p.quoteData);
        return { ...(prev || {}), quoteData: applyVariantEnrichmentToQuoteData({ source: qd, variantId, enrichment }) };
      });
    } catch (err) {
      logger.error({ err }, 'Failed to apply vehicle variant enrichment');
    }
  }, [setSelectedPortfolio]);
  const resetEditingDraft = React.useCallback(() => {
    setDirtyFields({});
    setFieldErrors({});
    setSaveError(null);
    setSaveErrorEntries([]);
    setActiveVariantId('');
    setVariantOptions([]);
  }, []);

  const removeFollowUpRequest = React.useCallback((index: number, uwAnswers: UnknownRecord, setUwAnswers: (next: UnknownRecord) => void) => {
    const updatedRequests = (Array.isArray(uwAnswers.followUpRequests) ? uwAnswers.followUpRequests : []).filter((_, idx) => idx !== index);
    const updatedAnswers = { ...uwAnswers, followUpRequests: updatedRequests };
    setUwAnswers(updatedAnswers);
    const policyId = String(selectedPortfolio?.id || '').trim();
    if (!policyId) return;
    api.submitUWForm(policyId, updatedAnswers).catch((err) => {
      logger.error({ err }, 'Failed to persist follow-up request deletion');
    });
  }, [selectedPortfolio?.id]);

  const variantSelectOptions = React.useMemo(
    () => variantOptions.map((v) => ({ value: v.variantId, label: v.label })),
    [variantOptions]
  );

  return {
    isSavingChanges,
    saveError,
    saveErrorEntries,
    dirtyFields,
    setDirtyFields,
    fieldErrors,
    setFieldErrors,
    makeOptions,
    modelOptions,
    makeOptionsLoading,
    modelOptionsLoading,
    activeMake,
    variantSelectOptions,
    variantOptionsLoading,
    activeVariantId,
    selectVariant,
    fieldDisabled,
    updateQuestionField,
    saveUnderwritingChanges,
    validateFieldOnBlur,
    formatCurrencyDisplay,
    formatCurrencyInputValue,
    resetEditingDraft,
    removeFollowUpRequest,
  };
}
