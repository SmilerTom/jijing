/**
 * 均线带回测引擎：底仓 + 机动仓分批买卖、买回规则、趋势过滤、回撤止损、现金计息，
 * 以及按样本内 / 样本外稳健寻优。纯函数，无浏览器依赖。
 * 基金数据：{ dates: string[], nav: number[]（分红复权）, tiers: [minDays, maxDays|null, rate][], buyFee }
 */
const DAY = 86400000;
const dayNum = (iso) => Date.parse(iso + 'T00:00:00Z') / DAY;

export const DEFAULTS = {
  n: 10, // 均线周期（交易日）
  sell: 5, // 高于均线多少 % 卖出
  buy: 5, // 低于均线多少 % 买回
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
export function simulate(data, input, { from = 0, to = data.nav.length - 1, capital = 10000, record = true } = {}) {
  const p = { ...DEFAULTS, ...input };
  const ma = data.ma(p.n);
  const start = Math.max(from, p.n - 1 + (p.trend ? p.trendLookback : 0));
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
        note(i, 'reenter', total, fee);
      }
    }

    if (!stopped && d - lastTradeDay >= p.interval) {
      const upper = m * (1 + p.sell / 100);
      const lower = m * (1 - p.buy / 100);
      const rising = p.trend && ma[i - p.trendLookback] > 0 && m > ma[i - p.trendLookback];
      const sleeveShares = shares(sleeveLots);
      if (price >= upper && sleeveShares > 1e-12 && !rising) {
        const [gross, fee, basis] = sellFrom(sleeveLots, d, price, p.batch >= 1 ? Infinity : step);
        cash += gross - fee;
        fees += fee;
        lastTradeDay = d;
        lastSellDay = d;
        note(i, 'sell', gross, fee, gross - fee - basis, basis);
      } else if (cash > 1e-9) {
        const trigger =
          p.buyback === 'ma'
            ? price <= m
            : p.buyback === 'timeout'
              ? price <= lower || (lastSellDay !== null && d - lastSellDay >= p.timeoutDays)
              : price <= lower;
        if (trigger) {
          const spend = p.batch >= 1 ? cash : Math.min(step, cash);
          const fee = spend * buyFee;
          cash -= spend;
          fees += fee;
          sleeveLots.push([d, (spend - fee) / price, spend / ((spend - fee) / price)]);
          lastTradeDay = d;
          if (cash <= 1e-9) lastSellDay = null;
          note(i, 'buy', spend, fee);
        }
      }
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
  interval: [0, 30],
  buyback: ['lower', 'ma'],
  trend: [false, true],
  core: [0, 50, 70]
};

function* combos(fixed) {
  for (const n of GRID.n)
    for (const sell of GRID.sell)
      for (const buy of GRID.buy)
        for (const batch of GRID.batch)
          for (const interval of GRID.interval)
            for (const buyback of GRID.buyback)
              for (const trend of GRID.trend)
                for (const core of GRID.core) yield { ...fixed, n, sell, buy, batch, interval, buyback, trend, core };
}
export const comboCount = () => Object.values(GRID).reduce((a, list) => a * list.length, 1);

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
export const robustComboCount = () => comboCount() * ROBUST_STOPS.length;

/**
 * 稳健寻优（前段选参、后段检验）：只用样本内（前 split）挑参数——平均仓位不低于 minExposure，
 * 按样本内卡玛比率排序取前 topN；样本外（后段）只回放这些参数用于检验，不参与排序，
 * 避免选参时偷看后段。每处理一批 yield 进度；最后一次 yield 带上 best。
 */
export function* optimizeRobust(
  data,
  fixed = {},
  { split = 0.7, from = 0, to = data.nav.length - 1, minExposure = 60, topN = 5 } = {}
) {
  const mid = from + Math.floor((to - from) * split);
  const total = robustComboCount();
  const best = [];
  let done = 0;
  for (const stop of ROBUST_STOPS) {
    for (const params of combos({ ...fixed, stop })) {
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
  const upper = ma * (1 + p.sell / 100);
  const lower = ma * (1 - p.buy / 100);
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
    trendBlocks: Boolean(p.trend && lookback > 0 && ma > lookback),
    stopLine: p.stop > 0 && !state.stopped ? Math.max(state.peak, price) * (1 - p.stop / 100) : null,
    state: {
      stopped: state.stopped,
      coreShare: state.coreValue / total,
      sleeveShare: state.sleeveValue / total,
      cashShare: state.cash / total
    }
  };
}
