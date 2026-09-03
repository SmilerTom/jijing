export const DEFAULT_ENTRIES = [
  { id: 'dip-6', label: '下跌 6% 补仓', change: -6, amount: '' },
  { id: 'dip-12', label: '下跌 12% 补仓', change: -12, amount: '' },
  { id: 'dip-18', label: '下跌 18% 补仓', change: -18, amount: '' },
  { id: 'confirm', label: '止跌确认加仓', nav: 3, change: null, amount: '', confirmation: true }
];

export const DEFAULT_EXITS = [
  { id: 'up-10', label: '上涨 10%', rebound: 10, amount: '' },
  { id: 'up-10-next', label: '再涨 10%', rebound: 10, amount: '' },
  { id: 'up-10-third', label: '再涨 10%', rebound: 10, amount: '' }
];

export const DEFAULT_RISK_RULES = {
  fundDownWatch: -5,
  fundDownEntry: -8,
  fundDownStop: -12,
  fundUpWatch: 5,
  fundUpExit: 8,
  fundUpStrong: 12,
  drawdownWarn: -10,
  drawdownStop: -20
};

const numberOr = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const hasNumericValue = (value) =>
  value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
const flowDate = (flow) => {
  const value = String(flow?.recordedAt || '');
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
};
const hasDateNav = (navByDate, date) => Boolean(date && Object.prototype.hasOwnProperty.call(navByDate, date));
const dailyFields = (flow, dailyChangeByDate) => {
  const date = flowDate(flow);
  if (!date) return {};
  const value = dailyChangeByDate?.[date];
  const ready = hasNumericValue(value);
  return { dailyChange: ready ? numberOr(value) : null, pendingDailyChange: !ready };
};

const navForEntry = (entry, baseNav, navByDate) => {
  const date = flowDate(entry);
  if (hasDateNav(navByDate, date)) return numberOr(navByDate[date]);
  if (date) return entry?.manual ? numberOr(entry?.nav) : 0;
  const explicitNav = numberOr(entry?.nav);
  if (entry?.manual && !(explicitNav > 0)) return 0;
  if (explicitNav > 0) return explicitNav;
  return baseNav * (1 + numberOr(entry?.change) / 100);
};

export function calculateEntryRows({ capital = 0, baseNav = 0, entries = [], navByDate = {}, dailyChangeByDate = {} } = {}) {
  const startingCash = numberOr(capital);
  const safeBaseNav = numberOr(baseNav);
  let cash = startingCash;
  let shares = 0;
  let cumulativeInvested = 0;
  let blocked = false;
  return entries.map((entry, index) => {
    const nav = navForEntry(entry, safeBaseNav, navByDate);
    const amount = Math.max(0, numberOr(entry?.amount));
    if (blocked || !(nav > 0)) {
      blocked = true;
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
        error: entry?.manual ? '等待补全净值' : '净值必须大于 0',
        ...dailyFields(entry, dailyChangeByDate)
      };
    }
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
      change: (entry?.manual || flowDate(entry)) && safeBaseNav > 0 ? (nav / safeBaseNav - 1) * 100 : entry?.change,
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
      returnRate: startingCash > 0 ? totalAssets / startingCash - 1 : 0,
      ...dailyFields(entry, dailyChangeByDate)
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
  navByDate = {},
  dailyChangeByDate = {},
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
  let cumulativeAmount = 0;
  return exits.map((exit, index) => {
    const date = flowDate(exit);
    const dateHasNav = hasDateNav(navByDate, date);
    const dateNav = dateHasNav ? numberOr(navByDate[date]) : 0;
    const explicitNav = numberOr(exit?.nav);
    const referenceNav = previousNav;
    const beforeShares = remainingShares;
    const triggerNav = dateHasNav
      ? dateNav
      : date
        ? exit?.manual
          ? explicitNav
          : 0
        : exit?.manual && !(explicitNav > 0)
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
        requestedAmount: hasNumericValue(exit?.amount) ? Math.max(0, numberOr(exit.amount)) : 0,
        cumulativeAmount,
        cash,
        remainingShares,
        holdingValue: 0,
        totalAssets: cash,
        totalReturn: capital > 0 ? cash / capital - 1 : 0,
        pendingNav: true,
        error: '等待补全净值',
        ...dailyFields(exit, dailyChangeByDate)
      };
    }
    const hasAmountField = Object.prototype.hasOwnProperty.call(exit, 'amount');
    const requestedAmount = hasNumericValue(exit?.amount) ? Math.max(0, numberOr(exit.amount)) : NaN;
    const requestedShares = Number.isFinite(requestedAmount)
      ? requestedAmount / triggerNav
      : hasAmountField
        ? 0
        : hasNumericValue(exit?.sellShares)
          ? Math.max(0, numberOr(exit?.sellShares))
          : (beforeShares * Math.max(0, numberOr(exit?.sellRatio))) / 100;
    const soldShares = Math.min(remainingShares, requestedShares);
    const grossCash = soldShares * triggerNav;
    const feeAmount = grossCash * fee;
    const netCash = grossCash - feeAmount;
    remainingShares -= soldShares;
    cash += netCash;
    cumulativeAmount += netCash;
    previousNav = triggerNav;
    const holdingValue = remainingShares * triggerNav;
    const totalAssets = cash + holdingValue;
    return {
      ...exit,
      index,
      rebound: (exit?.manual || date) && referenceNav > 0 ? (triggerNav / referenceNav - 1) * 100 : exit?.rebound,
      targetShares,
      triggerNav,
      beforeShares,
      soldShares,
      usedSellRatio: beforeShares > 0 ? (soldShares / beforeShares) * 100 : 0,
      grossCash,
      feeAmount,
      netCash,
      requestedAmount: Number.isFinite(requestedAmount) ? requestedAmount : grossCash,
      cumulativeAmount,
      cash,
      remainingShares,
      holdingValue,
      totalAssets,
      totalReturn: capital > 0 ? totalAssets / capital - 1 : 0,
      ...dailyFields(exit, dailyChangeByDate)
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

export function summarizeAccountPosition({ entryRows = [], exitRows = [], currentNav = 0, equityHistory = [] } = {}) {
  const entry = [...entryRows].reverse().find((row) => !row?.pendingNav);
  const exit = [...exitRows].reverse().find((row) => !row?.pendingNav);
  const invested = numberOr(entry?.cumulativeInvested);
  const shares = exit ? numberOr(exit.remainingShares) : numberOr(entry?.shares);
  const cash = exit ? numberOr(exit.cash) : numberOr(entry?.cash);
  const nav = numberOr(currentNav);
  const holdingValue = nav > 0 ? shares * nav : 0;
  const totalAssets = cash + holdingValue;
  const realizedAmount = numberOr(exit?.cumulativeAmount);
  const profit = totalAssets - invested;
  const profitRate = invested > 0 ? profit / invested : 0;
  const points = [...equityHistory, ...entryRows, ...exitRows]
    .map((row) => ({ date: row?.recordedAt || row?.date || '', totalAssets: row?.totalAssets }))
    .filter((row) => hasNumericValue(row.totalAssets) && numberOr(row.totalAssets) >= 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  points.push({ date: 'current', totalAssets });
  let highWater = 0;
  let maxDrawdown = 0;
  for (const point of points) {
    highWater = Math.max(highWater, point.totalAssets);
    if (highWater > 0) maxDrawdown = Math.min(maxDrawdown, point.totalAssets / highWater - 1);
  }
  return { invested, realizedAmount, shares, cash, holdingValue, totalAssets, profit, profitRate, maxDrawdown };
}

export function calculateRiskSignals({ fundDailyChange = null, benchmarkChange = null, maxDrawdown = 0, rules = DEFAULT_RISK_RULES } = {}) {
  const signals = [];
  if (Number.isFinite(fundDailyChange)) {
    if (fundDailyChange <= rules.fundDownStop) signals.push({ id: 'fund-down-stop', level: 'danger', source: '基金', action: '暂停补仓', message: '基金日跌幅达到强风控线' });
    else if (fundDailyChange <= rules.fundDownEntry) signals.push({ id: 'fund-down-entry', level: 'warning', source: '基金', action: '建议补仓', message: '基金日跌幅达到补仓线' });
    else if (fundDailyChange <= rules.fundDownWatch) signals.push({ id: 'fund-down-watch', level: 'watch', source: '基金', action: '观察', message: '基金日跌幅进入观察区' });
    else if (fundDailyChange >= rules.fundUpStrong) signals.push({ id: 'fund-up-strong', level: 'danger', source: '基金', action: '分批出仓', message: '基金日涨幅达到强提醒线' });
    else if (fundDailyChange >= rules.fundUpExit) signals.push({ id: 'fund-up-exit', level: 'warning', source: '基金', action: '建议出仓', message: '基金日涨幅达到出仓线' });
    else if (fundDailyChange >= rules.fundUpWatch) signals.push({ id: 'fund-up-watch', level: 'watch', source: '基金', action: '观察', message: '基金日涨幅进入观察区' });
  }
  if (Number.isFinite(benchmarkChange) && (benchmarkChange <= rules.fundDownEntry || benchmarkChange >= rules.fundUpExit))
    signals.push({ id: 'benchmark', level: 'index', source: '业绩基准指数', action: '指数预警', message: '指数达到预警线，基金净值待更新' });
  if (Number.isFinite(maxDrawdown) && maxDrawdown <= rules.drawdownStop)
    signals.push({ id: 'drawdown-stop', level: 'danger', source: '账户回撤', action: '暂停补仓', message: '最大回撤达到暂停线' });
  else if (Number.isFinite(maxDrawdown) && maxDrawdown <= rules.drawdownWarn)
    signals.push({ id: 'drawdown-warn', level: 'warning', source: '账户回撤', action: '风险提醒', message: '最大回撤达到提醒线' });
  return signals;
}
