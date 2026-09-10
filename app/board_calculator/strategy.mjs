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

export function calculateStrategyState({
  currentNav = null,
  quoteDate = null,
  estimated = false,
  quoteTime = null,
  cycle = null,
  strategy = DEFAULT_STRATEGY,
  now = new Date()
} = {}) {
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
  const remainingDays =
    cycle.lastTradeAt === null
      ? 0
      : Math.max(
          0,
          dayNumber(strategyDate(new Date(cycle.lastTradeAt))) +
            Number(config.cooldownDays) -
            dayNumber(strategyDate(now))
        );
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
    sellNav: cycle.anchorNav * (1 + Number(config.riseRate) / 100),
    buyNav: cycle.anchorNav * (1 - Number(config.buyDropRate) / 100),
    stopNav: peakNav * (1 - Number(config.stopDrawdown) / 100)
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

export function buildStrategyPrompt({ strategyState }) {
  const state = strategyState || {};
  const percentage = (value) => Math.abs(value).toFixed(2) + '%';
  const source = state.estimated
    ? `按 ${state.quoteTime || state.quoteDate} 估值预警，不代表成交价格。`
    : state.quoteDate
      ? `按 ${state.quoteDate} 正式净值复核。`
      : '';
  const prefix = state.estimated ? '估值预警 · ' : '';
  if (state.status === 'stop')
    return {
      label: `${prefix}回落止损 · 提示卖出`,
      tone: 'up',
      detail: `${source}从已记录最高净值 ${state.peakNav.toFixed(4)} 回落 ${percentage(state.drawdown)}，止损优先于补仓。实际卖出后请确认。`
    };
  if (state.status === 'sell')
    return {
      label: `${prefix}上涨 · 提示卖出`,
      tone: 'up',
      detail: `${source}较本轮参考净值上涨 ${percentage(state.change)}。卖出一部分后确认，再等待回落买回。`
    };
  if (state.status === 'buy')
    return {
      label: `${prefix}回落 · 提示买回`,
      tone: 'down',
      detail: `${source}较实际卖出净值回落 ${percentage(state.change)}。实际买回后确认，开启下一轮。`
    };
  if (state.status === 'cooldown')
    return { label: '冷静期', tone: '', detail: `成交确认后还需冷静 ${state.remainingDays} 天，期间不生成买卖提示。` };
  if (state.status === 'stopped')
    return { label: '止损后暂停', tone: '', detail: '不再提示补仓；实际重新买入后确认恢复跟踪。' };
  if (state.status === 'invalid')
    return { label: '请检查设置', tone: '', detail: '涨跌阈值须大于0，回落须小于100%；冷静期须为0–3650的整数。' };
  if (state.status === 'invalidCycle')
    return { label: '策略记录异常', tone: '', detail: '已暂停提醒，请检查本地记录，不自动清除基准或冷静期。' };
  if (state.status === 'watch')
    return {
      label: state.estimated ? '估值观察' : '等待',
      tone: '',
      detail:
        state.phase === 'waitingBuy'
          ? `${source}等待回落至 ${state.buyNav.toFixed(4)} 买回；从最高值回落至 ${state.stopNav.toFixed(4)} 时优先提示止损。`
          : `${source}涨至 ${state.sellNav.toFixed(4)} 提示卖出；从最高值回落至 ${state.stopNav.toFixed(4)} 提示止损。`
    };
  return { label: '待更新', tone: '', detail: '等待有效净值；成交确认后不使用成交日期之前的旧净值生成信号。' };
}
