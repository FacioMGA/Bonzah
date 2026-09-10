import { boApiClient } from '@/src/shared/api/boApiClient';
import type { BinderConfig } from '../model/binderTypes';

export type UpdateBinderInput = {
  coverholderName?: string;
  agreementNumber?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  config: BinderConfig;
};

export async function updateBinder(binderId: string, input: UpdateBinderInput): Promise<void> {
  const response = await boApiClient.updateBinder(binderId, input);
  if (!response.success) {
    const details = response.error?.details;
    if (details && typeof details === 'object') {
      throw new Error(`${response.error?.message || 'Failed to update binder'}: ${JSON.stringify(details)}`);
    }
    throw new Error(response.error?.message || 'Failed to update binder');
  }
}
