import assert from 'node:assert/strict';
import {
  DEFAULT_EXITS,
  calculateEntryRows,
  calculateExitRows,
  calculateRecovery,
  calculateRiskSignals,
  DEFAULT_RISK_RULES,
  summarizeAccountPosition,
  summarizeEntryPosition
} from './calculator.mjs';

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
const emptyPosition = summarizeEntryPosition({
  rows: calculateEntryRows({ capital: 0, baseNav: 3.2743, entries: [{ change: 0, amount: 0 }] }),
  scenarioNav: 3.2743
});
assert.equal(emptyPosition.requiredRise, 0);

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

const legacyEmptyAmountRatioExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  exits: [{ amount: '', sellRatio: 10 }]
});
assert.equal(legacyEmptyAmountRatioExitRows[0].soldShares, 10);

const legacyEmptyAmountSharesExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  exits: [{ amount: '', sellShares: 10 }]
});
assert.equal(legacyEmptyAmountSharesExitRows[0].soldShares, 10);

const emptyAmountExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  exits: [DEFAULT_EXITS[0]]
});
assert.equal(emptyAmountExitRows[0].soldShares, 0);

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

const datedEntryRows = calculateEntryRows({
  capital: 1000,
  baseNav: 10,
  entries: [{ amount: 500, recordedAt: '2026-09-01T15:00' }],
  navByDate: { '2026-09-01': 5 },
  dailyChangeByDate: { '2026-09-01': -50 }
});
assert.equal(datedEntryRows[0].change, -50);
const datedExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 200,
  exits: [{ amount: 100, recordedAt: '2026-09-02T15:00' }],
  navByDate: { '2026-09-02': 12 },
  dailyChangeByDate: { '2026-09-02': 20 }
});
assert.ok(Math.abs(datedExitRows[0].rebound - 20) < 0.0001);
assert.ok(Math.abs(datedExitRows[0].soldShares - 100 / 12) < 0.0001);
assert.equal(datedExitRows[0].cumulativeAmount, 100);

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

const missingDatedExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  exits: [{ amount: 100, recordedAt: '2026-09-02T15:00' }],
  navByDate: {}
});
assert.equal(missingDatedExitRows[0].pendingNav, true);
assert.equal(missingDatedExitRows[0].soldShares, 0);

const accountSummary = summarizeAccountPosition({
  entryRows: [{ recordedAt: '2026-09-01', cumulativeInvested: 1000, shares: 100, cash: 0, totalAssets: 1000 }],
  exitRows: [{ recordedAt: '2026-09-02', cumulativeAmount: 200, cash: 200, remainingShares: 90, totalAssets: 1100 }],
  currentNav: 10,
  equityHistory: [
    { date: '2026-09-01', totalAssets: 1000 },
    { date: '2026-09-02', totalAssets: 1200 },
    { date: '2026-09-03', totalAssets: 1100 },
    { date: '2026-09-04', totalAssets: 0, pendingNav: true }
  ]
});
assert.equal(accountSummary.invested, 1000);
assert.equal(accountSummary.realizedAmount, 200);
assert.equal(accountSummary.shares, 90);
assert.equal(accountSummary.cash, 200);
assert.equal(accountSummary.holdingValue, 900);
assert.equal(accountSummary.totalAssets, 1100);
assert.equal(accountSummary.profit, 100);
assert.equal(accountSummary.profitRate, 0.1);
assert.ok(Math.abs(accountSummary.maxDrawdown + 0.0833333333) < 0.0001);

for (const currentNav of [0, 'invalid']) {
  const historicalOnlySummary = summarizeAccountPosition({
    entryRows: [{ recordedAt: '2026-09-01', cumulativeInvested: 1000, shares: 100, cash: 200, totalAssets: 1200 }],
    currentNav,
    equityHistory: [
      { date: '2026-09-01', totalAssets: 1000 },
      { date: '2026-09-02', totalAssets: 1200 },
      { date: '2026-09-03', totalAssets: 1100 }
    ]
  });
  assert.ok(Math.abs(historicalOnlySummary.maxDrawdown + 0.0833333333) < 0.0001);
}

const connectedDrawdownSummary = summarizeAccountPosition({
  entryRows: [{ recordedAt: '2026-09-01', cumulativeInvested: 1000, shares: 100, cash: 0, totalAssets: 1000 }],
  currentNav: 9.6,
  equityHistory: [
    { date: '2026-09-01', totalAssets: 1000 },
    { date: '2026-09-02', totalAssets: 1200 },
    { date: '2026-09-03', totalAssets: 1100 }
  ]
});
assert.ok(Math.abs(connectedDrawdownSummary.maxDrawdown + 0.2) < 0.0001);
assert.deepEqual(calculateRiskSignals({ maxDrawdown: connectedDrawdownSummary.maxDrawdown }).map(({ action, level }) => ({ action, level })), [
  { action: '暂停补仓', level: 'danger' }
]);

assert.deepEqual(calculateRiskSignals({ fundDailyChange: -8 }), [
  { id: 'fund-down-entry', level: 'warning', source: '基金', action: '建议补仓', message: '基金日跌幅达到补仓线' }
]);
assert.deepEqual(calculateRiskSignals({ fundDailyChange: 8 }), [
  { id: 'fund-up-exit', level: 'warning', source: '基金', action: '建议出仓', message: '基金日涨幅达到出仓线' }
]);
assert.deepEqual(calculateRiskSignals({ benchmarkChange: -9 }), [
  { id: 'benchmark', level: 'index', source: '业绩基准指数', action: '指数预警', message: '指数达到预警线，基金净值待更新' }
]);
assert.deepEqual(calculateRiskSignals({ maxDrawdown: -20 }), [
  { id: 'drawdown-stop', level: 'danger', source: '账户回撤', action: '暂停补仓', message: '最大回撤达到暂停线' }
]);

assert.equal(DEFAULT_RISK_RULES.fundDownWatch, -5);
assert.deepEqual(calculateRiskSignals({ fundDailyChange: -5 }).map(({ action, level }) => ({ action, level })), [
  { action: '观察', level: 'watch' }
]);
assert.equal(DEFAULT_RISK_RULES.fundDownEntry, -8);
assert.deepEqual(calculateRiskSignals({ fundDailyChange: -8 }).map(({ action, level }) => ({ action, level })), [
  { action: '建议补仓', level: 'warning' }
]);
assert.equal(DEFAULT_RISK_RULES.fundDownStop, -12);
assert.deepEqual(calculateRiskSignals({ fundDailyChange: -12 }).map(({ action, level }) => ({ action, level })), [
  { action: '暂停补仓', level: 'danger' }
]);
assert.equal(DEFAULT_RISK_RULES.fundUpWatch, 5);
assert.deepEqual(calculateRiskSignals({ fundDailyChange: 5 }).map(({ action, level }) => ({ action, level })), [
  { action: '观察', level: 'watch' }
]);
assert.equal(DEFAULT_RISK_RULES.fundUpExit, 8);
assert.deepEqual(calculateRiskSignals({ fundDailyChange: 8 }).map(({ action, level }) => ({ action, level })), [
  { action: '建议出仓', level: 'warning' }
]);
assert.equal(DEFAULT_RISK_RULES.fundUpStrong, 12);
assert.deepEqual(calculateRiskSignals({ fundDailyChange: 12 }).map(({ action, level }) => ({ action, level })), [
  { action: '分批出仓', level: 'danger' }
]);
assert.equal(DEFAULT_RISK_RULES.drawdownWarn, -10);
assert.deepEqual(calculateRiskSignals({ maxDrawdown: -10 }).map(({ action, level }) => ({ action, level })), [
  { action: '风险提醒', level: 'warning' }
]);
assert.equal(DEFAULT_RISK_RULES.drawdownStop, -20);
assert.deepEqual(calculateRiskSignals({ maxDrawdown: -20 }).map(({ action, level }) => ({ action, level })), [
  { action: '暂停补仓', level: 'danger' }
]);

const missingDailyEntryRows = calculateEntryRows({
  capital: 1000,
  baseNav: 10,
  entries: [{ amount: 100, recordedAt: '2026-09-03T15:00' }],
  navByDate: { '2026-09-03': 9 },
  dailyChangeByDate: {}
});
assert.equal(missingDailyEntryRows[0].dailyChange, null);
assert.equal(missingDailyEntryRows[0].pendingDailyChange, true);
assert.equal(missingDailyEntryRows[0].nav, 9);
assert.equal(missingDailyEntryRows[0].amount, 100);
assert.ok(Math.abs(missingDailyEntryRows[0].buyShares - 100 / 9) < 0.0001);
assert.ok(Math.abs(missingDailyEntryRows[0].cumulativeInvested - 100) < 0.0001);
assert.ok(Math.abs(missingDailyEntryRows[0].shares - 100 / 9) < 0.0001);
assert.equal(missingDailyEntryRows[0].cash, 900);
assert.notEqual(missingDailyEntryRows[0].pendingNav, true);

const datedDailyExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  exits: [{ amount: 100, recordedAt: '2026-09-03T15:00' }],
  navByDate: { '2026-09-03': 11 },
  dailyChangeByDate: { '2026-09-03': 2.5 }
});
assert.equal(datedDailyExitRows[0].dailyChange, 2.5);

const missingDailyExitRows = calculateExitRows({
  targetCapital: 1000,
  baseNav: 10,
  initialShares: 100,
  exits: [{ amount: 100, recordedAt: '2026-09-03T15:00' }],
  navByDate: { '2026-09-03': 11 },
  dailyChangeByDate: {}
});
assert.equal(missingDailyExitRows[0].pendingDailyChange, true);
assert.equal(missingDailyExitRows[0].dailyChange, null);
assert.equal(missingDailyExitRows[0].triggerNav, 11);
assert.ok(Math.abs(missingDailyExitRows[0].soldShares - 100 / 11) < 0.0001);
assert.ok(Math.abs(missingDailyExitRows[0].netCash - 100) < 0.0001);
assert.ok(Math.abs(missingDailyExitRows[0].cumulativeAmount - 100) < 0.0001);
assert.ok(Math.abs(missingDailyExitRows[0].remainingShares - (100 - 100 / 11)) < 0.0001);
assert.notEqual(missingDailyExitRows[0].pendingNav, true);
