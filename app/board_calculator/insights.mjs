import lodash from 'lodash';

const { isArray, isObject } = lodash;

const finite = (value) => Number.isFinite(value);
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
const ACTION_WINDOW_DAYS = 14;
const SIGNAL_STATUSES = ['stop', 'sell', 'buy'];
const SIGNAL_REPEAT_DAYS = 5;
const REVIEW_HORIZON = 5;
const LOG_LIMIT = 100;

const ACTION_RULES = [
  [/基金经理.*(变更|调整|离任|解聘|增聘)|(变更|调整|增聘|解聘).*基金经理/, '经理变更'],
  [/(暂停|停止).*(申购|赎回|定投|转换)/, '暂停交易'],
  [/(限制|限购|大额).*(申购|转换入|定投)/, '申购限制'],
  [/清算|清盘|终止基金合同|基金合同终止|持有人大会/, '清盘风险']
];
const JUDGE_RULES = [
  [/季度报告|半年度报告|年度报告/, '定期报告'],
  [/分红|收益分配/, '分红'],
  [/业绩比较基准|基金合同.*修订|修订.*基金合同/, '合同变更'],
  [/费率|恢复/, '规则调整']
];

/** 公告分级：按标题规则判断；恢复类公告不算需要行动，只有近 14 天的才算 */
export function classifyAnnouncement(title = '', date = '', today = '') {
  const text = String(title);
  const judge = JUDGE_RULES.find(([pattern]) => pattern.test(text));
  const action = /恢复/.test(text) ? null : ACTION_RULES.find(([pattern]) => pattern.test(text));
  const age = date && today ? dayNumber(today) - dayNumber(date.slice(0, 10)) : 0;
  if (action && !(age > ACTION_WINDOW_DAYS)) return { level: 'action', tag: action[1] };
  if (action) return { level: 'judge', tag: action[1] };
  if (judge) return { level: 'judge', tag: judge[1] };
  return { level: 'general', tag: '公告' };
}

const parseWeight = (value) => Number.parseFloat(value);

/** 盈亏归因：只估算已披露重仓股的贡献，其余归入“其他”；样本不足时返回 null */
export function attributeMove({ fundPct, stocks = [], reportDate = null } = {}) {
  if (!finite(fundPct)) return null;
  const known = stocks
    .map((stock) => ({ ...stock, weightValue: parseWeight(stock.weight), changeValue: Number(stock.change) }))
    .filter((stock) => stock.weightValue > 0 && stock.change !== null && finite(stock.changeValue))
    .map((stock) => ({
      code: stock.code,
      name: stock.name,
      weight: stock.weightValue,
      change: stock.changeValue,
      contribution: (stock.weightValue * stock.changeValue) / 100
    }));
  if (known.length < 3) return null;
  const contribution = known.reduce((sum, stock) => sum + stock.contribution, 0);
  return {
    fundPct,
    contribution,
    other: fundPct - contribution,
    coveredWeight: known.reduce((sum, stock) => sum + stock.weight, 0),
    top: [...known].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3),
    reportDate
  };
}

/** 组合穿透：按板块和重仓股合并持仓金额，重仓股来自定期报告，并非实时持仓 */
export function buildExposure(positions = []) {
  const valid = positions.filter((item) => item.value > 0);
  const total = valid.reduce((sum, item) => sum + item.value, 0);
  if (!(total > 0)) return null;
  const sectors = new Map();
  const stocks = new Map();
  let disclosedValue = 0;
  valid.forEach((position) => {
    const label = position.sector || '未匹配板块';
    const sector = sectors.get(label) || { name: label, value: 0, funds: [] };
    sector.value += position.value;
    sector.funds.push(position.name);
    sectors.set(label, sector);
    (position.stocks || []).forEach((stock) => {
      const weight = parseWeight(stock.weight);
      if (!(weight > 0)) return;
      const key = stock.code || stock.name;
      const entry = stocks.get(key) || { code: stock.code, name: stock.name, value: 0, funds: [] };
      const value = (position.value * weight) / 100;
      entry.value += value;
      entry.funds.push(position.name);
      stocks.set(key, entry);
      disclosedValue += value;
    });
  });
  const withShare = (item) => ({ ...item, share: item.value / total });
  const sectorList = [...sectors.values()].map(withShare).sort((a, b) => b.value - a.value);
  const stockList = [...stocks.values()].map(withShare).sort((a, b) => b.value - a.value);
  return {
    total,
    fundCount: valid.length,
    sectors: sectorList,
    topStocks: stockList.slice(0, 5),
    overlaps: stockList.filter((stock) => stock.funds.length >= 2).slice(0, 5),
    disclosedShare: disclosedValue / total,
    concentrated: sectorList[0]?.name !== '未匹配板块' && sectorList[0]?.share >= 0.5
  };
}

export const normalizeSignalLog = (log) => ({
  signals: isObject(log) && isArray(log.signals) ? log.signals : [],
  decisions: isObject(log) && isArray(log.decisions) ? log.decisions : []
});

/** 记录一次触发；同类提示 5 天内只记一次，避免同一波行情被反复计数 */
export function recordSignal(log, { status, date, nav, estimated = false }) {
  const current = normalizeSignalLog(log);
  if (!SIGNAL_STATUSES.includes(status) || !date || !(nav > 0)) return current;
  const repeat = current.signals.some(
    (item) => item.status === status && dayNumber(date) - dayNumber(item.date) < SIGNAL_REPEAT_DAYS
  );
  if (repeat) return current;
  return {
    ...current,
    signals: [...current.signals, { status, date, nav, estimated: Boolean(estimated) }].slice(-LOG_LIMIT)
  };
}

export function recordDecision(log, { ratio, status = '', date, nav, at }) {
  const current = normalizeSignalLog(log);
  return {
    ...current,
    decisions: [...current.decisions, { ratio, status, date, nav, at }].slice(-LOG_LIMIT)
  };
}

/** 满 5 个交易日后写入结果并固定下来，之后不再受历史净值窗口影响 */
export function settleSignals(log, navs = [], horizon = REVIEW_HORIZON) {
  const current = normalizeSignalLog(log);
  let changed = false;
  const signals = current.signals.map((signal) => {
    if (signal.outcome) return signal;
    const after = navs.filter((item) => item.date > signal.date);
    if (after.length < horizon) return signal;
    const later = after[horizon - 1];
    const change = (later.nav / signal.nav - 1) * 100;
    changed = true;
    return {
      ...signal,
      outcome: { date: later.date, change, hit: signal.status === 'buy' ? change > 0 : change < 0 }
    };
  });
  return changed ? { ...current, signals } : current;
}

export function summarizeSignals(log) {
  const { signals, decisions } = normalizeSignalLog(log);
  const settled = signals.filter((item) => item.outcome);
  const hits = settled.filter((item) => item.outcome.hit).length;
  return {
    total: signals.length,
    settled: settled.length,
    pending: signals.length - settled.length,
    hits,
    hitRate: settled.length ? hits / settled.length : null,
    enoughSamples: settled.length >= 10,
    recent: [...signals].reverse().slice(0, 5),
    decisions: [...decisions].reverse().slice(0, 5)
  };
}

/** 决定之后净值的变化，以及相对“不操作”少亏或少赚的比例 */
export function evaluateDecision(decision, latestNav) {
  if (!(decision?.nav > 0) || !(latestNav > 0)) return null;
  const change = (latestNav / decision.nav - 1) * 100;
  return { change, avoided: -change * Number(decision.ratio || 0) };
}

/** 合并资金流判断是否连续流出，天数不足时返回 0 */
export function outflowStreak(flows = []) {
  let days = 0;
  let total = 0;
  for (let index = flows.length - 1; index >= 0 && Number(flows[index]?.net) < 0; index -= 1) {
    days += 1;
    total += Number(flows[index].net);
  }
  return { days, total };
}

export const signalLogKey = (fundId) => `board-signal-log:${fundId}`;
