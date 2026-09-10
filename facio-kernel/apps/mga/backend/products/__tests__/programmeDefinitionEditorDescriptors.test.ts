import { describe, expect, it } from 'vitest';
import { motorProductRuntimeDefinition } from '../motor/runtime.js';
import { homeProductRuntimeConfig } from '../home/runtime.js';
import { travelProductRuntimeConfig } from '../travel/runtime.js';
import { healthProductRuntimeConfig } from '../health/runtime.js';
import { businessProductRuntimeConfig } from '../business/runtime.js';
import { openMarketProductRuntimeConfig } from '../open-market/runtime.js';

describe('programme-definition editor descriptors', () => {
  it('makes every registered product supply its own versioned structural editor descriptor', () => {
    const runtimes = [
      motorProductRuntimeDefinition,
      homeProductRuntimeConfig,
      travelProductRuntimeConfig,
      healthProductRuntimeConfig,
      businessProductRuntimeConfig,
      openMarketProductRuntimeConfig,
    ];

    for (const runtime of runtimes) {
      const descriptor = runtime.programmeDefinitionEditor;
      expect(descriptor).toMatchObject({ schemaVersion: 1, productType: runtime.productType });
      expect(descriptor.pricingModes).not.toHaveLength(0);
      expect(new Set(descriptor.components.map((component) => component.key)).size).toBe(descriptor.components.length);
      expect(descriptor.components.map((component) => component.key)).toEqual([
        'underwriting', 'coverage', 'questionnaire', 'workflow', 'channels', 'documents',
      ]);
      expect(descriptor.components.every((component) => component.control)).toBe(true);
      expect(descriptor.components.find((component) => component.key === 'questionnaire')).toMatchObject({ control: 'questionnaire' });
      expect(descriptor.components.find((component) => component.key === 'workflow')).toMatchObject({ control: 'workflow' });
      expect(descriptor.components.find((component) => component.key === 'channels')).toMatchObject({ control: 'channels' });
      expect(descriptor.components.find((component) => component.key === 'coverage')).toMatchObject({ control: 'coverage' });
      expect(descriptor.components.find((component) => component.key === 'documents')).toMatchObject({ control: 'documents' });
      expect(runtime.rating?.assetRefs).toEqual([]);
    }
  });

  it('makes the Motor underwriting authoring form product-owned', () => {
    const underwriting = motorProductRuntimeDefinition.programmeDefinitionEditor.components
      .find((component) => component.key === 'underwriting');
    expect(underwriting).toMatchObject({ control: 'motor-underwriting' });
  });

  it('makes each automated product own its underwriting authoring form', () => {
    expect(homeProductRuntimeConfig.programmeDefinitionEditor.components.find((component) => component.key === 'underwriting')).toMatchObject({ control: 'home-underwriting' });
    expect(travelProductRuntimeConfig.programmeDefinitionEditor.components.find((component) => component.key === 'underwriting')).toMatchObject({ control: 'travel-underwriting' });
    expect(healthProductRuntimeConfig.programmeDefinitionEditor.components.find((component) => component.key === 'underwriting')).toMatchObject({ control: 'health-underwriting' });
  });
});
