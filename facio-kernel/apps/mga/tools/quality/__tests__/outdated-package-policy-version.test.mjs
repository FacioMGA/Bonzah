import assert from 'node:assert/strict';
import test from 'node:test';

import { highestStableVersion } from '../outdated-package-policy-version.mjs';

test('selects the newest stable release and ignores prereleases', () => {
  assert.equal(
    highestStableVersion(['7.8.2', '8.0.0-dev.4', '7.9.1', '8.0.0-rc.10']),
    '7.9.1',
  );
});

test('compares semantic version components numerically', () => {
  assert.equal(highestStableVersion(['6.10.0', '6.9.99', '5.100.0']), '6.10.0');
});

test('returns null when the registry exposes no stable versions', () => {
  assert.equal(highestStableVersion(['8.0.0-dev.1', '8.0.0-rc.1']), null);
});
