import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isProductRuntimeAsset,
  missingDockerAssetTripwires,
} from '../product-onboarding-docker-assets.mjs';

test('identifies runtime-loaded product assets covered by ADR-0033 slot 6', () => {
  assert.equal(isProductRuntimeAsset('backend/products/home/pricing/data/rates.json'), true);
  assert.equal(isProductRuntimeAsset('backend/products/home/documents/templates/schedule.html'), true);
  assert.equal(isProductRuntimeAsset('backend/products/home/documents/static/wording.pdf'), true);
  assert.equal(isProductRuntimeAsset('backend/products/home/pricing/data/loader.ts'), false);
  assert.equal(isProductRuntimeAsset('backend/products/home/documents/static/source.docx'), false);
});

test('reports assets that lack Docker build-time test -f tripwires', () => {
  const assets = [
    'backend/products/home/pricing/data/rates.json',
    'backend/products/home/documents/static/Home Wording (2026).pdf',
  ];
  const dockerfile = [
    'RUN test -f ./backend/dist/products/home/pricing/data/rates.json',
  ].join('\n');

  assert.deepEqual(missingDockerAssetTripwires(dockerfile, assets), [
    'backend/products/home/documents/static/Home Wording (2026).pdf',
  ]);
});

test('accepts quoted tripwires for paths containing spaces', () => {
  const asset = 'backend/products/home/documents/static/Home Wording (2026).pdf';
  const dockerfile = 'RUN test -f "./backend/dist/products/home/documents/static/Home Wording (2026).pdf"';
  assert.deepEqual(missingDockerAssetTripwires(dockerfile, [asset]), []);
});
