import { boApiClient } from '@/src/shared/api/boApiClient';
import { mapBinderUsageSummary } from '../model/binderMappers';
import type { BinderUsageSummary } from '../model/readModels';

export async function getBinderUsage(binderId: string): Promise<BinderUsageSummary> {
  const response = await boApiClient.getBinderUsage(binderId);
  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to load binder usage');
  }
  return mapBinderUsageSummary(response);
}
