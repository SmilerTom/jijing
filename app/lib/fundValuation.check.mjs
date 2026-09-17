import assert from 'node:assert/strict';
import {
  hasFundEstimate,
  isMarketOpen,
  shouldAutoRefresh,
  shouldShowTradingSessionData,
  trimValuationSeriesAtClose
} from './fundValuation.mjs';

assert.equal(hasFundEstimate({ gsz: null, gszzl: null }), false);
assert.equal(hasFundEstimate({ gsz: '', gszzl: '' }), false);
assert.equal(hasFundEstimate({ gsz: '3.1847', gszzl: null }), true);
assert.equal(hasFundEstimate({ gsz: null, gszzl: 0 }), true);
assert.equal(
  shouldShowTradingSessionData({
    dataDate: '2026-09-08',
    todayStr: '2026-09-09',
    isTradingDay: true,
    currentMinutes: 9 * 60 + 30
  }),
  false
);
assert.equal(
  shouldShowTradingSessionData({
    dataDate: '2026-09-08',
    todayStr: '2026-09-09',
    isTradingDay: true,
    currentMinutes: 9 * 60 + 29
  }),
  true
);
assert.equal(
  shouldShowTradingSessionData({
    dataDate: '2026-09-08',
    todayStr: '2026-09-09',
    isTradingDay: false,
    currentMinutes: 10 * 60
  }),
  true
);
for (const [currentMinutes, expected] of [
  [9 * 60 + 30, false],
  [11 * 60 + 30, false],
  [11 * 60 + 31, true],
  [12 * 60 + 59, true],
  [13 * 60, false],
  [15 * 60, false],
  [15 * 60 + 1, true]
]) {
  assert.equal(
    shouldShowTradingSessionData({
      dataDate: '2026-09-08',
      todayStr: '2026-09-09',
      isTradingDay: true,
      currentMinutes
    }),
    expected,
    `昨日净值不应在开盘时冒充今日数据：${currentMinutes}`
  );
}
assert.equal(
  shouldShowTradingSessionData({
    dataDate: '2026-09-09 09:30',
    todayStr: '2026-09-09',
    isTradingDay: true,
    currentMinutes: 10 * 60
  }),
  true
);
assert.deepEqual(
  trimValuationSeriesAtClose([
    { time: '14:59', value: 1 },
    { time: '15:00', value: 2 },
    { time: '15:01', value: 3 }
  ]),
  [
    { time: '14:59', value: 1 },
    { time: '15:00', value: 2 }
  ]
);
assert.deepEqual(trimValuationSeriesAtClose(null), []);
assert.equal(isMarketOpen({ isTradingDay: true, currentMinutes: 11 * 60 + 30 }), true);
assert.equal(isMarketOpen({ isTradingDay: true, currentMinutes: 11 * 60 + 31 }), false);
assert.equal(isMarketOpen({ isTradingDay: true, currentMinutes: 15 * 60 }), true);
assert.equal(isMarketOpen({ isTradingDay: true, currentMinutes: 15 * 60 + 1 }), false);
assert.equal(
  shouldAutoRefresh({ isTradingDay: false, currentMinutes: 10 * 60, refreshOutsideTradingHours: false }),
  false
);
assert.equal(
  shouldAutoRefresh({ isTradingDay: false, currentMinutes: 10 * 60, refreshOutsideTradingHours: true }),
  true
);

console.log('fund valuation checks passed');
