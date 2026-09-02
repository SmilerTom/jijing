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
assert.ok(Math.abs(lastEntry.returnRate + 0.068785) < 0.0001);

const recovery = calculateRecovery({ currentNav: 3.2743, lossPct: 40 });
assert.ok(Math.abs(recovery.recoveryNav - 5.4571666667) < 0.0001);
assert.ok(Math.abs(recovery.requiredRise - 0.6666666667) < 0.0001);

const exitRows = calculateExitRows({
  targetCapital: 10000,
  baseNav: 3.2743,
  exits: [{ label: '上涨 10%', rebound: 10, sellRatio: 10 }]
});
assert.equal(exitRows[0].soldShares, exitRows[0].targetShares * 0.1);
assert.ok(Math.abs(exitRows[0].cash + exitRows[0].holdingValue - exitRows[0].totalAssets) < 0.0001);

const rollingExitRows = calculateExitRows({
  targetCapital: 10000,
  baseNav: 3.2743,
  exits: [
    { label: '第一轮上涨 10%', rebound: 10, sellRatio: 10 },
    { label: '第二轮再涨 10%', rebound: 10, sellRatio: 10 }
  ]
});
assert.ok(Math.abs(rollingExitRows[1].triggerNav - rollingExitRows[0].triggerNav * 1.1) < 0.0001);
assert.ok(Math.abs(rollingExitRows[1].netCash - 1089) < 0.01);
assert.ok(Math.abs(rollingExitRows[1].holdingValue - 9801) < 0.01);
assert.ok(Math.abs(rollingExitRows[1].totalAssets - 11990) < 0.01);

const manualShareExitRows = calculateExitRows({
  targetCapital: 3.2743 * 42000,
  baseNav: 3.2743,
  exits: [{ label: '手动卖出', rebound: 10, sellRatio: 10, sellShares: 4200 }]
});
assert.ok(Math.abs(manualShareExitRows[0].soldShares - 4200) < 0.0001);
assert.ok(Math.abs(manualShareExitRows[0].usedSellRatio - 10) < 0.0001);

const cappedShareExitRows = calculateExitRows({
  targetCapital: 10000,
  baseNav: 3.2743,
  exits: [{ rebound: 10, sellRatio: 10, sellShares: 999999 }]
});
assert.equal(cappedShareExitRows[0].soldShares, cappedShareExitRows[0].beforeShares);
assert.equal(cappedShareExitRows[0].usedSellRatio, 100);

const manualNavExitRows = calculateExitRows({
  targetCapital: 10000,
  baseNav: 3.2743,
  exits: [{ nav: 3.6, sellShares: 100 }]
});
assert.equal(manualNavExitRows[0].triggerNav, 3.6);

const actualPositionRows = calculateEntryRows({
  capital: 1000,
  baseNav: 10,
  entries: [{ amount: 500, nav: 2, manual: true }]
});
assert.equal(actualPositionRows[0].change, -80);
const dynamicExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: actualPositionRows.at(-1).shares,
  initialCash: actualPositionRows.at(-1).cash,
  exits: [{ rebound: 10, sellRatio: 10 }]
});
assert.equal(dynamicExitRows[0].beforeShares, 250);
assert.equal(dynamicExitRows[0].soldShares, 25);
assert.equal(dynamicExitRows[0].cash, 775);
assert.equal(dynamicExitRows[0].totalAssets, 3250);

const manualFilledExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  exits: [{ manual: true, sellShares: 10, nav: 11 }]
});
assert.ok(Math.abs(manualFilledExitRows[0].rebound - 10) < 0.0001);

const pendingEntryRows = calculateEntryRows({
  capital: 1000,
  baseNav: 10,
  entries: [{ amount: 500, nav: '', manual: true }]
});
assert.equal(pendingEntryRows[0].pendingNav, true);
assert.equal(pendingEntryRows[0].buyShares, 0);
assert.equal(pendingEntryRows[0].cumulativeInvested, 0);

const pendingExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  initialCash: 0,
  exits: [{ manual: true, sellShares: 10, nav: '' }]
});
assert.equal(pendingExitRows[0].pendingNav, true);
assert.equal(pendingExitRows[0].soldShares, 0);
assert.equal(pendingExitRows[0].remainingShares, 100);
