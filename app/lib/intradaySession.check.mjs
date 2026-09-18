import assert from 'node:assert/strict';
import {
  TRADING_SESSION_TICKS,
  alignValuationSeriesToSession,
  buildTradingSessionLabels,
  clampToSessionMinutes,
  parseSessionMinutes
} from './intradaySession.mjs';

const labels = buildTradingSessionLabels();
assert.equal(labels[0], '09:30');
assert.equal(labels.at(-1), '15:00');
assert.ok(labels.includes('11:30'));
assert.ok(labels.includes('13:00'));
assert.ok(!labels.includes('12:00'));
assert.equal(labels.length, 121 + 121);

assert.equal(parseSessionMinutes('9:35'), 9 * 60 + 35);
assert.equal(clampToSessionMinutes(9 * 60 + 10), 9 * 60 + 30);
assert.equal(clampToSessionMinutes(12 * 60), 11 * 60 + 30);
assert.equal(clampToSessionMinutes(15 * 60 + 20), 15 * 60);

const aligned = alignValuationSeriesToSession([
  { time: '10:01', value: 1.1 },
  { time: '10:01', value: 1.2 },
  { time: '15:20', value: 1.3 }
]);
assert.equal(aligned.labels[0], '09:30');
assert.equal(aligned.labels.at(-1), '15:00');
assert.equal(aligned.values[aligned.labels.indexOf('09:30')], null);
assert.equal(aligned.values[aligned.labels.indexOf('10:01')], 1.2);
assert.equal(aligned.values[aligned.labels.indexOf('15:00')], 1.3);
assert.deepEqual(TRADING_SESSION_TICKS, ['09:30', '11:30', '13:00', '15:00']);

console.log('intraday session checks passed');
