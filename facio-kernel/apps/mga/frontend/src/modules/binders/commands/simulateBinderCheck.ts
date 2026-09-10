import { boApiClient } from '@/src/shared/api/boApiClient';
import { mapBinderSimulationResult } from '../model/binderMappers';
import type { BinderSimulationResult } from '../model/readModels';

export type SimulateBinderInput = {
  territory?: string;
  riskLocationCountry?: string;
  insuredDomicileCountry?: string;
  vehicleValue?: number;
};

export async function simulateBinderCheck(binderId: string, input: SimulateBinderInput): Promise<BinderSimulationResult> {
  const response = await boApiClient.simulateBinderCheck(binderId, input);
  if (!response.success) {
    throw new Error(response.error?.message || 'Simulation failed');
  }
  return mapBinderSimulationResult(response);
}
