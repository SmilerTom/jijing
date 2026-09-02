import assert from 'node:assert/strict';
import { calculateEntryRows, calculateExitRows, calculateRecovery } from './calculator.mjs';

const entries = [
  { label: '首次建仓', change: 0, amount: 2000 },
  { label: '下跌 6% 补仓', change: -6, amount: 1500 },
  { label: '下跌 12% 补仓', change: -12, amount: 2000 },
  { label: '下跌 18% 补仓', change: -18, amount: 1500 }
];
const entryRows = calculateEntryRows({ capital: 10000, baseNav: 3.2743, entries });
const lastEntry = entryRows.at(-1);
assert.equal(lastEntry.cumulativeInvested, 7000);
assert.equal(lastEntry.cash, 3000);
assert.ok(Math.abs(lastEntry.totalAssets - 9312.15) < 0.01);
assert.ok(Math.abs(lastEntry.averageCost - 2.9775) < 0.0001);

const recovery = calculateRecovery({ currentNav: 3.2743, lossPct: 40 });
assert.ok(Math.abs(recovery.recoveryNav - 5.4571666667) < 0.0001);
assert.ok(Math.abs(recovery.requiredRise - 0.6666666667) < 0.0001);

const exitRows = calculateExitRows({ targetCapital: 10000, baseNav: 3.2743, exits: [{ label: '上涨 10%', rebound: 10, sellRatio: 10 }] });
assert.equal(exitRows[0].soldShares, exitRows[0].targetShares * 0.1);
assert.ok(Math.abs(exitRows[0].cash + exitRows[0].holdingValue - exitRows[0].totalAssets) < 0.0001);
