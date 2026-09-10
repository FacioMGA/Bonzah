import { boApiClient } from '@/src/shared/api/boApiClient';
import { mapBinderPublishResult } from '../model/binderMappers';
import type { BinderPublishResult } from '../model/readModels';

export async function publishBinder(binderId: string): Promise<BinderPublishResult> {
  const response = await boApiClient.publishBinder(binderId);
  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to publish binder');
  }
  return mapBinderPublishResult(response, binderId);
}
