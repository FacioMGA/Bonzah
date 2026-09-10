import { describe, expect, it } from 'vitest';
import { buildProductCatalog } from '../catalog.js';

describe('product runtime definitions', () => {
  it('exposes governed runtime definitions for all registered products', () => {
    const byType = new Map(buildProductCatalog().map((adapter) => [adapter.productType, adapter]));

    const motor = byType.get('MOTOR')?.getRuntimeDefinition();
    const home = byType.get('HOME')?.getRuntimeDefinition();
    const travel = byType.get('TRAVEL')?.getRuntimeDefinition();

    expect(motor?.executionMode).toBe('plugin');
    expect(motor?.intake.validationMode).toBe('product_schema');
    expect(motor?.rating.mode).toBe('plugin');

    expect(home?.executionMode).toBe('runtime_config');
    expect(home?.intake.publicSessionSlug).toBe('home');
    expect(home?.rating.mode).toBe('table_assets');

    expect(travel?.executionMode).toBe('runtime_config');
    expect(travel?.intake.publicSessionSlug).toBe('travel');
    expect(travel?.rating.mode).toBe('table_assets');
  });
});
