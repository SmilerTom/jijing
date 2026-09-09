import assert from 'node:assert/strict';
import { buildFundDeleteConfirmation } from './fundDeletion.mjs';

const fund = { code: '017811', name: '东方人工智能主题混合C' };

assert.deepEqual(buildFundDeleteConfirmation(fund), {
  ...fund,
  scope: 'global',
  hasHolding: false,
  otherGroups: []
});
assert.equal(buildFundDeleteConfirmation(fund, { groupId: 'group-1' }).scope, 'group');

console.log('fund deletion checks passed');
