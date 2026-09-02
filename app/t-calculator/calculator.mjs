export const DEFAULT_ENTRIES = [
  { id: 'dip-6', label: '下跌 6% 补仓', change: -6, amount: '' },
  { id: 'dip-12', label: '下跌 12% 补仓', change: -12, amount: '' },
  { id: 'dip-18', label: '下跌 18% 补仓', change: -18, amount: '' },
  { id: 'confirm', label: '止跌确认加仓', nav: 3, change: null, amount: '', confirmation: true }
];

export const DEFAULT_EXITS = [
  { id: 'up-10', label: '上涨 10%', rebound: 10, sellRatio: 10 },
  { id: 'up-10-next', label: '再涨 10%', rebound: 10, sellRatio: 10 },
  { id: 'up-10-third', label: '再涨 10%', rebound: 10, sellRatio: 10 }
];

const numberOr = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const hasNumericValue = (value) =>
  value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));

const navForEntry = (entry, baseNav) => {
  const explicitNav = numberOr(entry?.nav);
  if (entry?.manual && !(explicitNav > 0)) return 0;
  if (explicitNav > 0) return explicitNav;
  return baseNav * (1 + numberOr(entry?.change) / 100);
};

export function calculateEntryRows({ capital = 0, baseNav = 0, entries = [] } = {}) {
  const startingCash = numberOr(capital);
  const safeBaseNav = numberOr(baseNav);
  let cash = startingCash;
  let shares = 0;
  let cumulativeInvested = 0;
  return entries.map((entry, index) => {
    const nav = navForEntry(entry, safeBaseNav);
    const amount = Math.max(0, numberOr(entry?.amount));
    if (!(nav > 0))
      return {
        ...entry,
        index,
        nav: 0,
        amount: 0,
        requestedAmount: amount,
        buyShares: 0,
        cumulativeInvested,
        cash,
        shares,
        holdingValue: 0,
        totalAssets: cash,
        averageCost: shares > 0 ? cumulativeInvested / shares : 0,
        breakEvenNav: shares > 0 ? cumulativeInvested / shares : 0,
        returnRate: startingCash > 0 ? cash / startingCash - 1 : 0,
        pendingNav: true,
        error: entry?.manual ? '等待补全净值' : '净值必须大于 0'
      };
    const buyAmount = Math.min(amount, Math.max(0, cash));
    const buyShares = buyAmount / nav;
    shares += buyShares;
    cash -= buyAmount;
    cumulativeInvested += buyAmount;
    const holdingValue = shares * nav;
    const totalAssets = cash + holdingValue;
    const averageCost = shares > 0 ? cumulativeInvested / shares : 0;
    return {
      ...entry,
      index,
      nav,
      change: entry?.manual && safeBaseNav > 0 ? (nav / safeBaseNav - 1) * 100 : entry?.change,
      amount: buyAmount,
      requestedAmount: amount,
      buyShares,
      cumulativeInvested,
      cash,
      shares,
      holdingValue,
      totalAssets,
      averageCost,
      breakEvenNav: averageCost,
      returnRate: startingCash > 0 ? totalAssets / startingCash - 1 : 0
    };
  });
}

export function summarizeEntryPosition({ rows = [], scenarioNav = 0, redemptionFeePct = 0 } = {}) {
  const last = rows.at(-1);
  const positionRow = [...rows].reverse().find((row) => !row?.pendingNav) || last;
  const nav = numberOr(scenarioNav);
  if (!last || !(nav > 0))
    return {
      cash: positionRow?.cash || 0,
      shares: positionRow?.shares || 0,
      cumulativeInvested: positionRow?.cumulativeInvested || 0,
      holdingValue: 0,
      totalAssets: last?.cash || 0,
      averageCost: last?.averageCost || 0,
      breakEvenNav: 0,
      requiredRise: 0,
      error: '模拟净值必须大于 0'
    };
  const fee = Math.min(99.99, Math.max(0, numberOr(redemptionFeePct))) / 100;
  const breakEvenNav = positionRow.averageCost > 0 ? positionRow.averageCost / (1 - fee) : 0;
  return {
    cash: positionRow.cash,
    shares: positionRow.shares,
    cumulativeInvested: positionRow.cumulativeInvested,
    holdingValue: positionRow.shares * nav,
    totalAssets: positionRow.cash + positionRow.shares * nav,
    averageCost: positionRow.averageCost,
    breakEvenNav,
    requiredRise: breakEvenNav > 0 && nav > 0 ? breakEvenNav / nav - 1 : 0
  };
}

export function calculateExitRows({
  targetCapital = 0,
  baseNav = 0,
  initialShares,
  initialCash = 0,
  exits = [],
  redemptionFeePct = 0
} = {}) {
  const capital = Math.max(0, numberOr(targetCapital));
  const safeBaseNav = numberOr(baseNav);
  if (!(safeBaseNav > 0)) return [];
  const targetShares = hasNumericValue(initialShares) ? Math.max(0, numberOr(initialShares)) : capital / safeBaseNav;
  const fee = Math.min(99.99, Math.max(0, numberOr(redemptionFeePct))) / 100;
  let remainingShares = targetShares;
  let cash = hasNumericValue(initialCash) ? Math.max(0, numberOr(initialCash)) : 0;
  let previousNav = safeBaseNav;
  let blocked = false;
  return exits.map((exit, index) => {
    const explicitNav = numberOr(exit?.nav);
    const referenceNav = previousNav;
    const beforeShares = remainingShares;
    const triggerNav =
      exit?.manual && !(explicitNav > 0)
        ? 0
        : explicitNav > 0
          ? explicitNav
          : previousNav * (1 + numberOr(exit?.rebound) / 100);
    if (blocked || !(triggerNav > 0)) {
      blocked = true;
      return {
        ...exit,
        index,
        targetShares,
        triggerNav: 0,
        beforeShares,
        soldShares: 0,
        usedSellRatio: 0,
        grossCash: 0,
        feeAmount: 0,
        netCash: 0,
        cash,
        remainingShares,
        holdingValue: 0,
        totalAssets: cash,
        totalReturn: capital > 0 ? cash / capital - 1 : 0,
        pendingNav: true,
        error: '等待补全净值'
      };
    }
    const requestedShares = hasNumericValue(exit?.sellShares)
      ? Math.max(0, numberOr(exit?.sellShares))
      : (beforeShares * Math.max(0, numberOr(exit?.sellRatio))) / 100;
    const soldShares = Math.min(remainingShares, requestedShares);
    const grossCash = soldShares * triggerNav;
    const feeAmount = grossCash * fee;
    const netCash = grossCash - feeAmount;
    remainingShares -= soldShares;
    cash += netCash;
    previousNav = triggerNav;
    const holdingValue = remainingShares * triggerNav;
    const totalAssets = cash + holdingValue;
    return {
      ...exit,
      index,
      rebound: exit?.manual && referenceNav > 0 ? (triggerNav / referenceNav - 1) * 100 : exit?.rebound,
      targetShares,
      triggerNav,
      beforeShares,
      soldShares,
      usedSellRatio: beforeShares > 0 ? (soldShares / beforeShares) * 100 : 0,
      grossCash,
      feeAmount,
      netCash,
      cash,
      remainingShares,
      holdingValue,
      totalAssets,
      totalReturn: capital > 0 ? totalAssets / capital - 1 : 0
    };
  });
}

export function calculateRecovery({ currentNav = 0, lossPct = 0 } = {}) {
  const nav = numberOr(currentNav);
  const loss = Math.min(99.99, Math.max(0, numberOr(lossPct))) / 100;
  if (!(nav > 0) || !(loss < 1))
    return {
      currentNav: nav,
      lossPct: loss * 100,
      recoveryNav: 0,
      requiredRise: 0,
      error: '净值必须大于 0，回撤必须小于 100%'
    };
  const recoveryNav = nav / (1 - loss);
  return { currentNav: nav, lossPct: loss * 100, recoveryNav, requiredRise: recoveryNav / nav - 1 };
}
