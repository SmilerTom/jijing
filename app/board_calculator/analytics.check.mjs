import assert from 'node:assert/strict';
import {
  backtestAgainstHold,
  calendarYearReturns,
  computeMetrics,
  correlation,
  flowsFromTransactions,
  maxDrawdown,
  replayRollingSignals,
  slicePeriod,
  toAdjustedSeries,
  worstWindows,
  xirr
} from './analytics.mjs';

let passed = 0;
const check = (name, test) => {
  test();
  passed += 1;
};
const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const series = (navs, start = '2025-01-01') =>
  navs.map((nav, index) => {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10);
    return { date, nav };
  });

check('分红日用日涨跌幅复权，不把除息当成下跌', () => {
  const adjusted = toAdjustedSeries([
    { date: '2025-01-01', unitNetValue: 2, equityReturn: null },
    { date: '2025-01-02', unitNetValue: 1, equityReturn: '0' },
    { date: '2025-01-03', unitNetValue: 1.1, equityReturn: '10' }
  ]);
  near(adjusted[1].nav / adjusted[0].nav, 1);
  near(adjusted.at(-1).nav, 1.1);
});

check('最大回撤记录峰值、谷底和恢复日', () => {
  const dd = maxDrawdown(series([1, 1.2, 0.9, 1.0, 1.25]));
  near(dd.depth, 25);
  assert.equal(dd.peakDate, '2025-01-02');
  assert.equal(dd.troughDate, '2025-01-03');
  assert.equal(dd.recoveryDate, '2025-01-05');
  assert.equal(dd.recoveryDays, 2);
  assert.equal(maxDrawdown(series([1, 0.8, 0.9])).recoveryDate, null);
});

check('区间收益、年化和基准超额', () => {
  const fund = series([1, 1.1, 1.21]);
  const bench = series([1, 1, 1.05]);
  const metrics = computeMetrics(fund, bench);
  near(metrics.totalReturn, 21);
  near(metrics.benchmark.totalReturn, 5);
  near(metrics.benchmark.excessReturn, 16);
  near(metrics.benchmark.winRate, 100);
  assert.equal(computeMetrics(series([1])), null);
});

check('区间切片从期初前一个交易日开始，历史不足时返回 null', () => {
  const rows = series(
    Array.from({ length: 400 }, (_, i) => 1 + i / 1000),
    '2024-01-01'
  );
  const year = slicePeriod(rows, '1y');
  assert.ok(year[0].date <= '2024-02-03');
  assert.equal(slicePeriod(rows, '3y'), null);
  assert.equal(slicePeriod(rows, 'ytd')[0].date, '2024-12-31');
});

check('自然年收益与最差区间', () => {
  const rows = [
    { date: '2024-12-31', nav: 1 },
    { date: '2025-06-30', nav: 0.8 },
    { date: '2025-12-31', nav: 1.2 },
    { date: '2026-03-31', nav: 1.32 }
  ];
  const years = calendarYearReturns(rows);
  near(years.find((item) => item.year === '2025').fund, 20);
  near(years.find((item) => item.year === '2026').fund, 10);
  near(worstWindows(rows, [1])[0].change, -20);
});

check('XIRR：一年翻倍约 100%，没有取回时返回 null', () => {
  near(
    xirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 200 }
    ]),
    100,
    0.01
  );
  assert.equal(xirr([{ date: '2025-01-01', amount: -100 }]), null);
  const flows = flowsFromTransactions(
    [
      { type: 'buy', amount: 100, date: '2025-01-01' },
      { type: 'buy', amount: 50, date: '2025-02-01', isHistoryOnly: true }
    ],
    120,
    '2026-01-01'
  );
  assert.deepEqual(flows, [
    { date: '2025-01-01', amount: -100 },
    { date: '2026-01-01', amount: 120 }
  ]);
});

check('相关系数：同向为 1，样本不足返回 null', () => {
  const a = series(Array.from({ length: 30 }, (_, i) => 1 + Math.sin(i) / 10));
  const b = a.map((row) => ({ ...row, nav: row.nav * 2 }));
  near(correlation(a, b), 1, 1e-9);
  assert.equal(correlation(a.slice(0, 10), b), null);
});

check('涨跌滚仓回放：卖出、买回、止损后停止', () => {
  const rows = series([1, 1.2, 1.05, 1.0, 1.2, 0.9, 1.5]);
  const signals = replayRollingSignals(rows, { riseRate: 20, buyDropRate: 10, stopDrawdown: 20, cooldownDays: 0 });
  assert.deepEqual(
    signals.map((s) => s.reason),
    ['sell', 'buy', 'stop']
  );
});

check('回测对比一直持有：卖在高点买回低点跑赢，扣费后差额减少', () => {
  const rows = series([1, 1.2, 1.0, 1.2]);
  const signals = [
    { date: rows[1].date, type: 'sell' },
    { date: rows[2].date, type: 'buy' }
  ];
  const free = backtestAgainstHold(rows, signals, { corePercent: 0 });
  near(free.strategy.totalReturn, 44);
  near(free.holding.totalReturn, 20);
  const paid = backtestAgainstHold(rows, signals, { corePercent: 0, buyFee: 0.01, feeForDays: () => 0.005 });
  assert.ok(paid.strategy.totalReturn < free.strategy.totalReturn);
  assert.ok(paid.fees > 0);
  const half = backtestAgainstHold(rows, signals, { corePercent: 50 });
  near(half.strategy.totalReturn, 32);
});

console.log(`分析检查：${passed} 项通过`);
