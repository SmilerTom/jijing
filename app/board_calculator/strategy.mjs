export const DEFAULT_STRATEGY = Object.freeze({
  targetRate: 20,
  sellRatio: 30,
  cashTranches: 3,
  maPeriod: 20,
  lockRiseRate: 10
});

export function calculateMovingAverage(values = [], period = 20) {
  const valid = values
    .filter((value) => value !== null && value !== '')
    .map(Number)
    .filter(Number.isFinite);
  const count = Number(period);
  return Number.isInteger(count) && count > 0 && valid.length >= count
    ? valid.slice(-count).reduce((sum, value) => sum + value, 0) / count
    : null;
}

export function calculateTrackedHolding({ amount, profit, rate, basisNav, currentNav } = {}) {
  const baseAmount = Number(amount);
  const baseProfit = Number(profit);
  const baseRate = Number(rate);
  const startingNav = Number(basisNav);
  const latestNav = Number(currentNav);
  const hasAmount = amount !== null && amount !== '' && Number.isFinite(baseAmount) && baseAmount >= 0;
  const hasRate = rate !== null && rate !== '' && Number.isFinite(baseRate) && baseRate > -100;
  const hasProfit = profit !== null && profit !== '' && Number.isFinite(baseProfit);
  if (!hasAmount || !(startingNav > 0) || !(latestNav > 0)) return null;

  const principal = hasRate ? baseAmount / (1 + baseRate / 100) : hasProfit ? baseAmount - baseProfit : baseAmount;
  if (!(principal > 0)) return null;

  const share = baseAmount / startingNav;
  const trackedAmount = baseAmount * (latestNav / startingNav);
  const trackedProfit = trackedAmount - principal;
  return {
    amount: trackedAmount,
    profit: trackedProfit,
    rate: (trackedProfit / principal) * 100,
    principal,
    share,
    cost: principal / share
  };
}

export function calculateStrategyState({
  holdingRate = null,
  currentHoldingAmount = null,
  currentNav = null,
  navHistory = [],
  lastSellNav = null,
  soldAmount = 0,
  strategy = DEFAULT_STRATEGY
} = {}) {
  const config = { ...DEFAULT_STRATEGY, ...strategy };
  const rate = Number(holdingRate);
  const amount = Number(currentHoldingAmount);
  const nav = Number(currentNav);
  const targetRate = Number(config.targetRate);
  const sellRatio = Number(config.sellRatio);
  const lockRiseRate = Number(config.lockRiseRate);
  const cashTranches = Number(config.cashTranches);
  const hasRate = holdingRate !== null && holdingRate !== '' && Number.isFinite(rate);
  const hasAmount = currentHoldingAmount !== null && currentHoldingAmount !== '' && Number.isFinite(amount);
  const hasTargetRate = config.targetRate !== null && config.targetRate !== '' && Number.isFinite(targetRate);
  const hasSellRatio = config.sellRatio !== null && config.sellRatio !== '' && Number.isFinite(sellRatio);
  const hasCurrentNav = currentNav !== null && currentNav !== '' && Number.isFinite(nav);
  const hasLastSellNav = lastSellNav !== null && lastSellNav !== '' && Number.isFinite(Number(lastSellNav));
  const sellTriggered = hasRate && hasTargetRate && rate >= targetRate;
  const suggestedSellAmount = sellTriggered && hasAmount && hasSellRatio ? (amount * sellRatio) / 100 : null;
  const movingAverage = calculateMovingAverage(navHistory, config.maPeriod);
  const locked =
    hasCurrentNav &&
    hasLastSellNav &&
    Number.isFinite(lockRiseRate) &&
    nav >= Number(lastSellNav) * (1 + lockRiseRate / 100);
  const canSuggestBuy =
    !locked && hasCurrentNav && movingAverage !== null && nav < movingAverage && Number(soldAmount) > 0;
  // 踏空锁定只影响补仓，不能抑制止盈卖出建议。
  return {
    status: sellTriggered
      ? 'sell'
      : locked
        ? 'locked'
        : canSuggestBuy
          ? 'buy'
          : movingAverage === null || !hasCurrentNav
            ? 'pending'
            : 'watch',
    sellTriggered,
    suggestedSellAmount,
    movingAverage,
    locked,
    cashPerTranche:
      Number(soldAmount) > 0 && Number.isFinite(cashTranches) && cashTranches > 0
        ? Number(soldAmount) / cashTranches
        : 0
  };
}
