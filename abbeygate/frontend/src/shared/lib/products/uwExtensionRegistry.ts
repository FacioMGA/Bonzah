import type { ComponentType } from 'react';

export type UwSelectOption = {
  value: string;
  label: string;
};

export type UwOptionsContext = {
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
};

export type UwDynamicOptions = {
  optionsForFieldKey?: (fieldKey: string, ctx: UwOptionsContext) => UwSelectOption[];
  loadingForFieldKey?: (fieldKey: string, ctx: UwOptionsContext) => boolean;
};

export type UwFieldUpdateContext = {
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
};

export type UwFieldUpdateResult = {
  dirtyFields: Record<string, unknown>;
  quoteData?: Record<string, unknown>;
};

export type UwReplacementContext = {
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
};

export type UwFieldExtrasProps = {
  fieldKey: string;
  quoteData: Record<string, unknown>;
  dirtyFields: Record<string, unknown>;
  disabled: boolean;
  onFieldUpdate: (fieldKey: string, rawValue: unknown) => void;
};

export type UwExtension = {
  productType: string;
  dynamicOptions?: UwDynamicOptions;
  onFieldUpdate?: (
    fieldKey: string,
    rawValue: unknown,
    ctx: UwFieldUpdateContext
  ) => UwFieldUpdateResult | null;
  hasReplacement?: (fieldKey: string, ctx: UwReplacementContext) => boolean;
  renderFieldExtras?: ComponentType<UwFieldExtrasProps>;
  triggerExplanation?: (code: string) => string | null;
};

class UwExtensionRegistryImpl {
  private readonly extensions = new Map<string, UwExtension>();

  register(extension: UwExtension): void {
    const key = String(extension.productType || '').trim().toUpperCase();
    if (!key) {
      throw new Error('UwExtensionRegistry.register: extension.productType is required');
    }
    this.extensions.set(key, { ...extension, productType: key });
  }

  get(productType: string | null | undefined): UwExtension | null {
    const key = String(productType || '').trim().toUpperCase();
    if (!key) return null;
    return this.extensions.get(key) ?? null;
  }

  list(): UwExtension[] {
    return Array.from(this.extensions.values());
  }

  has(productType: string | null | undefined): boolean {
    const key = String(productType || '').trim().toUpperCase();
    return key ? this.extensions.has(key) : false;
  }
}

export const UwExtensionRegistry = new UwExtensionRegistryImpl();
