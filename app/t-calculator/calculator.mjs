export const DEFAULT_ENTRIES = [
  { id: 'initial', label: '首次建仓', change: 0, amount: 2000 },
  { id: 'dip-6', label: '下跌 6% 补仓', change: -6, amount: 1500 },
  { id: 'dip-12', label: '下跌 12% 补仓', change: -12, amount: 2000 },
  { id: 'dip-18', label: '下跌 18% 补仓', change: -18, amount: 1500 },
  { id: 'confirm', label: '止跌确认加仓', nav: 3, change: null, amount: 3000, confirmation: true }
];

export const DEFAULT_EXITS = [
  { id: 'up-10', label: '上涨 10%', rebound: 10, sellRatio: 10 },
  { id: 'up-18', label: '上涨 18%', rebound: 18, sellRatio: 10 },
  { id: 'up-30', label: '上涨 30%', rebound: 30, sellRatio: 10 }
];

const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const navForEntry = (entry, baseNav) => {
  const explicitNav = numberOr(entry?.nav);
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
    if (!(nav > 0)) return { ...entry, index, nav: 0, amount, error: '净值必须大于 0' };
    const buyAmount = Math.min(amount, Math.max(0, cash));
    shares += buyAmount / nav;
    cash -= buyAmount;
    cumulativeInvested += buyAmount;
    const holdingValue = shares * nav;
    const totalAssets = cash + holdingValue;
    const averageCost = shares > 0 ? cumulativeInvested / shares : 0;
    return { ...entry, index, nav, amount: buyAmount, requestedAmount: amount, cumulativeInvested, cash, shares, holdingValue, totalAssets, averageCost, breakEvenNav: averageCost };
  });
}

export function summarizeEntryPosition({ rows = [], scenarioNav = 0, redemptionFeePct = 0 } = {}) {
  const last = rows.at(-1);
  const nav = numberOr(scenarioNav);
  if (!last || !(nav > 0)) return { cash: last?.cash || 0, shares: last?.shares || 0, cumulativeInvested: last?.cumulativeInvested || 0, holdingValue: 0, totalAssets: last?.cash || 0, averageCost: last?.averageCost || 0, breakEvenNav: 0, requiredRise: 0, error: '模拟净值必须大于 0' };
  const fee = Math.min(99.99, Math.max(0, numberOr(redemptionFeePct))) / 100;
  const breakEvenNav = last.averageCost > 0 ? last.averageCost / (1 - fee) : 0;
  return { cash: last.cash, shares: last.shares, cumulativeInvested: last.cumulativeInvested, holdingValue: last.shares * nav, totalAssets: last.cash + last.shares * nav, averageCost: last.averageCost, breakEvenNav, requiredRise: nav > 0 ? breakEvenNav / nav - 1 : 0 };
}

export function calculateExitRows({ targetCapital = 0, baseNav = 0, exits = [], redemptionFeePct = 0 } = {}) {
  const capital = Math.max(0, numberOr(targetCapital));
  const safeBaseNav = numberOr(baseNav);
  if (!(safeBaseNav > 0)) return [];
  const targetShares = capital / safeBaseNav;
  const fee = Math.min(99.99, Math.max(0, numberOr(redemptionFeePct))) / 100;
  let remainingShares = targetShares;
  let cash = 0;
  return exits.map((exit, index) => {
    const triggerNav = safeBaseNav * (1 + numberOr(exit?.rebound) / 100);
    const requestedShares = targetShares * Math.max(0, numberOr(exit?.sellRatio)) / 100;
    const soldShares = Math.min(remainingShares, requestedShares);
    const grossCash = soldShares * triggerNav;
    const feeAmount = grossCash * fee;
    const netCash = grossCash - feeAmount;
    remainingShares -= soldShares;
    cash += netCash;
    const holdingValue = remainingShares * triggerNav;
    const totalAssets = cash + holdingValue;
    return { ...exit, index, targetShares, triggerNav, soldShares, grossCash, feeAmount, netCash, cash, remainingShares, holdingValue, totalAssets, totalReturn: capital > 0 ? totalAssets / capital - 1 : 0 };
  });
}

export function calculateRecovery({ currentNav = 0, lossPct = 0 } = {}) {
  const nav = numberOr(currentNav);
  const loss = Math.min(99.99, Math.max(0, numberOr(lossPct))) / 100;
  if (!(nav > 0) || !(loss < 1)) return { currentNav: nav, lossPct: loss * 100, recoveryNav: 0, requiredRise: 0, error: '净值必须大于 0，回撤必须小于 100%' };
  const recoveryNav = nav / (1 - loss);
  return { currentNav: nav, lossPct: loss * 100, recoveryNav, requiredRise: recoveryNav / nav - 1 };
}
