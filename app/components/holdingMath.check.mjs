import assert from 'node:assert/strict';
import { costFromNavAndRate, rateFromNavAndCost } from './holdingMath.mjs';

const nav = 2.2417;
const rate = -16.09;
const cost = costFromNavAndRate(nav, rate);

assert.ok(Math.abs(rateFromNavAndCost(nav, cost) - rate) < 0.001);
assert.ok(Number.isNaN(costFromNavAndRate(nav, -100)));

console.log('holding math checks passed');
