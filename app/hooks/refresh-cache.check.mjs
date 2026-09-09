import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import * as qk from '../lib/query-keys.js';

const client = new QueryClient();
const code = '017811';
client.setQueryData(qk.pingzhongdata(code), { date: '2026-09-04' });
client.removeQueries({ queryKey: qk.pingzhongdata(code) });
const result = await client.fetchQuery({ queryKey: qk.pingzhongdata(code), queryFn: async () => ({ date: '2026-09-07' }), staleTime: 60 * 60 * 1000 });
assert.equal(result.date, '2026-09-07');
