import { boApiClient } from '@/src/shared/api/boApiClient';
import { mapBinderDetailBundle } from '../model/binderMappers';
import type { BinderDetailBundle } from '../model/readModels';

export async function getBinderDetail(binderId: string): Promise<BinderDetailBundle> {
  const response = await boApiClient.getBinder(binderId);
  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to load binder detail');
  }
  const bundle = mapBinderDetailBundle(response);
  if (!bundle) throw new Error('Binder detail payload is invalid');
  return bundle;
}
