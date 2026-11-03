import lodash from 'lodash';

const { isObject, isString } = lodash;

export const DEFAULT_STRATEGY = Object.freeze({ riseRate: 20, buyDropRate: 5, stopDrawdown: 10, cooldownDays: 3 });
const positive = (value) => value !== '' && value !== null && Number.isFinite(Number(value)) && Number(value) > 0;
export const strategyDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;

export function normalizeStrategy(saved = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_STRATEGY).map(([key, value]) => [
      key,
      saved?.[key] ?? (key === 'riseRate' ? saved?.targetRate : undefined) ?? value
    ])
  );
}

export const BAND_PERIODS = Object.freeze({
  5: { sell: 5, buy: 5, lessReturn: 0.17, winRate: 31.9, drawdown: 33.8, trades: 4 },
  10: { sell: 5, buy: 5, lessReturn: 1.27, winRate: 19.0, drawdown: 33.9, trades: 7 },
  20: { sell: 10, buy: 5, lessReturn: 0.77, winRate: 20.0, drawdown: 35.2, trades: 4 },
  60: { sell: 10, buy: 5, lessReturn: 0.86, winRate: 23.2, drawdown: 34.2, trades: 6 },
  120: { sell: 15, buy: 10, lessReturn: 0.97, winRate: 20.6, drawdown: 32.1, trades: 5 },
  250: { sell: 25, buy: 10, lessReturn: 0.11, winRate: 22.6, drawdown: 33.8, trades: 4 }
});
export const DEFAULT_BAND = Object.freeze({
  mode: 'rolling',
  bandPeriod: 250,
  bandSell: 25,
  bandBuy: 10,
  corePercent: 70,
  minHoldDays: 30
});

export function normalizeBand(saved = {}) {
  const period = Number(saved?.bandPeriod);
  return {
    mode: saved?.mode === 'band' ? 'band' : 'rolling',
    bandPeriod: BAND_PERIODS[period] ? period : DEFAULT_BAND.bandPeriod,
    bandSell: saved?.bandSell ?? DEFAULT_BAND.bandSell,
    bandBuy: saved?.bandBuy ?? DEFAULT_BAND.bandBuy,
    corePercent: saved?.corePercent ?? DEFAULT_BAND.corePercent,
    minHoldDays: saved?.minHoldDays ?? DEFAULT_BAND.minHoldDays
  };
}

const inRange = (value, min, max) => value !== '' && value !== null && Number(value) > min && Number(value) < max;
export const isBandConfigValid = ({ bandSell, bandBuy, corePercent, minHoldDays }) =>
  inRange(bandSell, 0, 200) &&
  inRange(bandBuy, 0, 90) &&
  inRange(corePercent, 0, 100) &&
  minHoldDays !== '' &&
  minHoldDays !== null &&
  Number.isInteger(Number(minHoldDays)) &&
  Number(minHoldDays) >= 0 &&
  Number(minHoldDays) <= 3650;

/** 用日涨跌幅还原分红，再缩放到最新单位净值，避免分红日的单位净值跳水被当成跌破买回线 */
export function buildBandSeries(history = [], { bandPeriod, bandSell, bandBuy }) {
  const byDate = new Map();
  (history || []).forEach((item) => {
    const nav = Number(item?.unitNetValue ?? item?.value);
    if (isString(item?.date) && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && positive(nav)) byDate.set(item.date, item);
  });
  const dates = [...byDate.keys()].sort();
  if (dates.length < bandPeriod) return [];
  let adjusted = 0;
  let previousNav = 0;
  const points = dates.map((date) => {
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
        : adjusted * (nav / previousNav);
    previousNav = nav;
    return { date, adjusted };
  });
  const scale = previousNav / adjusted;
  let sum = 0;
  return points.reduce((rows, point, index) => {
    sum += point.adjusted;
    if (index >= bandPeriod) sum -= points[index - bandPeriod].adjusted;
    if (index < bandPeriod - 1) return rows;
    const ma = (sum / bandPeriod) * scale;
    rows.push({
      date: point.date,
      nav: point.adjusted * scale,
      ma,
      upper: ma * (1 + Number(bandSell) / 100),
      lower: ma * (1 - Number(bandBuy) / 100)
    });
    return rows;
  }, []);
}

/** 按当前参数回放历史信号：从持有开始，卖出后才会买回 */
export function replayBandSignals(series = [], minHoldDays = 0) {
  let holding = true;
  let lastDay = -Infinity;
  const signals = [];
  series.forEach((row) => {
    if (dayNumber(row.date) - lastDay < Number(minHoldDays)) return;
    const type = holding && row.nav >= row.upper ? 'sell' : !holding && row.nav <= row.lower ? 'buy' : null;
    if (!type) return;
    signals.push({ ...row, type, deviation: (row.nav / row.ma - 1) * 100 });
    holding = type === 'buy';
    lastDay = dayNumber(row.date);
  });
  return signals;
}

/** 持有时当前持仓含机动仓；卖出后持仓只剩底仓，机动仓按比例估算 */
export function splitBandPosition({ amount, corePercent, phase }) {
  const value = Number(amount);
  const core = Number(corePercent) / 100;
  if (!(value > 0) || !(core > 0) || !(core < 1)) return null;
  return phase === 'waitingBuy'
    ? { core: value, sleeve: (value * (1 - core)) / core }
    : { core: value * core, sleeve: value * (1 - core) };
}

export function getStrategyQuote(fund, history = [], { preferEstimate = false, now = new Date() } = {}) {
  const quotes = history.map((item) => ({ date: item?.date, nav: Number(item?.unitNetValue ?? item?.value) }));
  quotes.push({ date: fund?.jzrq, nav: Number(fund?.dwjz) });
  const official =
    quotes
      .filter(
        (quote) =>
          isString(quote.date) &&
          /^\d{4}-\d{2}-\d{2}$/.test(quote.date) &&
          Number.isFinite(dayNumber(quote.date)) &&
          positive(quote.nav)
      )
      .sort((first, second) => first.date.localeCompare(second.date))
      .at(-1) || null;
  const time = fund?.gztime;
  if (
    !preferEstimate ||
    fund?.noValuation ||
    !positive(fund?.gsz) ||
    !isString(time) ||
    !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(time)
  )
    return official;
  const date = time.slice(0, 10);
  const instant = Date.parse(`${time.replace(' ', 'T')}+08:00`);
  if (
    date !== strategyDate(now) ||
    !Number.isFinite(instant) ||
    instant > now.getTime() ||
    (official && official.date >= date)
  )
    return official;
  return { date, nav: Number(fund.gsz), estimated: true, time };
}

export function createStrategyCycle(nav, date = strategyDate()) {
  if (!positive(nav) || !Number.isFinite(dayNumber(date))) throw new Error('请输入有效的成交净值和日期。');
  return {
    phase: 'holding',
    anchorNav: Number(nav),
    peakNav: Number(nav),
    startDate: date,
    anchorDate: date,
    lastTradeAt: null
  };
}

export function isStrategyCycle(cycle) {
  return Boolean(
    isObject(cycle) &&
    ['holding', 'waitingBuy', 'stopped'].includes(cycle.phase) &&
    positive(cycle.anchorNav) &&
    positive(cycle.peakNav) &&
    cycle.peakNav >= cycle.anchorNav &&
    isString(cycle.startDate) &&
    Number.isFinite(dayNumber(cycle.startDate)) &&
    isString(cycle.anchorDate) &&
    Number.isFinite(dayNumber(cycle.anchorDate)) &&
    cycle.anchorDate >= cycle.startDate &&
    (cycle.lastTradeAt === null || (isString(cycle.lastTradeAt) && Number.isFinite(Date.parse(cycle.lastTradeAt))))
  );
}

export function observeStrategyPeak(cycle, quote, history = []) {
  if (!isStrategyCycle(cycle)) return cycle;
  const peakNav = history.reduce((peak, item) => {
    const nav = Number(item?.unitNetValue ?? item?.value);
    return !item?.estimated && item?.date >= cycle.startDate && item?.date <= quote?.date && positive(nav)
      ? Math.max(peak, nav)
      : peak;
  }, cycle.peakNav);
  return {
    ...cycle,
    peakNav:
      !quote?.estimated && quote?.date >= cycle.startDate && positive(quote.nav)
        ? Math.max(peakNav, quote.nav)
        : peakNav
  };
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

const cooldownRemaining = (cycle, days, now) =>
  cycle.lastTradeAt === null
    ? 0
    : Math.max(0, dayNumber(strategyDate(new Date(cycle.lastTradeAt))) + Number(days) - dayNumber(strategyDate(now)));

function calculateBandState({ currentNav, quoteDate, estimated, quoteTime, cycle, strategy, history, now }) {
  const config = normalizeBand(strategy);
  const base = { mode: 'band', bandPeriod: config.bandPeriod };
  if (!isBandConfigValid(config)) return { ...base, status: 'invalid' };
  if (cycle !== null && !isStrategyCycle(cycle)) return { ...base, status: 'invalidCycle' };
  if (!cycle || !positive(currentNav) || !history) return { ...base, status: 'pending' };
  if (cycle.phase === 'stopped') return { ...base, status: 'stopped' };
  const latest = buildBandSeries(history, config).at(-1);
  if (!latest) return { ...base, status: 'insufficient' };
  if (!quoteDate || quoteDate < cycle.anchorDate || quoteDate > strategyDate(now))
    return { ...base, status: 'pending' };
  const nav = Number(currentNav);
  const upper = latest.ma * (1 + Number(config.bandSell) / 100);
  const lower = latest.ma * (1 - Number(config.bandBuy) / 100);
  const triggered =
    cycle.phase === 'holding' && nav >= upper ? 'sell' : cycle.phase === 'waitingBuy' && nav <= lower ? 'buy' : null;
  const remainingDays = cooldownRemaining(cycle, config.minHoldDays, now);
  return {
    ...base,
    status: remainingDays > 0 ? 'cooldown' : triggered || 'watch',
    triggered,
    remainingDays,
    estimated,
    quoteDate,
    quoteTime,
    phase: cycle.phase,
    nav,
    ma: latest.ma,
    upper,
    lower,
    deviation: (nav / latest.ma - 1) * 100
  };
}

export function calculateStrategyState({
  currentNav = null,
  quoteDate = null,
  estimated = false,
  quoteTime = null,
  cycle = null,
  strategy = DEFAULT_STRATEGY,
  history = null,
  now = new Date()
} = {}) {
  if (strategy?.mode === 'band')
    return calculateBandState({ currentNav, quoteDate, estimated, quoteTime, cycle, strategy, history, now });
  const config = normalizeStrategy(strategy);
  const valid = Object.entries(config).every(([key, value]) => {
    if (value === '' || value === null || !Number.isFinite(Number(value))) return false;
    const number = Number(value);
    return key === 'cooldownDays'
      ? Number.isInteger(number) && number >= 0 && number <= 3650
      : number > 0 && number <= (key === 'riseRate' ? 1000 : 99);
  });
  if (!valid) return { status: 'invalid' };
  if (cycle !== null && !isStrategyCycle(cycle)) return { status: 'invalidCycle' };
  if (!cycle || !positive(currentNav)) return { status: 'pending' };
  if (cycle.phase === 'stopped') return { status: 'stopped' };
  const remainingDays = cooldownRemaining(cycle, config.cooldownDays, now);
  if (remainingDays > 0) return { status: 'cooldown', remainingDays };
  if (!quoteDate || quoteDate < cycle.anchorDate || quoteDate > strategyDate(now)) return { status: 'pending' };
  const nav = Number(currentNav);
  const peakNav = estimated ? cycle.peakNav : Math.max(cycle.peakNav, nav);
  const change = (nav / cycle.anchorNav - 1) * 100;
  const drawdown = Math.max(0, (1 - nav / peakNav) * 100);
  const status =
    drawdown + 1e-10 >= Number(config.stopDrawdown)
      ? 'stop'
      : cycle.phase === 'holding' && change + 1e-10 >= Number(config.riseRate)
        ? 'sell'
        : cycle.phase === 'waitingBuy' && -change + 1e-10 >= Number(config.buyDropRate)
          ? 'buy'
          : 'watch';
  return {
    status,
    estimated,
    quoteDate,
    quoteTime,
    change,
    drawdown,
    phase: cycle.phase,
    peakNav,
    riseRate: Number(config.riseRate),
    buyDropRate: Number(config.buyDropRate),
    stopDrawdown: Number(config.stopDrawdown)
  };
}

export function confirmStrategyTrade({ cycle, status, nav, now = new Date() }) {
  if (!isStrategyCycle(cycle) || !positive(nav) || Number(nav) > 1000000) throw new Error('请输入有效的实际成交净值。');
  if (
    !['sell', 'buy', 'stop', 'resume'].includes(status) ||
    (status === 'sell' && cycle.phase !== 'holding') ||
    (status === 'buy' && cycle.phase !== 'waitingBuy') ||
    (status === 'resume' && cycle.phase !== 'stopped') ||
    (status === 'stop' && cycle.phase === 'stopped')
  )
    throw new Error('当前阶段不能确认这项操作。');
  if (status === 'resume') return { ...createStrategyCycle(nav, strategyDate(now)), lastTradeAt: now.toISOString() };
  return {
    ...cycle,
    phase: status === 'stop' ? 'stopped' : status === 'sell' ? 'waitingBuy' : 'holding',
    anchorNav: Number(nav),
    anchorDate: strategyDate(now),
    peakNav: Math.max(cycle.peakNav, Number(nav)),
    lastTradeAt: now.toISOString()
  };
}

const nearThreshold = (current, limit) =>
  Number.isFinite(current) && Number.isFinite(limit) && limit > 0 && current / limit >= 0.7;

function buildBandPrompt(state) {
  const maLabel = `${state.bandPeriod} 日均线`;
  if (state.status === 'invalid')
    return {
      label: '请检查设置',
      tone: '',
      detail: '底仓须在 0–100% 之间，卖出线和买回线须大于 0，最少持有须为整数天。'
    };
  if (state.status === 'insufficient')
    return { label: '暂无信号', tone: '', detail: `净值历史不足 ${state.bandPeriod} 个交易日，算不出 ${maLabel}。` };
  const source = state.estimated
    ? `按 ${state.quoteTime || state.quoteDate} 估值预警，不代表成交价格。`
    : `按 ${state.quoteDate} 正式净值复核。`;
  const prefix = state.estimated ? '估值预警 · ' : '';
  const gap = Math.abs(state.deviation).toFixed(1);
  const metric = `偏离均线 ${state.deviation >= 0 ? '+' : '−'}${gap}%`;
  if (state.status === 'sell')
    return {
      label: `${prefix}已到卖出线`,
      tone: 'up',
      metric,
      detail: `${source}净值高于 ${maLabel} ${gap}%，可卖出机动仓，底仓不动。实际卖出后请确认。`
    };
  if (state.status === 'buy')
    return {
      label: `${prefix}已到买回线`,
      tone: 'down',
      metric,
      detail: `${source}净值低于 ${maLabel} ${gap}%，可买回机动仓。实际买回后请确认。`
    };
  if (state.status === 'cooldown')
    return {
      label: state.triggered ? `已到${state.triggered === 'sell' ? '卖出' : '买回'}线，暂不提示` : '最少持有期',
      tone: state.triggered ? 'warn' : '',
      metric,
      detail: `成交确认后还需等 ${state.remainingDays} 天，避免短期赎回费和频繁交易。`
    };
  if (state.phase === 'waitingBuy')
    return {
      label: state.estimated ? '估值观察' : '等待买回',
      tone: '',
      metric,
      detail: `${source}机动仓已卖出。均线会随时间移动，买回线也会跟着变；当前距买回线还差 ${((1 - state.lower / state.nav) * 100).toFixed(1)}%。`
    };
  return {
    label: state.estimated ? '估值观察' : '持有观察',
    tone: '',
    metric,
    detail: `${source}${state.nav <= state.lower ? '净值已低于买回线，但机动仓本来就在手，无需操作。' : '机动仓持有中。'}距卖出线还差 ${((state.upper / state.nav - 1) * 100).toFixed(1)}%。`
  };
}

export function buildStrategyPrompt({ strategyState }) {
  const state = strategyState || {};
  if (state.mode === 'band' && ['invalid', 'insufficient', 'sell', 'buy', 'cooldown', 'watch'].includes(state.status))
    return buildBandPrompt(state);
  const percentage = (value) => Math.abs(Number(value) || 0).toFixed(2) + '%';
  const source = state.estimated
    ? `按 ${state.quoteTime || state.quoteDate} 估值预警，不代表成交价格。`
    : state.quoteDate
      ? `按 ${state.quoteDate} 正式净值复核。`
      : '';
  const prefix = state.estimated ? '估值预警 · ' : '';
  if (state.status === 'stop')
    return {
      label: `${prefix}已触发你设定的止损线`,
      tone: 'up',
      metric: `已回落 ${percentage(state.drawdown)}`,
      detail: `${source}从已记录最高净值 ${state.peakNav.toFixed(4)} 回落 ${percentage(state.drawdown)}（止损线 ${percentage(state.stopDrawdown)}），止损优先于补仓。实际卖出后请确认。`
    };
  if (state.status === 'sell')
    return {
      label: `${prefix}已达你设定的卖出线`,
      tone: 'up',
      metric: `已涨 ${percentage(state.change)}`,
      detail: `${source}较本轮参考净值上涨 ${percentage(state.change)}（卖出线 ${percentage(state.riseRate)}）。卖出一部分后确认，再等待回落买回。`
    };
  if (state.status === 'buy')
    return {
      label: `${prefix}已达你设定的买回线`,
      tone: 'down',
      metric: `已回落 ${percentage(state.change)}`,
      detail: `${source}较实际卖出净值回落 ${percentage(state.change)}（买回线 ${percentage(state.buyDropRate)}）。实际买回后确认，开启下一轮。`
    };
  if (state.status === 'cooldown')
    return { label: '冷静期', tone: '', detail: `成交确认后还需冷静 ${state.remainingDays} 天，期间不生成买卖提示。` };
  if (state.status === 'stopped')
    return { label: '止损后暂停', tone: '', detail: '不再提示补仓；实际重新买入后确认恢复跟踪。' };
  if (state.status === 'invalid')
    return { label: '请检查设置', tone: '', detail: '涨跌阈值须大于0，回落须小于100%；冷静期须为0–3650的整数。' };
  if (state.status === 'invalidCycle')
    return { label: '策略记录异常', tone: '', detail: '已暂停提醒，请检查本地记录，不自动清除基准或冷静期。' };
  if (state.status === 'watch') {
    const waitingBuy = state.phase === 'waitingBuy';
    const currentMove = waitingBuy ? -Number(state.change) || 0 : Number(state.change) || 0;
    const moveLimit = waitingBuy ? Number(state.buyDropRate) : Number(state.riseRate);
    const drawdown = Number(state.drawdown) || 0;
    const warn = nearThreshold(currentMove, moveLimit) || nearThreshold(drawdown, Number(state.stopDrawdown));
    return {
      label: state.estimated ? '估值观察' : '等待',
      tone: warn ? 'warn' : '',
      metric: waitingBuy ? `已回落 ${percentage(currentMove)}` : `已涨 ${percentage(currentMove)}`,
      detail: waitingBuy
        ? `${source}已回落 ${percentage(currentMove)} / 买回线 ${percentage(state.buyDropRate)}；从最高值回落 ${percentage(state.drawdown)} / 止损线 ${percentage(state.stopDrawdown)}。`
        : `${source}已涨 ${percentage(currentMove)} / 卖出线 ${percentage(state.riseRate)}；从最高值回落 ${percentage(state.drawdown)} / 止损线 ${percentage(state.stopDrawdown)}。`
    };
  }
  return { label: '待更新', tone: '', detail: '等待有效净值；成交确认后不使用成交日期之前的旧净值生成信号。' };
}
