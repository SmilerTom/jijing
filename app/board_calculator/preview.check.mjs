import assert from 'node:assert/strict';
import { bandPercentageSeries, navChange, triggerDistance } from './preview.mjs';
import { buildStrategyPrompt } from './strategy.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
close(navChange(1.04 * 1.012, 1), 5.248);
close(navChange(0.96 * 0.988, 1), -5.152);
for (const invalid of [null, undefined, '', NaN, 0, -1, Infinity]) {
  assert.equal(navChange(invalid, 1), null);
  assert.equal(navChange(1, invalid), null);
}
close(triggerDistance(1.04, 1.05), (1.05 / 1.04 - 1) * 100);
close(triggerDistance(1.02, 0.95, true), (1 - 0.95 / 1.02) * 100);
assert.equal(triggerDistance(1.06, 1.05), 0);
assert.equal(triggerDistance(0.94, 0.95, true), 0);
assert.equal(triggerDistance(null, 1), null);
const source = [{ date: '2026-11-05', nav: 1.2, ma: 1, upper: 1.25, lower: 0.9 }];
const [point] = bandPercentageSeries(source);
close(point.nav, 20);
close(point.upper, 25);
close(point.lower, -10);
assert.equal(point.ma, 0);
assert.equal(source[0].nav, 1.2);
const state = { status: 'watch', riseRate: 10, buyDropRate: 5, stopDrawdown: 10, drawdown: 0 };
assert.equal(buildStrategyPrompt({ strategyState: { ...state, phase: 'holding', change: -3 } }).metric, '下跌 3.00%');
assert.equal(buildStrategyPrompt({ strategyState: { ...state, phase: 'waitingBuy', change: 3 } }).metric, '上涨 3.00%');
console.log('PASS preview percentages, compound changes, trigger distances and missing data');
