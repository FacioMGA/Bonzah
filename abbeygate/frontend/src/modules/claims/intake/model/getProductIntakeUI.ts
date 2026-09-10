import { motorFieldRegistry } from '../motor/motorFieldRegistry';
import type { ProductIntakeUI } from './types';

const INTAKE_REGISTRIES: Record<string, ProductIntakeUI> = {
  MOTOR: motorFieldRegistry,
  OWN_DAMAGE: motorFieldRegistry,
  THIRD_PARTY: motorFieldRegistry,
};

export function getProductIntakeUI(productCode?: string): ProductIntakeUI | null {
  const normalized = String(productCode || '').trim().toUpperCase();
  return INTAKE_REGISTRIES[normalized] ?? null;
}
