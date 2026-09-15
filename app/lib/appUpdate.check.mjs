import assert from 'node:assert/strict';
import { getAppReloadUrl, isAppUpdateAvailable } from './appUpdate.mjs';

assert.equal(isAppUpdateAvailable('old-build', 'new-build'), true);
assert.equal(isAppUpdateAvailable('same-build', 'same-build'), false);
assert.equal(isAppUpdateAvailable('development', 'new-build'), false);
assert.equal(
  getAppReloadUrl('https://example.com/jijing/?tab=mine', 'new-build'),
  'https://example.com/jijing/?tab=mine&_update=new-build'
);

console.log('appUpdate checks passed');
