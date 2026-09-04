export const DEFAULT_STRATEGY = Object.freeze({ targetRate: 20, sellRatio: 30, cashTranches: 3, maPeriod: 20, lockRiseRate: 10 });

export function calculateMovingAverage(values = [], period = 20) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length >= period ? valid.slice(-period).reduce((sum, value) => sum + value, 0) / period : null;
}

export function calculateStrategyState({ holdingRate = null, currentHoldingAmount = null, currentNav = null, navHistory = [], lastSellNav = null, soldAmount = 0, strategy = DEFAULT_STRATEGY } = {}) {
  const rate = Number(holdingRate);
  const amount = Number(currentHoldingAmount);
  const nav = Number(currentNav);
  const hasCurrentNav = currentNav !== null && currentNav !== '' && Number.isFinite(nav);
  const hasLastSellNav = lastSellNav !== null && lastSellNav !== '' && Number.isFinite(Number(lastSellNav));
  const sellTriggered = holdingRate !== null && Number.isFinite(rate) && rate >= strategy.targetRate;
  const suggestedSellAmount = sellTriggered && currentHoldingAmount !== null && Number.isFinite(amount) ? (amount * strategy.sellRatio) / 100 : null;
  const movingAverage = calculateMovingAverage(navHistory, strategy.maPeriod);
  const locked = hasCurrentNav && hasLastSellNav && nav >= Number(lastSellNav) * (1 + strategy.lockRiseRate / 100);
  const canSuggestBuy = !locked && hasCurrentNav && movingAverage !== null && nav < movingAverage && Number(soldAmount) > 0;
  // 踏空锁定只影响补仓，不能抑制止盈卖出建议。
  return { status: sellTriggered ? 'sell' : locked ? 'locked' : canSuggestBuy ? 'buy' : movingAverage === null || !hasCurrentNav ? 'pending' : 'watch', sellTriggered, suggestedSellAmount, movingAverage, locked, cashPerTranche: Number(soldAmount) > 0 ? Number(soldAmount) / strategy.cashTranches : 0 };
}
