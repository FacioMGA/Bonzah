import { boApiClient } from '@/src/shared/api/boApiClient';
import { mapBinderIndexRows } from '../model/binderMappers';
import type { BinderIndexRow } from '../model/readModels';

export async function getBinderIndex(): Promise<BinderIndexRow[]> {
  const response = await boApiClient.listBinders();
  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to load binders');
  }
  return mapBinderIndexRows(response);
}
