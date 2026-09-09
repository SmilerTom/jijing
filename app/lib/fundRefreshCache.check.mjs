import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import * as queryKeys from './query-keys.js';
import { clearFundRefreshCache, getFreshQueryData } from './fundRefreshCache.mjs';

const client = new QueryClient();
const codes = ['024418', '017811'];
const sectorIds = ['2.950125', '1.930713'];
const staleAt = Date.now() - 20_000;

for (const code of codes) {
  client.setQueryData(queryKeys.fundValuationLast(code), { code, marker: 'stale' }, { updatedAt: staleAt });
}
for (const sectorId of sectorIds) {
  client.setQueryData(queryKeys.eastSectorQuote(sectorId), { sectorId, pct: 1 });
}

for (const code of codes) {
  assert.equal(getFreshQueryData(client, queryKeys.fundValuationLast(code), 10_000), undefined);
}

clearFundRefreshCache(client, codes, queryKeys);
for (const code of codes) {
  assert.equal(client.getQueryData(queryKeys.fundValuationLast(code)), undefined);
}
for (const sectorId of sectorIds) {
  assert.equal(client.getQueryData(queryKeys.eastSectorQuote(sectorId)), undefined);
}

console.log('fund refresh cache checks passed');
