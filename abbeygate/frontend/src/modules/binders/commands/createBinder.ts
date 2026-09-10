import { boApiClient } from '@/src/shared/api/boApiClient';
import type { BinderConfig } from '../model/binderTypes';

export type CreateBinderInput = {
  coverholderName?: string;
  agreementNumber?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  config: BinderConfig;
};

function hasStringId(value: unknown): value is { id: string } {
  return Boolean(
    value
      && typeof value === 'object'
      && 'id' in value
      && typeof (value as { id?: unknown }).id === 'string',
  );
}

export async function createBinder(input: CreateBinderInput): Promise<string> {
  const response = await boApiClient.createBinder(input);
  if (!response.success) {
    const details = response.error?.details;
    if (details && typeof details === 'object') {
      throw new Error(`${response.error?.message || 'Failed to create binder'}: ${JSON.stringify(details)}`);
    }
    throw new Error(response.error?.message || 'Failed to create binder');
  }
  const id = hasStringId(response.data) ? response.data.id.trim() : '';
  if (!id) throw new Error('Create binder response missing id');
  return id;
}
