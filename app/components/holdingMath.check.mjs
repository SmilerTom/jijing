import assert from 'node:assert/strict';
import {
  costFromNavAndRate,
  profitFromAmountAndRate,
  rateFromAmountAndProfit,
  rateFromNavAndCost
} from './holdingMath.mjs';

const nav = 2.2417;
const rate = -16.09;
const cost = costFromNavAndRate(nav, rate);

assert.ok(Math.abs(rateFromNavAndCost(nav, cost) - rate) < 0.001);
assert.ok(Number.isNaN(costFromNavAndRate(nav, -100)));

const amount = 1000;
const profit = profitFromAmountAndRate(amount, 25);
assert.ok(Math.abs(profit - 200) < 0.001);
assert.ok(Math.abs(rateFromAmountAndProfit(amount, profit) - 25) < 0.001);
assert.ok(Number.isNaN(rateFromAmountAndProfit(amount, amount)));

console.log('holding math checks passed');
