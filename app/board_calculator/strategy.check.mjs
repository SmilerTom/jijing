import assert from 'node:assert/strict';
import { DEFAULT_STRATEGY, calculateMovingAverage, calculateStrategyState } from './strategy.mjs';

assert.deepEqual(DEFAULT_STRATEGY, { targetRate: 20, sellRatio: 30, cashTranches: 3, maPeriod: 20, lockRiseRate: 10 });
assert.equal(calculateMovingAverage(Array.from({ length: 20 }, (_, index) => index + 1), 20), 10.5);
assert.equal(calculateMovingAverage([1, 2, 3], 20), null);
assert.equal(calculateMovingAverage([1, 'bad', 2, Infinity], 2), 1.5);
assert.equal(calculateStrategyState({ holdingRate: 20, currentHoldingAmount: 10000 }).suggestedSellAmount, 3000);
assert.equal(calculateStrategyState({ soldAmount: 3000 }).cashPerTranche, 1000);
assert.equal(calculateStrategyState({ currentNav: 1.1, lastSellNav: 1 }).locked, true);
assert.equal(calculateStrategyState({}).status, 'pending');
