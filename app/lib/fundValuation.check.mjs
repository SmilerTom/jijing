import assert from 'node:assert/strict';
import { hasFundEstimate, shouldShowTradingSessionData } from './fundValuation.mjs';

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
assert.equal(
  shouldShowTradingSessionData({
    dataDate: '2026-09-09 09:30',
    todayStr: '2026-09-09',
    isTradingDay: true,
    currentMinutes: 10 * 60
  }),
  true
);

console.log('fund valuation checks passed');
