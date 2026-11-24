import lodash from 'lodash';

const { isArray, isString } = lodash;

export const RISK_FREE_RATE = 0.02;
export const TRADING_DAYS = 250;
export const PERIODS = [
  ['1m', '近1月'],
  ['3m', '近3月'],
  ['6m', '近6月'],
  ['1y', '近1年'],
  ['3y', '近3年'],
  ['ytd', '今年'],
  ['all', '全部']
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const shiftDate = (date, { months = 0, years = 0 }) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years, d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const std = (values) => {
  if (values.length < 2) return NaN;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
};

/** 净值历史 → 按日期升序的分红复权序列（用日涨跌幅还原，缩放到最新单位净值） */
export function toAdjustedSeries(history = []) {
  if (!isArray(history)) return [];
  const byDate = new Map();
  history.forEach((item) => {
    const nav = Number(item?.unitNetValue ?? item?.value);
    if (isString(item?.date) && DATE.test(item.date) && nav > 0) byDate.set(item.date, item);
  });
  const dates = [...byDate.keys()].sort();
  let adjusted = 0;
  let previous = 0;
  const rows = dates.map((date) => {
    const item = byDate.get(date);
    const nav = Number(item.unitNetValue ?? item.value);
    const reported =
      item.equityReturn === null || item.equityReturn === '' || item.equityReturn === undefined
        ? NaN
        : Number(item.equityReturn);
    adjusted = !adjusted
      ? nav
      : Number.isFinite(reported)
        ? adjusted * (1 + reported / 100)
        : adjusted * (nav / previous);
    previous = nav;
    return { date, nav: adjusted };
  });
  const scale = rows.length ? previous / rows.at(-1).nav : 1;
  return rows.map((row) => ({ date: row.date, nav: row.nav * scale }));
}

/** 指数 K 线 → { date, nav } */
export const klinesToSeries = (klines = []) =>
  (isArray(klines) ? klines : [])
    .filter((item) => isString(item?.date) && DATE.test(item.date) && Number(item.close) > 0)
    .map((item) => ({ date: item.date, nav: Number(item.close) }));

/** 取区间：从起点前最近一个交易日开始，保证区间收益按“期初净值”计算 */
export function slicePeriod(series = [], period = '1y') {
  if (series.length < 2 || period === 'all') return series;
  const last = series.at(-1).date;
  const start =
    period === 'ytd'
      ? `${Number(last.slice(0, 4)) - 1}-12-31`
      : shiftDate(
          last,
          {
            '1m': { months: -1 },
            '3m': { months: -3 },
            '6m': { months: -6 },
            '1y': { years: -1 },
            '3y': { years: -3 }
          }[period] || { years: -1 }
        );
  if (series[0].date > start) return null;
  let index = series.findIndex((row) => row.date > start);
  if (index === -1) return series.slice(-1);
  index = Math.max(0, index - 1);
  return series.slice(index);
}

export const dailyReturns = (series) => series.slice(1).map((row, index) => row.nav / series[index].nav - 1);

/** 最大回撤及恢复情况；depth 为正数百分比 */
export function maxDrawdown(series = []) {
  let peak = series[0];
  let worst = { depth: 0, peakDate: series[0]?.date ?? null, troughDate: series[0]?.date ?? null, recoveryDate: null };
  let candidate = null;
  series.forEach((row) => {
    if (row.nav >= peak.nav) {
      if (candidate && !candidate.recoveryDate) candidate.recoveryDate = row.date;
      peak = row;
      return;
    }
    const depth = (1 - row.nav / peak.nav) * 100;
    if (depth > worst.depth) {
      worst = { depth, peakDate: peak.date, troughDate: row.date, recoveryDate: null };
      candidate = worst;
    }
  });
  const recoveryDays =
    worst.recoveryDate && worst.troughDate ? dayNumber(worst.recoveryDate) - dayNumber(worst.troughDate) : null;
  return { ...worst, recoveryDays };
}

const annualize = (total, days) => (days > 0 && total > -1 ? ((1 + total) ** (365 / days) - 1) * 100 : NaN);

/** 区间业绩与风险；benchmark 可缺省 */
export function computeMetrics(series, benchmark = [], { riskFree = RISK_FREE_RATE } = {}) {
  if (!isArray(series) || series.length < 2) return null;
  const first = series[0];
  const last = series.at(-1);
  const days = dayNumber(last.date) - dayNumber(first.date);
  const total = last.nav / first.nav - 1;
  const returns = dailyReturns(series);
  const vol = std(returns) * Math.sqrt(TRADING_DAYS);
  const annual = annualize(total, days);
  const dailyRf = riskFree / TRADING_DAYS;
  const downside =
    Math.sqrt(
      returns.reduce((sum, value) => sum + Math.min(0, value - dailyRf) ** 2, 0) / Math.max(1, returns.length)
    ) * Math.sqrt(TRADING_DAYS);
  const drawdown = maxDrawdown(series);
  const metrics = {
    start: first.date,
    end: last.date,
    days,
    samples: returns.length,
    totalReturn: total * 100,
    annualReturn: annual,
    volatility: vol * 100,
    sharpe: vol > 0 ? (annual / 100 - riskFree) / vol : NaN,
    sortino: downside > 0 ? (annual / 100 - riskFree) / downside : NaN,
    maxDrawdown: drawdown.depth,
    drawdown,
    calmar: drawdown.depth > 0 ? annual / drawdown.depth : NaN,
    benchmark: null
  };
  const benchByDate = new Map((benchmark || []).map((row) => [row.date, row.nav]));
  const aligned = series.filter((row) => benchByDate.has(row.date));
  if (aligned.length >= 2 && aligned[0].date === first.date) {
    const fundRet = [];
    const benchRet = [];
    for (let index = 1; index < aligned.length; index += 1) {
      fundRet.push(aligned[index].nav / aligned[index - 1].nav - 1);
      benchRet.push(benchByDate.get(aligned[index].date) / benchByDate.get(aligned[index - 1].date) - 1);
    }
    const benchTotal = benchByDate.get(aligned.at(-1).date) / benchByDate.get(aligned[0].date) - 1;
    const fundMean = mean(fundRet);
    const benchMean = mean(benchRet);
    const covariance =
      fundRet.reduce((sum, value, index) => sum + (value - fundMean) * (benchRet[index] - benchMean), 0) /
      Math.max(1, fundRet.length - 1);
    const benchVar = std(benchRet) ** 2;
    const active = fundRet.map((value, index) => value - benchRet[index]);
    const tracking = std(active) * Math.sqrt(TRADING_DAYS);
    const benchAnnual = annualize(benchTotal, days);
    metrics.benchmark = {
      totalReturn: benchTotal * 100,
      excessReturn: (total - benchTotal) * 100,
      beta: benchVar > 0 ? covariance / benchVar : NaN,
      trackingError: tracking * 100,
      infoRatio: tracking > 0 ? (annual - benchAnnual) / 100 / tracking : NaN,
      winRate: (active.filter((value) => value > 0).length / active.length) * 100,
      maxDrawdown: maxDrawdown(aligned.map((row) => ({ date: row.date, nav: benchByDate.get(row.date) }))).depth
    };
  }
  return metrics;
}

/** 自然年收益（首年从第一条净值算起，末年到最新净值） */
export function calendarYearReturns(series = [], benchmark = []) {
  if (series.length < 2) return [];
  const benchByDate = new Map((benchmark || []).map((row) => [row.date, row.nav]));
  const years = [...new Set(series.map((row) => row.date.slice(0, 4)))];
  return years.map((year) => {
    const before = series.filter((row) => row.date < `${year}-01-01`).at(-1);
    const inside = series.filter((row) => row.date.startsWith(year));
    const base = before || inside[0];
    const end = inside.at(-1);
    const fund = (end.nav / base.nav - 1) * 100;
    const benchBase = benchByDate.get(base.date);
    const benchEnd = benchByDate.get(end.date);
    return {
      year,
      partial: !before || year === series.at(-1).date.slice(0, 4),
      fund,
      benchmark: benchBase && benchEnd ? (benchEnd / benchBase - 1) * 100 : null
    };
  });
}

/** 历史上最差的连续 N 个交易日 */
export function worstWindows(series = [], sizes = [5, 20, 60]) {
  return sizes
    .filter((size) => series.length > size)
    .map((size) => {
      let worst = null;
      for (let index = size; index < series.length; index += 1) {
        const change = (series[index].nav / series[index - size].nav - 1) * 100;
        if (!worst || change < worst.change)
          worst = { size, change, start: series[index - size].date, end: series[index].date };
      }
      return worst;
    });
}

/** 资金加权年化收益（XIRR）。flows: [{ date, amount }]，投入为负、取回为正，最后一笔为当前市值 */
export function xirr(flows = []) {
  const valid = flows.filter((flow) => DATE.test(flow?.date) && Number.isFinite(flow?.amount) && flow.amount !== 0);
  if (valid.length < 2 || !valid.some((f) => f.amount < 0) || !valid.some((f) => f.amount > 0)) return null;
  const t0 = dayNumber(valid[0].date);
  const npv = (rate) => valid.reduce((sum, f) => sum + f.amount / (1 + rate) ** ((dayNumber(f.date) - t0) / 365), 0);
  let low = -0.9999;
  let high = 10;
  if (npv(low) * npv(high) > 0) return null;
  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    if (npv(low) * npv(mid) <= 0) high = mid;
    else low = mid;
  }
  return ((low + high) / 2) * 100;
}

/** 按交易记录生成 XIRR 现金流：买入为投入，卖出为取回，末尾加当前市值 */
export function flowsFromTransactions(transactions = [], currentValue, today) {
  const flows = (isArray(transactions) ? transactions : [])
    .filter((tx) => !tx?.isHistoryOnly && (tx?.type === 'buy' || tx?.type === 'sell'))
    .map((tx) => ({
      date: String(tx.date || '').slice(0, 10),
      amount: (tx.type === 'buy' ? -1 : 1) * Math.abs(Number(tx.amount) || Number(tx.share) * Number(tx.price) || 0)
    }))
    .filter((flow) => DATE.test(flow.date) && flow.amount)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!flows.length || !(currentValue > 0)) return flows;
  return [...flows, { date: today, amount: currentValue }];
}

/** 两条序列按日期对齐后的日收益相关系数 */
export function correlation(a = [], b = []) {
  const byDate = new Map(b.map((row) => [row.date, row.nav]));
  const shared = a.filter((row) => byDate.has(row.date));
  if (shared.length < 21) return null;
  const x = [];
  const y = [];
  for (let index = 1; index < shared.length; index += 1) {
    x.push(shared[index].nav / shared[index - 1].nav - 1);
    y.push(byDate.get(shared[index].date) / byDate.get(shared[index - 1].date) - 1);
  }
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  x.forEach((value, index) => {
    sxy += (value - mx) * (y[index] - my);
    sxx += (value - mx) ** 2;
    syy += (y[index] - my) ** 2;
  });
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** 涨跌滚仓按当前规则回放：持有→涨到卖出线卖出→回落到买回线买回；跌破止损线后停止 */
export function replayRollingSignals(series = [], { riseRate, buyDropRate, stopDrawdown, cooldownDays = 0 }) {
  const rise = Number(riseRate) / 100;
  const drop = Number(buyDropRate) / 100;
  const stop = Number(stopDrawdown) / 100;
  if (!(rise > 0) || !(drop > 0 && drop < 1) || !(stop > 0 && stop < 1) || series.length < 2) return [];
  const signals = [];
  let phase = 'holding';
  let anchor = series[0].nav;
  let peak = series[0].nav;
  let lastDay = -Infinity;
  for (const row of series) {
    if (phase === 'stopped') break;
    peak = Math.max(peak, row.nav);
    if (dayNumber(row.date) - lastDay < Number(cooldownDays)) continue;
    let type = null;
    if (row.nav <= peak * (1 - stop)) type = phase === 'holding' ? 'stop' : null;
    if (!type && phase === 'holding' && row.nav >= anchor * (1 + rise)) type = 'sell';
    if (!type && phase === 'waitingBuy' && row.nav <= anchor * (1 - drop)) type = 'buy';
    if (!type) continue;
    signals.push({ date: row.date, nav: row.nav, type: type === 'stop' ? 'sell' : type, reason: type });
    phase = type === 'stop' ? 'stopped' : type === 'sell' ? 'waitingBuy' : 'holding';
    anchor = row.nav;
    if (type === 'buy') peak = row.nav;
    lastDay = dayNumber(row.date);
  }
  return signals;
}

/**
 * 策略对比一直持有：底仓始终持有，机动仓按信号卖出/买回，扣申购费和按持有天数的赎回费。
 * feeForDays(days) 返回赎回费率（小数），buyFee 为申购费率（小数）。
 */
export function backtestAgainstHold(
  series = [],
  signals = [],
  { corePercent = 0, buyFee = 0, feeForDays = () => 0, initialHoldDays = 3650 } = {}
) {
  if (series.length < 2) return null;
  const start = series[0];
  const core = Math.min(1, Math.max(0, Number(corePercent) / 100));
  const coreShares = core / start.nav;
  let sleeveShares = (1 - core) / start.nav;
  let cash = 0;
  let lastBuyDay = dayNumber(start.date) - initialHoldDays;
  let fees = 0;
  let cashDays = 0;
  const byDate = new Map(signals.map((signal) => [signal.date, signal]));
  const curve = series.map((row, index) => {
    const signal = byDate.get(row.date);
    if (signal?.type === 'sell' && sleeveShares > 0) {
      const gross = sleeveShares * row.nav;
      const fee = gross * (feeForDays(dayNumber(row.date) - lastBuyDay) ?? 0);
      fees += fee;
      cash = gross - fee;
      sleeveShares = 0;
    } else if (signal?.type === 'buy' && cash > 0) {
      const fee = cash * buyFee;
      fees += fee;
      sleeveShares = (cash - fee) / row.nav;
      cash = 0;
      lastBuyDay = dayNumber(row.date);
    }
    if (index > 0 && cash > 0) cashDays += 1;
    return { date: row.date, nav: (coreShares + sleeveShares) * row.nav + cash };
  });
  const hold = series.map((row) => ({ date: row.date, nav: row.nav / start.nav }));
  const strategy = computeMetrics(curve);
  const holding = computeMetrics(hold);
  return {
    curve,
    hold,
    strategy,
    holding,
    trades: signals.length,
    fees: fees * 100,
    cashShare: (cashDays / Math.max(1, series.length - 1)) * 100,
    edge: strategy.totalReturn - holding.totalReturn
  };
}
