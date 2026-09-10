import assert from 'node:assert/strict';
import {
  buildStrategyPrompt,
  DEFAULT_STRATEGY,
  calculateMovingAverage,
  calculateStrategyState,
  calculateTrackedHolding
} from './strategy.mjs';

assert.deepEqual(DEFAULT_STRATEGY, { targetRate: 20, sellRatio: 30, cashTranches: 3, maPeriod: 20, lockRiseRate: 10 });
assert.equal(
  calculateMovingAverage(
    Array.from({ length: 20 }, (_, index) => index + 1),
    20
  ),
  10.5
);
assert.equal(calculateMovingAverage([1, 2, 3], 20), null);
assert.equal(calculateMovingAverage([1, 'bad', 2, Infinity], 2), 1.5);
assert.equal(calculateMovingAverage(['', ...Array(19).fill(1)], 20), null);
assert.equal(calculateMovingAverage(Array(20).fill(1), 0), null);
assert.equal(calculateMovingAverage(Array(20).fill(1), ''), null);
assert.equal(
  calculateStrategyState({ currentNav: 1, navHistory: Array(20).fill(1), soldAmount: 3000 }).status,
  'watch'
);
assert.equal(calculateStrategyState({ currentNav: 9, navHistory: Array(20).fill(10), soldAmount: 3000 }).status, 'buy');
assert.equal(
  calculateStrategyState({ currentNav: null, navHistory: Array(20).fill(1), soldAmount: 3000 }).status,
  'pending'
);
assert.equal(
  calculateStrategyState({ currentNav: '', navHistory: Array(20).fill(1), soldAmount: 3000 }).status,
  'pending'
);
assert.equal(calculateStrategyState({ holdingRate: 20, currentHoldingAmount: 10000 }).suggestedSellAmount, 3000);
assert.equal(calculateStrategyState({ holdingRate: 0, strategy: { targetRate: '' } }).sellTriggered, false);
assert.equal(
  buildStrategyPrompt({
    strategyState: { sellTriggered: true, suggestedSellAmount: 3000 },
    holdingRate: 22,
    currentHoldingAmount: 10000,
    strategy: { targetRate: 20, sellRatio: 30 }
  }).label,
  '建议卖出'
);
assert.equal(calculateStrategyState({ holdingRate: 20, currentHoldingAmount: '' }).suggestedSellAmount, null);
assert.equal(
  calculateStrategyState({ holdingRate: 20, currentHoldingAmount: 10000, strategy: { sellRatio: '' } })
    .suggestedSellAmount,
  null
);
assert.equal(calculateStrategyState({ soldAmount: 3000 }).cashPerTranche, 1000);
assert.equal(calculateStrategyState({ currentNav: 1.1, lastSellNav: 1 }).locked, true);
assert.equal(calculateStrategyState({ currentNav: 1.1, lastSellNav: null }).locked, false);
assert.equal(calculateStrategyState({ currentNav: 1.1, lastSellNav: '' }).locked, false);
assert.deepEqual(
  calculateStrategyState({ holdingRate: 20, currentHoldingAmount: 10000, currentNav: 1.1, lastSellNav: 1 }),
  {
    status: 'sell',
    sellTriggered: true,
    suggestedSellAmount: 3000,
    movingAverage: null,
    locked: true,
    cashPerTranche: 0
  }
);
assert.equal(calculateStrategyState({}).status, 'pending');

assert.deepEqual(calculateTrackedHolding({ amount: 1200, rate: 20, basisNav: 2, currentNav: 2.2 }), {
  amount: 1320,
  profit: 320,
  rate: 32,
  principal: 1000,
  share: 600,
  cost: 5 / 3
});
assert.deepEqual(calculateTrackedHolding({ amount: 1000, basisNav: 2, currentNav: 2 }), {
  amount: 1000,
  profit: 0,
  rate: 0,
  principal: 1000,
  share: 500,
  cost: 2
});
