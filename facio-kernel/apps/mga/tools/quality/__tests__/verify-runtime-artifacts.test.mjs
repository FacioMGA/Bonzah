import assert from 'node:assert/strict';
import test from 'node:test';

import {
  missingProductionRuntimeSourceDirs,
  productionStageText,
} from '../verify-runtime-artifacts.mjs';

const REGISTRY_DIR = 'frontend/src/modules/policies/list';

test('requires the policy-list registry in the production Docker stage, not only the builder', () => {
  const dockerfile = [
    'FROM node:22 AS backend-builder',
    `COPY ${REGISTRY_DIR}/ ./${REGISTRY_DIR}/`,
    'FROM node:22 AS production',
    'WORKDIR /app',
  ].join('\n');

  assert.equal(productionStageText(dockerfile).includes(REGISTRY_DIR), false);
  assert.deepEqual(missingProductionRuntimeSourceDirs(dockerfile), [REGISTRY_DIR]);
});

test('accepts the registry when the production Docker stage copies it', () => {
  const dockerfile = [
    'FROM node:22 AS backend-builder',
    `COPY ${REGISTRY_DIR}/ ./${REGISTRY_DIR}/`,
    'FROM node:22 AS production',
    `COPY --from=backend-builder /app/${REGISTRY_DIR} ./${REGISTRY_DIR}`,
  ].join('\n');

  assert.deepEqual(missingProductionRuntimeSourceDirs(dockerfile), []);
});
