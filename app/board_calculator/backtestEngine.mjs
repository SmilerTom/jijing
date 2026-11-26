/**
 * 均线带回测引擎：底仓 + 机动仓分批买卖、买回规则、趋势过滤、回撤止损、现金计息，
 * 以及按样本内 / 样本外稳健寻优。纯函数，无浏览器依赖。
 * 基金数据：{ dates: string[], nav: number[]（分红复权）, tiers: [minDays, maxDays|null, rate][], buyFee }
 */
const DAY = 86400000;
const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / DAY;

export const DEFAULTS = {
  n: 10, // 均线周期（交易日）
  trigger: 'ma', // 触发：ma 偏离 N 日均线 | last 相对上次成交价 | day 当日涨跌幅
  direction: 'revert', // revert 逆势：上轨卖、下轨买回 | trend 顺势：上轨买入、下轨卖出
  sell: 5, // 上轨：高于均线多少 %（逆势卖出 / 顺势买入）
  buy: 5, // 下轨：低于均线多少 %（逆势买回 / 顺势卖出）
  core: 70, // 底仓比例 %
  batch: 0.2, // 每次交易金额 = 初始机动仓 × 该比例；≥1 表示一次卖出全部机动仓 / 用完全部现金
  interval: 0, // 两次带内交易之间至少间隔的日历天
  buyback: 'lower', // lower 跌到下轨买回 | ma 回到均线买回 | timeout 下轨或卖出后超时买回
  timeoutDays: 60,
  trend: false, // 趋势过滤：均线向上时不卖出
  trendLookback: 20,
  stop: 0, // 风控：从跟踪高点回落多少 % 清仓（含底仓），0 = 关
  cashYield: 0, // 现金年化收益 %
  riskFree: 2 // 夏普比率用的无风险利率 %
};

export function prepare(fund) {
  const dates = fund.dates;
  const nav = fund.nav;
  const day = dates.map(dayNum);
  const prefix = new Float64Array(nav.length + 1);
  for (let i = 0; i < nav.length; i += 1) prefix[i + 1] = prefix[i] + nav[i];
  const maCache = new Map();
  const ma = (n) => {
    if (!maCache.has(n)) {
      const out = new Float64Array(nav.length).fill(NaN);
      for (let i = n - 1; i < nav.length; i += 1) out[i] = (prefix[i + 1] - prefix[i + 1 - n]) / n;
      maCache.set(n, out);
    }
    return maCache.get(n);
  };
  return { ...fund, day, ma };
}

export function feeRate(tiers, days) {
  for (const [lo, hi, rate] of tiers) if (days >= lo && (hi === null || days < hi)) return rate;
  return 0;
}

/**
 * 在 [from, to] 区间回放。返回资金曲线、交易记录和指标。
 * 资金按 capital 计；底仓始终持有（触发风控清仓除外），机动仓按信号分批交易。
 */
/**
 * 触发判断：返回今天是否到达上轨 / 下轨，以及当前指标值（%）。
 * ma：偏离 N 日均线；last：相对上次成交价；day：相对昨天净值（当日涨跌幅）。
 */
export function triggerHits(p, price, ma, ref, prevNav) {
  const base = p.trigger === 'last' ? ref : p.trigger === 'day' ? prevNav : ma;
  if (!(base > 0)) return { hitUp: false, hitDown: false, metric: NaN, base };
  const metric = (price / base - 1) * 100;
  return { hitUp: metric >= p.sell, hitDown: metric <= -p.buy, metric, base };
}

export function simulate(data, input, { from = 0, to = data.nav.length - 1, capital = 10000, record = true } = {}) {
  const p = { ...DEFAULTS, ...input };
  const ma = data.ma(p.n);
  const follow = p.direction === 'trend';
  const start = Math.max(from, p.n - 1 + (p.trend && !follow ? p.trendLookback : 0));
  if (to - start < 2) return null;
  const { nav, day, dates, tiers } = data;
  const buyFee = data.buyFee || 0;
  const core = Math.min(1, Math.max(0, p.core / 100));
  const step = capital * (1 - core) * p.batch;
  const yieldDaily = p.cashYield / 100 / 365;

  // 批次：[买入日序号, 份额, 每份成本]；底仓和机动仓分开记
  let coreLots = [[day[start] - 3650, (capital * core) / nav[start], nav[start]]];
  let sleeveLots = [[day[start] - 3650, (capital * (1 - core)) / nav[start], nav[start]]];
  let realized = 0;
  let cash = 0;
  let fees = 0;
  let trades = 0;
  let lastTradeDay = -Infinity;
  let ref = nav[start]; // 上次成交价（trigger = last 时的基准）
  let lastSellDay = null;
  let stopped = false;
  let peak = nav[start];
  let cashDays = 0;
  let exposureSum = 0;
  let prevDay = day[start];
  const curve = record ? new Float64Array(to - start + 1) : null;
  const log = record ? [] : null;
  const values = new Float64Array(to - start + 1);

  const shares = (lots) => lots.reduce((s, l) => s + l[1], 0);
  const sellFrom = (lots, d, price, value) => {
    let want = Math.min(value / price, shares(lots));
    let gross = 0;
    let fee = 0;
    let basis = 0;
    while (want > 1e-12 && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot[1], want);
      gross += take * price;
      basis += take * lot[2];
      fee += take * price * feeRate(tiers, d - lot[0]);
      lot[1] -= take;
      want -= take;
      if (lot[1] <= 1e-12) lots.shift();
    }
    return [gross, fee, basis];
  };
  const note = (i, type, amount, fee, pnl = null, basis = null) => {
    trades += 1;
    if (pnl !== null) realized += pnl;
    if (!log) return;
    const total = (shares(coreLots) + shares(sleeveLots)) * nav[i] + cash;
    log.push({
      i,
      d: dates[i],
      type,
      nav: nav[i],
      dev: (nav[i] / ma[i] - 1) * 100,
      amount,
      fee,
      core: shares(coreLots) * nav[i],
      sleeve: shares(sleeveLots) * nav[i],
      cash,
      total,
      pnl,
      pnlRate: pnl !== null && basis > 0 ? (pnl / basis) * 100 : null,
      realized,
      totalReturn: (total / capital - 1) * 100
    });
  };

  for (let i = start; i <= to; i += 1) {
    const d = day[i];
    const price = nav[i];
    if (cash > 0) cash *= 1 + yieldDaily * (d - prevDay);
    prevDay = d;
    const m = ma[i];

    if (p.stop > 0) {
      if (!stopped) {
        peak = Math.max(peak, price);
        if (price <= peak * (1 - p.stop / 100)) {
          const [g1, f1, b1] = sellFrom(coreLots, d, price, Infinity);
          const [g2, f2, b2] = sellFrom(sleeveLots, d, price, Infinity);
          cash += g1 + g2 - f1 - f2;
          fees += f1 + f2;
          stopped = true;
          note(i, 'stop', g1 + g2, f1 + f2, g1 + g2 - f1 - f2 - b1 - b2, b1 + b2);
        }
      } else if (price > m) {
        const total = cash;
        const fee = total * buyFee;
        fees += fee;
        const investable = total - fee;
        const unitCost = total / (investable / price);
        coreLots = [[d, (investable * core) / price, unitCost]];
        sleeveLots = [[d, (investable * (1 - core)) / price, unitCost]];
        cash = 0;
        stopped = false;
        peak = price;
        lastTradeDay = d;
        lastSellDay = null;
        ref = price;
        note(i, 'reenter', total, fee);
      }
    }

    if (!stopped && d - lastTradeDay >= p.interval) {
      const { hitUp, hitDown } = triggerHits(p, price, m, ref, nav[i - 1]);
      const rising = !follow && p.trend && ma[i - p.trendLookback] > 0 && m > ma[i - p.trendLookback];
      const sleeveShares = shares(sleeveLots);
      // 顺势：跌破下轨卖、站上上轨买；逆势：上轨卖、按买回规则买
      const sellNow = follow ? hitDown : hitUp && !rising;
      if (sellNow && sleeveShares > 1e-12) {
        const [gross, fee, basis] = sellFrom(sleeveLots, d, price, p.batch >= 1 ? Infinity : step);
        cash += gross - fee;
        fees += fee;
        lastTradeDay = d;
        lastSellDay = d;
        ref = price;
        note(i, 'sell', gross, fee, gross - fee - basis, basis);
      } else if (cash > 1e-9) {
        const useBuyback = p.trigger === 'ma' || !p.trigger;
        const trigger = follow
          ? hitUp
          : useBuyback && p.buyback === 'ma'
            ? price <= m
            : useBuyback && p.buyback === 'timeout'
              ? hitDown || (lastSellDay !== null && d - lastSellDay >= p.timeoutDays)
              : hitDown;
        if (trigger) {
          const spend = p.batch >= 1 ? cash : Math.min(step, cash);
          const fee = spend * buyFee;
          cash -= spend;
          fees += fee;
          sleeveLots.push([d, (spend - fee) / price, spend / ((spend - fee) / price)]);
          lastTradeDay = d;
          ref = price;
          if (cash <= 1e-9) lastSellDay = null;
          note(i, 'buy', spend, fee);
        }
      }
    }

    // 相对上次成交价：机动仓卖光后基准随上涨抬高（回落 buy% 才买回），没有现金时基准随下跌降低（反弹 sell% 才卖），
    // 避免卖光后一路上涨永远买不回、满仓后一路下跌永远卖不出
    if (p.trigger === 'last' && !stopped) {
      if (shares(sleeveLots) <= 1e-12 && price > ref) ref = price;
      else if (cash <= 1e-9 && price < ref) ref = price;
    }

    const value = (shares(coreLots) + shares(sleeveLots)) * price + cash;
    if (cash > capital * 1e-6) cashDays += 1;
    exposureSum += value > 0 ? (value - cash) / value : 0;
    values[i - start] = value;
    if (curve) curve[i - start] = value;
  }

  const holdCurve = record ? new Float64Array(to - start + 1) : null;
  if (holdCurve) for (let i = start; i <= to; i += 1) holdCurve[i - start] = (capital * nav[i]) / nav[start];

  const lastPrice = nav[to];
  return {
    start,
    end: to,
    curve,
    holdCurve,
    log,
    // 回放结束时的状态，供“今日信号”解释原因
    final: {
      ref,
      stopped,
      peak,
      lastTradeDay,
      lastSellDay,
      coreValue: shares(coreLots) * lastPrice,
      sleeveValue: shares(sleeveLots) * lastPrice,
      cash,
      total: (shares(coreLots) + shares(sleeveLots)) * lastPrice + cash
    },
    stats: {
      ...metrics(values, day, start, to, p.riskFree, fees, trades, cashDays, capital),
      exposure: (exposureSum / (to - start + 1)) * 100
    },
    hold: metrics(
      Float64Array.from({ length: to - start + 1 }, (_, k) => (capital * nav[start + k]) / nav[start]),
      day,
      start,
      to,
      p.riskFree,
      0,
      0,
      0,
      capital
    )
  };
}

function metrics(values, day, start, to, riskFree, fees, trades, cashDays, capital) {
  const n = values.length;
  const total = values[n - 1] / values[0] - 1;
  const days = day[to] - day[start];
  const annual = days > 0 && total > -1 ? (1 + total) ** (365 / days) - 1 : NaN;
  let peak = values[0];
  let dd = 0;
  let peakAt = 0;
  let ddFrom = 0;
  let ddTo = 0;
  let sum = 0;
  let sum2 = 0;
  for (let k = 0; k < n; k += 1) {
    if (values[k] > peak) {
      peak = values[k];
      peakAt = k;
    }
    const cur = 1 - values[k] / peak;
    if (cur > dd) {
      dd = cur;
      ddFrom = peakAt;
      ddTo = k;
    }
    if (k > 0) {
      const r = values[k] / values[k - 1] - 1;
      sum += r;
      sum2 += r * r;
    }
  }
  const m = n > 1 ? sum / (n - 1) : 0;
  const vol = n > 2 ? Math.sqrt(Math.max(0, (sum2 - (n - 1) * m * m) / (n - 2))) * Math.sqrt(250) : NaN;
  return {
    total: total * 100,
    annual: annual * 100,
    dd: dd * 100,
    ddFrom: start + ddFrom,
    ddTo: start + ddTo,
    vol: vol * 100,
    sharpe: vol > 0 ? (annual - riskFree / 100) / vol : NaN,
    calmar: dd > 0 ? annual / dd : NaN,
    fees: (fees / capital) * 100,
    trades,
    cashShare: (cashDays / n) * 100,
    endValue: values[n - 1]
  };
}

export const GRID = {
  n: [5, 10, 20, 60, 120, 250],
  sell: [3, 5, 8, 10, 15, 20, 25],
  buy: [3, 5, 8, 10, 15],
  batch: [1, 0.5, 0.2],
  interval: [0],
  buyback: ['lower', 'ma'],
  trend: [false, true],
  core: [0, 50, 70]
};

/** 每日交易：三种触发方式都试——偏离 5/10/20 日均线（逆势+顺势）、相对上次成交价、当日涨跌幅；分批、不设间隔 */
export const DAILY_GRID = {
  n: [5, 10, 20],
  sell: [1, 2, 3, 5, 8],
  buy: [1, 2, 3, 5, 8],
  lastSteps: [2, 3, 5, 8, 10, 15],
  daySteps: [1, 1.5, 2, 3, 4, 5],
  batch: [1, 0.5, 0.2, 0.1],
  core: [0, 30, 50, 70]
};

function* combos(fixed, mode = 'all') {
  if (mode === 'daily') {
    const G = DAILY_GRID;
    const base = { ...fixed, interval: 0, buyback: 'lower' };
    for (const direction of ['revert', 'trend'])
      for (const n of G.n)
        for (const sell of G.sell)
          for (const buy of G.buy)
            for (const batch of G.batch)
              for (const trend of direction === 'revert' ? [false, true] : [false])
                for (const core of G.core)
                  yield { ...base, trigger: 'ma', direction, n, sell, buy, batch, trend, core };
    for (const [trigger, steps] of [
      ['last', G.lastSteps],
      ['day', G.daySteps]
    ])
      for (const sell of steps)
        for (const buy of steps)
          for (const batch of G.batch)
            for (const trend of [false, true])
              for (const core of G.core)
                yield { ...base, trigger, direction: 'revert', n: 20, sell, buy, batch, trend, core };
    return;
  }
  for (const n of GRID.n)
    for (const sell of GRID.sell)
      for (const buy of GRID.buy)
        for (const batch of GRID.batch)
          for (const interval of GRID.interval)
            for (const buyback of GRID.buyback)
              for (const trend of GRID.trend)
                for (const core of GRID.core)
                  yield {
                    ...fixed,
                    trigger: 'ma',
                    direction: 'revert',
                    n,
                    sell,
                    buy,
                    batch,
                    interval,
                    buyback,
                    trend,
                    core
                  };
}
const DAILY_COUNT = (() => {
  const G = DAILY_GRID;
  const per = G.n.length * G.sell.length * G.buy.length * G.batch.length * G.core.length;
  const ma = per * 2 + per; // 逆势含趋势过滤开/关，顺势不需要
  const other = (G.lastSteps.length ** 2 + G.daySteps.length ** 2) * G.batch.length * G.core.length * 2;
  return ma + other;
})();
export const comboCount = (mode = 'all') =>
  mode === 'daily' ? DAILY_COUNT : Object.values(GRID).reduce((a, list) => a * list.length, 1);

function score(stats, objective, ddLimit) {
  if (!stats || !Number.isFinite(stats.annual)) return -Infinity;
  if (objective === 'calmar') return Number.isFinite(stats.calmar) ? stats.calmar : -Infinity;
  if (objective === 'sharpe') return Number.isFinite(stats.sharpe) ? stats.sharpe : -Infinity;
  if (objective === 'capped') return stats.dd <= ddLimit ? stats.annual : -Infinity;
  return stats.annual;
}

/** 分块寻优：每次 yield 进度；在样本内排序，取前 topN 再算样本外 */
export function* optimize(
  data,
  fixed,
  { objective = 'calmar', ddLimit = 30, split = 0.7, from = 0, to = data.nav.length - 1, topN = 12 } = {}
) {
  const mid = from + Math.floor((to - from) * split);
  const total = comboCount();
  const best = [];
  let done = 0;
  for (const params of combos(fixed)) {
    const result = simulate(data, params, { from, to: mid, record: false });
    done += 1;
    if (result) {
      const s = score(result.stats, objective, ddLimit);
      if (s > -Infinity && (best.length < topN || s > best[best.length - 1].score)) {
        best.push({ params, score: s, inSample: result.stats, holdIn: result.hold });
        best.sort((a, b) => b.score - a.score);
        if (best.length > topN) best.pop();
      }
    }
    if (done % 400 === 0) yield { done, total };
  }
  for (const item of best) {
    const out = simulate(data, item.params, { from: mid, to, record: false });
    item.outSample = out ? out.stats : null;
    item.holdOut = out ? out.hold : null;
  }
  yield { done: total, total, best, mid };
}

export const ROBUST_STOPS = [0, 15, 25];
export const robustComboCount = (mode = 'all') => comboCount(mode) * ROBUST_STOPS.length;

/**
 * 稳健寻优（前段选参、后段检验）：只用样本内（前 split）挑参数——平均仓位不低于 minExposure，
 * 按样本内卡玛比率排序取前 topN；样本外（后段）只回放这些参数用于检验，不参与排序，
 * 避免选参时偷看后段。每处理一批 yield 进度；最后一次 yield 带上 best。
 */
export function* optimizeRobust(
  data,
  fixed = {},
  { split = 0.7, from = 0, to = data.nav.length - 1, minExposure = 60, topN = 5, mode = 'all' } = {}
) {
  const mid = from + Math.floor((to - from) * split);
  const total = robustComboCount(mode);
  const best = [];
  let done = 0;
  for (const stop of ROBUST_STOPS) {
    for (const params of combos({ ...fixed, stop }, mode)) {
      done += 1;
      if (params.n > (mid - from) * 0.5) continue;
      const a = simulate(data, params, { from, to: mid, record: false });
      if (a && a.stats.exposure >= minExposure) {
        const score = a.stats.calmar;
        // 前段成绩完全相同的参数（买卖点一样，只是没触发的条件不同）只保留第一组
        const same = (item) =>
          item.inSample.total === a.stats.total &&
          item.inSample.dd === a.stats.dd &&
          item.inSample.trades === a.stats.trades;
        if (Number.isFinite(score) && (best.length < topN || score > best[best.length - 1].score) && !best.some(same)) {
          best.push({ params, score, inSample: a.stats, holdIn: a.hold });
          best.sort((x, y) => y.score - x.score);
          if (best.length > topN) best.pop();
        }
      }
      if (done % 300 === 0) yield { done, total };
    }
  }
  for (const item of best) {
    const b = simulate(data, item.params, { from: mid, to, record: false });
    item.outSample = b ? b.stats : null;
    item.holdOut = b ? b.hold : null;
  }
  yield { done: total, total, best, mid };
}

/**
 * 今日信号：把今天的估值（或最新正式净值）作为最后一个点接到历史后面，
 * 用同一套规则回放，看今天这一点会不会触发交易，并给出判断依据。
 * quote: { date, nav, estimated }；quote.date 已在历史里时直接评估最后一天。
 */
export function todaySignal(fund, params, quote, { from = 0, capital = 10000 } = {}) {
  if (!fund?.dates?.length || !(quote?.nav > 0) || !quote?.date) return null;
  const lastDate = fund.dates.at(-1);
  const appended = quote.date > lastDate;
  const data = appended
    ? prepare({ ...fund, dates: [...fund.dates, quote.date], nav: [...fund.nav, quote.nav] })
    : fund;
  const p = { ...DEFAULTS, ...params };
  const idx = appended ? data.nav.length - 1 : data.dates.lastIndexOf(quote.date);
  if (idx < 0) return null;
  const before = idx - 1 >= from ? simulate(data, p, { from, to: idx - 1, capital }) : null;
  const now = simulate(data, p, { from, to: idx, capital });
  if (!now || !before) return null;
  const trades = now.log.filter((t) => t.i === idx);
  const state = before.final;
  const ma = data.ma(p.n)[idx];
  const price = data.nav[idx];
  const { metric, base } = triggerHits(p, data.nav[idx], ma, state.ref, data.nav[idx - 1]);
  const upper = base * (1 + p.sell / 100);
  const lower = base * (1 - p.buy / 100);
  const day = data.day[idx];
  const sinceTrade = Number.isFinite(state.lastTradeDay) ? day - state.lastTradeDay : null;
  const lookback = data.ma(p.n)[idx - p.trendLookback];
  const total = state.total || capital;
  return {
    date: quote.date,
    estimated: Boolean(quote.estimated),
    appended,
    price,
    ma,
    upper,
    lower,
    deviation: (price / ma - 1) * 100,
    trigger: p.trigger === 'last' || p.trigger === 'day' ? p.trigger : 'ma',
    metric,
    base,
    toUpper: (upper / price - 1) * 100,
    toLower: (lower / price - 1) * 100,
    // 成交金额占今天组合市值的比例，用来换算成真实持仓的建议金额
    trades: trades.map((t) => ({
      type: t.type,
      amount: t.amount,
      share: t.amount / t.total,
      pnl: t.pnl,
      pnlRate: t.pnlRate
    })),
    waitDays: sinceTrade !== null && sinceTrade < p.interval ? p.interval - sinceTrade : 0,
    direction: p.direction === 'trend' ? 'trend' : 'revert',
    trendBlocks: Boolean(p.direction !== 'trend' && p.trend && lookback > 0 && ma > lookback),
    outlook: similarOutlook(data, idx, p.trigger === 'day' ? 'day' : p.n),
    stopLine: p.stop > 0 && !state.stopped ? Math.max(state.peak, price) * (1 - p.stop / 100) : null,
    state: {
      stopped: state.stopped,
      coreShare: state.coreValue / total,
      sleeveShare: state.sleeveValue / total,
      cashShare: state.cash / total
    }
  };
}

const HORIZONS = [1, 5, 20];
const quantile = (sorted, q) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  return {
    count: values.length,
    mean,
    upRate: values.length ? (values.filter((v) => v > 0).length / values.length) * 100 : NaN,
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75)
  };
};

/**
 * 历史同类情况：在 idx 之前的历史里，找偏离 n 日均线最接近今天的交易日（取最近邻 max(30, 15%) 个），
 * 统计它们之后 1/5/20 个交易日的涨跌（均值、上涨概率、四分位区间），并给出全部交易日的基准作对比。
 * 只用 idx 之前已经完整走完的样本，不偷看未来。
 */
export function similarOutlook(data, idx, n) {
  const nav = data.nav;
  // n = 'day' 时按当日涨跌幅找同类日子，否则按偏离 n 日均线
  const ma = n === 'day' ? null : data.ma(n);
  const value = (j) =>
    ma ? (ma[j] > 0 ? (nav[j] / ma[j] - 1) * 100 : NaN) : j > 0 ? (nav[j] / nav[j - 1] - 1) * 100 : NaN;
  const today = value(idx);
  if (!Number.isFinite(today)) return null;
  const points = [];
  for (let j = ma ? n - 1 : 1; j < idx; j += 1) {
    const dev = value(j);
    if (Number.isFinite(dev)) points.push({ j, dev });
  }
  if (points.length < 40) return null;
  const k = Math.max(30, Math.round(points.length * 0.15));
  const near = [...points].sort((a, b) => Math.abs(a.dev - today) - Math.abs(b.dev - today)).slice(0, k);
  const result = {
    kind: ma ? 'ma' : 'day',
    deviation: today,
    neighbors: near.length,
    devLow: Infinity,
    devHigh: -Infinity,
    horizons: {}
  };
  near.forEach(({ dev }) => {
    result.devLow = Math.min(result.devLow, dev);
    result.devHigh = Math.max(result.devHigh, dev);
  });
  for (const h of HORIZONS) {
    const fwd = (list) => list.filter(({ j }) => j + h <= idx - 1).map(({ j }) => (nav[j + h] / nav[j] - 1) * 100);
    const similar = summarize(fwd(near));
    const base = summarize(fwd(points));
    if (similar.count < 15) continue;
    result.horizons[h] = { similar, base, edge: similar.mean - base.mean };
  }
  return Object.keys(result.horizons).length ? result : null;
}
